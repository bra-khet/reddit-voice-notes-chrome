/**
 * v5.4.0 — Centralized current-take session state (roadmap §3.1, Phase 0).
 *
 * Single source of truth for the take lifecycle across every extension
 * context: Design Studio page, Reddit content script, background service
 * worker, offscreen document. All of them share `browser.storage.local`, so
 * the snapshot lives there and `storage.onChanged` is the cross-context sync
 * channel — the same proven pattern as WORKFLOW_PHASE_KEY /
 * LAST_RECORDING_READY_KEY / BAKED_MP4_READY_KEY. No new MSG_TAKE_* relay
 * family is needed (Phase 0 decision; the scaffolded placeholders were
 * removed from src/messaging/types.ts).
 *
 * Storage model (hybrid):
 * - Snapshot: one JSON-safe object under `rvn.take.current` — never blobs.
 * - Blobs: stay in the existing extension-origin IDB stores
 *   (rvnLastRecording WebM / rvnLastBaseMp4 / rvnLastBakedMp4). The snapshot
 *   carries artifact stamps `{ savedAt, byteLength, durationSeconds }` that
 *   consumers can cross-check against store metas for freshness — a stale
 *   'recording' snapshot never lies about which blobs it owns.
 *
 * Writers:
 * - VoiceRecorderSession owns capture-lifecycle transitions
 *   (begin → processing → ready, discard-restore, draft demotion).
 * - entrypoints/background.ts merges authoritative artifact stamps after the
 *   relayed IDB writes succeed (recordArtifact).
 * - Studio bake completion promotes to 'baked' (updateFromBake).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Lifecycle of the authoritative "current take". */
export type TakeStatus =
  | 'draft' // incomplete / interrupted — resumable, artifacts may be partial
  | 'recording' // live capture in progress (transient)
  | 'processing' // post-stop transcode in progress (transient)
  | 'ready' // base MP4 + WebM available, not baked
  | 'baked' // baked (subtitled/composited) MP4 available
  | 'error'; // unrecoverable failure with no useful artifacts

export type TakeSource = 'reddit' | 'studio';

/** Which IDB store a stamped artifact lives in. */
export type TakeArtifactKind = 'baseRecording' | 'baseMp4' | 'bakedMp4';

/**
 * Freshness stamp for a blob in its IDB store. `savedAt` should match the
 * store meta's `savedAt` within relay latency; consumers comparing the two
 * can detect a snapshot that survived a crash while blobs moved on.
 */
export interface TakeArtifactStamp {
  savedAt: number;
  byteLength?: number;
  durationSeconds?: number;
}

export interface CurrentTakeMeta {
  durationSeconds?: number;
  /** Active clip profile at capture time (null = manual/custom mode). */
  activeProfileId?: string | null;
  subtitlesEnabled?: boolean;
  /** Human-readable note for draft/error states ("Recording interrupted"). */
  note?: string;
}

export interface CurrentTake {
  id: string;
  status: TakeStatus;
  source: TakeSource;
  createdAt: number;
  lastUpdated: number;
  meta: CurrentTakeMeta;
  artifacts: Partial<Record<TakeArtifactKind, TakeArtifactStamp>>;
}

export type CurrentTakePatch = {
  status?: TakeStatus;
  meta?: Partial<CurrentTakeMeta>;
  artifacts?: Partial<Record<TakeArtifactKind, TakeArtifactStamp>>;
};

export interface BeginTakeInit {
  source: TakeSource;
  meta?: Partial<CurrentTakeMeta>;
}

export interface BeginTakeResult {
  take: CurrentTake;
  /** Snapshot that was replaced — stash it to restore on discard. */
  priorTake: CurrentTake | null;
}

export interface TakeBakeResult {
  durationSeconds?: number;
  byteLength?: number;
}

export type TakeChangeListener = (take: CurrentTake | null) => void;
export type TakeUnsubscribe = () => void;

// ─── Constants ───────────────────────────────────────────────────────────────

export const CURRENT_TAKE_KEY = 'rvn.take.current' as const;

/**
 * A 'recording'/'processing' snapshot older than this is a crashed or
 * abandoned session (tab closed mid-capture, worker killed). Readers demote
 * it to 'draft' so the Studio offers recovery instead of a phantom live state.
 */
export const STALE_TRANSIENT_MS = 2 * 60 * 1000;

const TAKE_LOG_PREFIX = '[Reddit Voice Notes] TakeManager';

// ─── Pure helpers (node-testable — no browser.* references) ─────────────────

export function isTransientTakeStatus(status: TakeStatus): boolean {
  return status === 'recording' || status === 'processing';
}

/**
 * Monotonic "last changed" instant for cross-context precedence (Reddit panel vs
 * Studio deck). Uses the latest of lastUpdated and every artifact savedAt so a
 * rebake or relayed IDB stamp wins over an older session-local blob binding.
 */
export function takeFreshnessMs(take: CurrentTake): number {
  let max = 0;
  const candidates = [
    take.lastUpdated,
    take.createdAt,
    take.artifacts.bakedMp4?.savedAt,
    take.artifacts.baseMp4?.savedAt,
    take.artifacts.baseRecording?.savedAt,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && value > max) max = value;
  }
  return max;
}

/** True when `candidate` should win over a panel bound to `anchorFreshnessMs`. */
export function isNewerTakeThan(candidate: CurrentTake, anchorFreshnessMs: number): boolean {
  return takeFreshnessMs(candidate) > anchorFreshnessMs;
}

export function createTakeId(now = Date.now()): string {
  return `take-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const TAKE_STATUSES: readonly TakeStatus[] = [
  'draft',
  'recording',
  'processing',
  'ready',
  'baked',
  'error',
];

function parseArtifactStamp(raw: unknown): TakeArtifactStamp | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const stamp = raw as Record<string, unknown>;
  if (typeof stamp.savedAt !== 'number') return undefined;
  return {
    savedAt: stamp.savedAt,
    byteLength: typeof stamp.byteLength === 'number' ? stamp.byteLength : undefined,
    durationSeconds:
      typeof stamp.durationSeconds === 'number' ? stamp.durationSeconds : undefined,
  };
}

/** Validate an untrusted storage value into a CurrentTake, or null. */
export function parseCurrentTake(raw: unknown): CurrentTake | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const take = raw as Record<string, unknown>;
  if (typeof take.id !== 'string' || take.id.length === 0) return null;
  if (!TAKE_STATUSES.includes(take.status as TakeStatus)) return null;
  const source: TakeSource = take.source === 'studio' ? 'studio' : 'reddit';

  const rawMeta = (typeof take.meta === 'object' && take.meta !== null ? take.meta : {}) as Record<
    string,
    unknown
  >;
  const meta: CurrentTakeMeta = {
    durationSeconds:
      typeof rawMeta.durationSeconds === 'number' ? rawMeta.durationSeconds : undefined,
    activeProfileId:
      typeof rawMeta.activeProfileId === 'string' || rawMeta.activeProfileId === null
        ? (rawMeta.activeProfileId as string | null)
        : undefined,
    subtitlesEnabled:
      typeof rawMeta.subtitlesEnabled === 'boolean' ? rawMeta.subtitlesEnabled : undefined,
    note: typeof rawMeta.note === 'string' ? rawMeta.note : undefined,
  };

  const rawArtifacts = (
    typeof take.artifacts === 'object' && take.artifacts !== null ? take.artifacts : {}
  ) as Record<string, unknown>;
  const artifacts: CurrentTake['artifacts'] = {};
  for (const kind of ['baseRecording', 'baseMp4', 'bakedMp4'] as const) {
    const stamp = parseArtifactStamp(rawArtifacts[kind]);
    if (stamp) artifacts[kind] = stamp;
  }

  const createdAt = typeof take.createdAt === 'number' ? take.createdAt : 0;
  const lastUpdated = typeof take.lastUpdated === 'number' ? take.lastUpdated : createdAt;

  return {
    id: take.id,
    status: take.status as TakeStatus,
    source,
    createdAt,
    lastUpdated,
    meta,
    artifacts,
  };
}

/**
 * Demote a crashed transient snapshot to a recoverable state. Pure — readers
 * apply this on every read so all contexts converge without write-backs.
 */
export function normalizeStaleTake(take: CurrentTake | null, now = Date.now()): CurrentTake | null {
  if (!take || !isTransientTakeStatus(take.status)) return take;
  if (now - take.lastUpdated <= STALE_TRANSIENT_MS) return take;
  const hasArtifacts = Boolean(
    take.artifacts.baseRecording || take.artifacts.baseMp4 || take.artifacts.bakedMp4,
  );
  return {
    ...take,
    status: 'draft',
    meta: {
      ...take.meta,
      note: hasArtifacts
        ? 'Session interrupted — captured audio was preserved.'
        : 'Recording interrupted before anything was captured.',
    },
  };
}

/** Merge a patch into a take — meta and artifacts merge per-field, rest replaces. */
export function mergeTakePatch(
  take: CurrentTake,
  patch: CurrentTakePatch,
  now = Date.now(),
): CurrentTake {
  return {
    ...take,
    status: patch.status ?? take.status,
    lastUpdated: now,
    meta: { ...take.meta, ...patch.meta },
    artifacts: { ...take.artifacts, ...patch.artifacts },
  };
}

// ─── Manager (storage-backed) ────────────────────────────────────────────────

export interface TakeManager {
  /** Best available current take (stale transients demoted to draft), or null. */
  getCurrentTake(): Promise<CurrentTake | null>;

  /** Start a new take (status 'recording'); returns the replaced snapshot for discard-restore. */
  beginTake(init: BeginTakeInit): Promise<BeginTakeResult>;

  /**
   * Merge a patch into the current take. When `expectId` is given the write is
   * skipped if another take took over in the meantime (superseded session).
   */
  updateCurrentTake(
    patch: CurrentTakePatch,
    opts?: { expectId?: string },
  ): Promise<CurrentTake | null>;

  /**
   * Persist draft state (recorder close, visibility loss, interrupted edits).
   * Transient statuses demote to 'draft'; complete takes only merge meta —
   * auto-draft must never un-complete a finished take.
   */
  saveDraft(partial?: CurrentTakePatch): Promise<void>;

  /** Write a snapshot verbatim (or clear with null) — discard-restore path. */
  restoreTake(take: CurrentTake | null): Promise<void>;

  /**
   * Stamp a blob write into the current take. Called by the background after
   * relayed IDB saves succeed. Adopts an orphan artifact into a fresh draft
   * when no take exists (legacy callers, harnesses).
   */
  recordArtifact(
    kind: TakeArtifactKind,
    stamp: TakeArtifactStamp,
    opts?: { source?: TakeSource },
  ): Promise<void>;

  /** Promote bake completion into the current take (status 'baked'). */
  updateFromBake(result: TakeBakeResult): Promise<void>;

  /** Clear the current take snapshot (explicit user action or full reset). */
  clearCurrentTake(): Promise<void>;

  /**
   * Reactive subscription — emits the current value immediately (async) and
   * on every cross-context change via storage.onChanged.
   */
  subscribe(listener: TakeChangeListener): TakeUnsubscribe;
}

async function readTakeRaw(): Promise<CurrentTake | null> {
  const stored = await browser.storage.local.get(CURRENT_TAKE_KEY);
  return parseCurrentTake(stored[CURRENT_TAKE_KEY]);
}

async function writeTakeRaw(take: CurrentTake | null): Promise<void> {
  if (take) {
    await browser.storage.local.set({ [CURRENT_TAKE_KEY]: take });
  } else {
    await browser.storage.local.remove(CURRENT_TAKE_KEY);
  }
}

/**
 * Same-context writes are serialized through this chain so read-modify-write
 * updates can't interleave locally. Cross-context races are tolerable: writers
 * touch disjoint fields (status transitions vs artifact stamps) and every
 * write re-reads the latest snapshot first.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeChain.then(operation, operation);
  writeChain = next.catch(() => undefined);
  return next;
}

function createStorageTakeManager(): TakeManager {
  return {
    async getCurrentTake(): Promise<CurrentTake | null> {
      try {
        return normalizeStaleTake(await readTakeRaw());
      } catch (error) {
        console.warn(`${TAKE_LOG_PREFIX} read failed`, error);
        return null;
      }
    },

    beginTake(init: BeginTakeInit): Promise<BeginTakeResult> {
      return enqueueWrite(async () => {
        const priorTake = normalizeStaleTake(await readTakeRaw());
        const now = Date.now();
        const take: CurrentTake = {
          id: createTakeId(now),
          status: 'recording',
          source: init.source,
          createdAt: now,
          lastUpdated: now,
          meta: { ...init.meta },
          artifacts: {},
        };
        await writeTakeRaw(take);
        return { take, priorTake };
      });
    },

    updateCurrentTake(
      patch: CurrentTakePatch,
      opts?: { expectId?: string },
    ): Promise<CurrentTake | null> {
      return enqueueWrite(async () => {
        const current = await readTakeRaw();
        if (!current) return null;
        if (opts?.expectId && current.id !== opts.expectId) return null;
        const next = mergeTakePatch(current, patch);
        await writeTakeRaw(next);
        return next;
      });
    },

    saveDraft(partial?: CurrentTakePatch): Promise<void> {
      return enqueueWrite(async () => {
        const current = await readTakeRaw();
        if (!current) return;
        const demote = isTransientTakeStatus(current.status);
        const next = mergeTakePatch(current, {
          ...partial,
          status: demote ? 'draft' : (partial?.status ?? current.status),
        });
        await writeTakeRaw(next);
      });
    },

    restoreTake(take: CurrentTake | null): Promise<void> {
      return enqueueWrite(() => writeTakeRaw(take));
    },

    recordArtifact(
      kind: TakeArtifactKind,
      stamp: TakeArtifactStamp,
      opts?: { source?: TakeSource },
    ): Promise<void> {
      return enqueueWrite(async () => {
        const current = await readTakeRaw();
        if (current) {
          await writeTakeRaw(mergeTakePatch(current, { artifacts: { [kind]: stamp } }));
          return;
        }
        // Orphan artifact (blob saved without a live take) — adopt into a
        // draft so the Studio can still surface and recover it.
        const now = Date.now();
        await writeTakeRaw({
          id: createTakeId(now),
          status: 'draft',
          source: opts?.source ?? 'reddit',
          createdAt: now,
          lastUpdated: now,
          meta: { durationSeconds: stamp.durationSeconds },
          artifacts: { [kind]: stamp },
        });
      });
    },

    updateFromBake(result: TakeBakeResult): Promise<void> {
      return enqueueWrite(async () => {
        const now = Date.now();
        const stamp: TakeArtifactStamp = {
          savedAt: now,
          byteLength: result.byteLength,
          durationSeconds: result.durationSeconds,
        };
        const current = await readTakeRaw();
        if (current) {
          await writeTakeRaw(
            mergeTakePatch(current, { status: 'baked', artifacts: { bakedMp4: stamp } }),
          );
          return;
        }
        // Bake without a tracked take (pre-v5.4.0 recording still in IDB) —
        // adopt it so the new state layer picks up mid-flight sessions.
        await writeTakeRaw({
          id: createTakeId(now),
          status: 'baked',
          source: 'studio',
          createdAt: now,
          lastUpdated: now,
          meta: { durationSeconds: result.durationSeconds },
          artifacts: { bakedMp4: stamp },
        });
      });
    },

    clearCurrentTake(): Promise<void> {
      return enqueueWrite(() => writeTakeRaw(null));
    },

    subscribe(listener: TakeChangeListener): TakeUnsubscribe {
      let active = true;

      const storageListener = (
        changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
        area: string,
      ): void => {
        if (!active || area !== 'local' || !(CURRENT_TAKE_KEY in changes)) return;
        listener(normalizeStaleTake(parseCurrentTake(changes[CURRENT_TAKE_KEY]?.newValue)));
      };
      browser.storage.onChanged.addListener(storageListener);

      void this.getCurrentTake().then((take) => {
        if (active) listener(take);
      });

      return () => {
        active = false;
        browser.storage.onChanged.removeListener(storageListener);
      };
    },
  };
}

let takeManagerInstance: TakeManager | null = null;

/** Singleton accessor — the manager is stateless (all state in storage). */
export function getTakeManager(): TakeManager {
  if (!takeManagerInstance) {
    takeManagerInstance = createStorageTakeManager();
  }
  return takeManagerInstance;
}
