/**
 * v5.4.0 Phase 0 Prep — neutral scaffold only.
 *
 * FABLE / MAIN AGENT: decide and implement here — storage backend (IDB vs
 * chrome.storage vs hybrid), draft strategy, cross-context sync via messaging
 * relays, integration with v5.3.9 chunking and v5.3.10 WebCodecs bake paths,
 * relationship to last-recording-db / last-baked-mp4-db / session-transcript-db, etc.
 *
 * @see docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md §3.1, Phase 0
 */

/** Lifecycle of the authoritative "current take" — main agent may extend or replace. */
export type TakeStatus =
  | 'none'
  | 'draft'
  | 'recording'
  | 'preview'
  | 'processing'
  | 'baked'
  | 'error';

/**
 * FABLE / MAIN AGENT: expand metadata (character profile, effects config,
 * subtitle scaffold summary, bake job id, etc.).
 */
export interface CurrentTakeMeta {
  durationSeconds?: number;
  savedAt?: number;
  characterProfileId?: string;
}

/**
 * Neutral current-take snapshot. Blob storage strategy is intentionally deferred.
 *
 * FABLE / MAIN AGENT: decide whether baseRecording / bakedMp4 are inline blobs,
 * IDB keys, extension relay handles, or hybrid references.
 */
export interface CurrentTake {
  id: string;
  status: TakeStatus;
  lastUpdated: number;
  meta?: CurrentTakeMeta;
  /** Placeholder — main agent defines reference semantics. */
  baseRecordingRef?: string;
  /** Placeholder — main agent defines reference semantics. */
  bakedMp4Ref?: string;
}

export type TakeChangeListener = (take: CurrentTake | null) => void;
export type TakeUnsubscribe = () => void;

/**
 * Central session contract for v5.4.0 standalone Design Studio.
 * All methods are stubs — no persistence or messaging behavior yet.
 */
export interface TakeManager {
  /** Return the best available current take, or null when none exists. */
  getCurrentTake(): Promise<CurrentTake | null>;

  /**
   * Persist draft state (recorder close, visibility loss, in-progress edits).
   * FABLE / MAIN AGENT: wire from recorder-panel close/stop and studio surfaces.
   */
  saveDraft(partial?: Partial<CurrentTake>): Promise<void>;

  /**
   * Promote bake completion into the current take.
   * FABLE / MAIN AGENT: call from subtitle-canvas-bake / WebCodecs orchestrator completion.
   */
  updateFromBake(payload: unknown): Promise<void>;

  /**
   * Reactive subscription for Design Studio status strip, Reddit injector, etc.
   * FABLE / MAIN AGENT: back with chrome.storage.onChanged + local fan-out.
   */
  subscribe(listener: TakeChangeListener): TakeUnsubscribe;

  /** Clear the current take (explicit user action or full reset). */
  clearCurrentTake(): Promise<void>;
}

/** Factory stub — returns no-op implementation until main agent replaces it. */
export function createTakeManager(): TakeManager {
  return {
    async getCurrentTake(): Promise<CurrentTake | null> {
      // FABLE / MAIN AGENT: implement
      return null;
    },

    async saveDraft(_partial?: Partial<CurrentTake>): Promise<void> {
      // FABLE / MAIN AGENT: implement
    },

    async updateFromBake(_payload: unknown): Promise<void> {
      // FABLE / MAIN AGENT: implement
    },

    subscribe(_listener: TakeChangeListener): TakeUnsubscribe {
      // FABLE / MAIN AGENT: implement
      return () => {};
    },

    async clearCurrentTake(): Promise<void> {
      // FABLE / MAIN AGENT: implement
    },
  };
}

let takeManagerInstance: TakeManager | null = null;

/** Singleton accessor — main agent may replace with DI or context-specific instances. */
export function getTakeManager(): TakeManager {
  if (!takeManagerInstance) {
    takeManagerInstance = createTakeManager();
  }
  return takeManagerInstance;
}