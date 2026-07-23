/*
 * First-load chronos gate (Track D §5).
 *
 * WHY THIS EXISTS — it is a correctness mechanism, not a courtesy. The extension's
 * transcoder enforces a 90 s ABSOLUTE_MAX that explicitly includes WASM cold start.
 * In the extension the 31 MB core loads from disk; on Pages it arrives over the
 * network, so a visitor who records immediately on a cold cache could trip a
 * watchdog that was never dimensioned for a 31 MB download. Pre-fetching the
 * engine here, on the hub, is what makes the studio's existing timeouts safe.
 *
 * CROSS-PAGE REALITY. The hub and the studio are separate pages, so a warmed
 * FFmpeg instance does NOT transfer. What transfers is the browser's HTTP cache
 * and WebAssembly code cache, both keyed by URL — so the gate warms exactly the
 * three asset URLs src/ffmpeg/ffmpeg-runner.ts will request, and the studio's cold
 * load becomes a cache hit. The expensive, watchdog-relevant part (the 31 MB
 * download) is then paid once, here, with an honest progress bar.
 *
 * CACHE STORAGE is written as a warm marker + durable copy. The STUDIO now reads
 * from it to survive HTTP-cache eviction (roadmap §3.5): src/ffmpeg/ffmpeg-warm-cache.ts
 * matches the SAME key this gate stores, so the shared FFMPEG_WARM_CACHE constant is
 * imported from there rather than duplicated — writer and reader cannot drift.
 */

import { FFMPEG_WARM_CACHE } from '@/src/ffmpeg/ffmpeg-warm-cache';

const base = import.meta.env.BASE_URL;
const WORKER_URL = `${base}ffmpeg/esm/worker.js`;
const CORE_JS_URL = `${base}ffmpeg/ffmpeg-core.js`;
const CORE_WASM_URL = `${base}ffmpeg/ffmpeg-core.wasm`;
const STUDIO_URL = `${base}design-studio/`;

// Sync: src/ffmpeg/ffmpeg-warm-cache.ts (the studio-side reader). The wasm is stored
// under CORE_WASM_URL, which resolves to the same absolute URL the runner's getURL
// produces — that URL-key identity is what lets the studio find this copy.
const CACHE_NAME = FFMPEG_WARM_CACHE;
// Generous — a 31 MB download on a slow link is legitimately slow, and the point
// of the gate is to absorb that wait honestly rather than fail it early.
const GATE_TIMEOUT_MS = 180_000;

type StageKey = 'preparing' | 'fetching' | 'warming' | 'warm' | 'opening';

interface StageEvent {
  key: StageKey;
  ratio?: number;
  loaded?: number;
  total?: number;
}

const STAGE_LABEL: Record<StageKey, string> = {
  preparing: 'Preparing core…',
  fetching: 'Loading media engines…',
  warming: 'Warming the encoder…',
  warm: 'Opening Design Studio…',
  opening: 'Opening Design Studio…',
};

// Bar position per stage; `fetching` interpolates 0.05→0.85 by byte ratio so the
// 31 MB download owns most of the bar — the honest thing to weight.
function barFraction(event: StageEvent): number {
  switch (event.key) {
    case 'preparing':
      return 0.04;
    case 'fetching':
      return 0.05 + 0.8 * (event.ratio ?? 0);
    case 'warming':
      return 0.9;
    case 'warm':
    case 'opening':
      return 1;
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(event: StageEvent): string {
  if (event.key === 'fetching' && event.total) {
    return `${STAGE_LABEL.fetching} ${formatMb(event.loaded ?? 0)} of ${formatMb(event.total)}`;
  }
  return STAGE_LABEL[event.key];
}

// ── Warm logic ───────────────────────────────────────────────────────────────

async function cacheHasWasm(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME);
    return Boolean(await cache.match(CORE_WASM_URL));
  } catch {
    return false;
  }
}

async function cacheStoreWasm(blob: Blob): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      CORE_WASM_URL,
      new Response(blob, { headers: { 'content-type': 'application/wasm' } }),
    );
  } catch {
    /* Cache Storage is a best-effort belt; a failure here must not fail the gate. */
  }
}

async function fetchWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The media engine did not download (HTTP ${response.status}).`);
  }
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return response.blob();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  return new Blob(chunks as BlobPart[], {
    type: response.headers.get('content-type') ?? 'application/wasm',
  });
}

async function warmEngines(onStage: (event: StageEvent) => void): Promise<void> {
  onStage({ key: 'preparing' });

  if (await cacheHasWasm()) {
    // Warmed on a previous visit — the HTTP cache is very likely warm too, so the
    // studio's load will be fast. Collapse to a brief "Opening…" (§5 step 6).
    onStage({ key: 'warm' });
    return;
  }

  onStage({ key: 'fetching', ratio: 0 });
  const wasm = await fetchWithProgress(CORE_WASM_URL, (loaded, total) =>
    onStage({ key: 'fetching', ratio: total ? loaded / total : undefined, loaded, total }),
  );
  // Warm the small siblings too so the studio's assertAssetReachable() is a hit.
  await Promise.all([fetch(CORE_JS_URL), fetch(WORKER_URL)]);
  await cacheStoreWasm(wasm);

  // The milestone that actually protects the watchdog: the encoder compiles and
  // the worker spawns. Cross-page this warms the WASM code cache and proves the
  // whole chain end-to-end; the instance itself is discarded — the studio makes
  // its own. The 31 MB download is already cached from the fetch above, so this
  // load() hits cache and is not a second network trip.
  onStage({ key: 'warming' });
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  try {
    await ffmpeg.load({
      classWorkerURL: WORKER_URL,
      coreURL: CORE_JS_URL,
      wasmURL: CORE_WASM_URL,
    });
  } finally {
    try {
      ffmpeg.terminate();
    } catch {
      /* already gone */
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('The media engines took too long to load.')),
      ms,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ── Overlay ──────────────────────────────────────────────────────────────────

const STAGE_ROWS: Array<{ key: Exclude<StageKey, 'warm'>; label: string }> = [
  { key: 'preparing', label: 'Preparing core' },
  { key: 'fetching', label: 'Loading media engines' },
  { key: 'warming', label: 'Warming the encoder' },
  { key: 'opening', label: 'Opening Design Studio' },
];

const STAGE_INDEX: Record<StageKey, number> = {
  preparing: 0,
  fetching: 1,
  warming: 2,
  warm: 3,
  opening: 3,
};

interface Overlay {
  el: HTMLElement;
  update(event: StageEvent): void;
  fail(message: string, onRetry: () => void, onOpenAnyway: () => void): void;
  remove(): void;
}

function buildOverlay(): Overlay {
  const el = document.createElement('div');
  el.className = 'chronos';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'chronos-title');
  el.innerHTML = `
    <div class="chronos__scrim"></div>
    <div class="chronos__card" tabindex="-1">
      <h2 class="chronos__title" id="chronos-title">Warming up the Design Studio</h2>
      <ol class="chronos__stages">
        ${STAGE_ROWS.map(
          (row) => `<li class="chronos__stage" data-stage="${row.key}">
            <span class="chronos__stage-dot" aria-hidden="true"></span>
            <span class="chronos__stage-label">${row.label}</span>
          </li>`,
        ).join('')}
      </ol>
      <div class="chronos__bar" role="presentation"><div class="chronos__bar-fill" data-chronos-bar></div></div>
      <p class="chronos__status" data-chronos-status aria-live="polite">Preparing…</p>
      <div class="chronos__error" data-chronos-error role="alert" hidden>
        <p class="chronos__error-text" data-chronos-error-text></p>
        <div class="chronos__actions">
          <button type="button" class="chronos__btn chronos__btn--primary" data-chronos-retry>Retry</button>
          <button type="button" class="chronos__btn chronos__btn--ghost" data-chronos-open>Open anyway</button>
        </div>
        <p class="chronos__warn" data-chronos-warn>
          The media engines didn't finish loading. You can still design and record, but
          baking may fail or time out. Retry is recommended.
        </p>
      </div>
    </div>`;

  const card = el.querySelector<HTMLElement>('.chronos__card')!;
  const bar = el.querySelector<HTMLElement>('[data-chronos-bar]')!;
  const status = el.querySelector<HTMLElement>('[data-chronos-status]')!;
  const errorBox = el.querySelector<HTMLElement>('[data-chronos-error]')!;
  const errorText = el.querySelector<HTMLElement>('[data-chronos-error-text]')!;
  const stages = el.querySelector<HTMLElement>('.chronos__stages')!;

  function markStages(activeIndex: number): void {
    STAGE_ROWS.forEach((row, i) => {
      const node = stages.querySelector<HTMLElement>(`[data-stage="${row.key}"]`);
      if (!node) return;
      node.classList.toggle('chronos__stage--done', i < activeIndex);
      node.classList.toggle('chronos__stage--active', i === activeIndex);
    });
  }

  // §5.2: aria-modal="true" claims the background is inert, so keyboard focus must
  // not escape to it. While warming there are NO focusable controls, so Tab is a
  // no-op then (kept on the card); once the error actions appear, Tab cycles
  // between exactly the two buttons. This CONTAINS focus without ever trapping the
  // user — either button proceeds, and success navigates the whole page away.
  // Escape is deliberately unbound: a warm has no "cancel" (it must finish or
  // fail), and the visible Retry / Open anyway buttons are the only honest exits.
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = Array.from(
      card.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    ).filter((node) => node.offsetParent !== null);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return {
    el,
    update(event) {
      bar.style.width = `${Math.round(barFraction(event) * 100)}%`;
      status.textContent = statusText(event);
      markStages(STAGE_INDEX[event.key]);
    },
    fail(message, onRetry, onOpenAnyway) {
      // §5.3: unhide the role="alert" box FIRST, then write the text, so the
      // content mutation lands while the region is visible — that is what makes
      // assistive tech announce the failure reason and its consequence.
      errorBox.hidden = false;
      errorText.textContent = message;
      status.textContent = 'Could not warm the media engines.';
      const retry = el.querySelector<HTMLButtonElement>('[data-chronos-retry]')!;
      retry.onclick = onRetry;
      el.querySelector<HTMLButtonElement>('[data-chronos-open]')!.onclick = onOpenAnyway;
      // §5.2: move focus to the primary action so a keyboard / AT user lands on
      // something actionable instead of the now-stale progress card.
      retry.focus();
    },
    remove() {
      el.remove();
    },
  };
}

// ── Public entry ─────────────────────────────────────────────────────────────

let gateOpen = false;

function goToStudio(): void {
  window.location.assign(STUDIO_URL);
}

async function runGate(): Promise<void> {
  if (gateOpen) return;
  gateOpen = true;

  const overlay = buildOverlay();
  document.body.appendChild(overlay.el);
  overlay.el.querySelector<HTMLElement>('.chronos__card')?.focus();

  const attempt = async (): Promise<void> => {
    // Reset any prior error state on retry.
    const errorBox = overlay.el.querySelector<HTMLElement>('[data-chronos-error]');
    if (errorBox) errorBox.hidden = true;
    try {
      await withTimeout(warmEngines((event) => overlay.update(event)), GATE_TIMEOUT_MS);
      overlay.update({ key: 'opening' });
      goToStudio();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // §5.1: never trap the user. Retry re-warms; Open anyway proceeds un-warmed,
      // with the warning that names the real, invisible consequence (first-bake
      // timeout) sitting next to the button.
      overlay.fail(
        message,
        () => {
          void attempt();
        },
        () => {
          goToStudio();
        },
      );
    }
  };

  await attempt();
}

/**
 * Wire the hub's flagship CTA so a click warms the engines behind the gate instead
 * of navigating cold. Idempotent; a no-op if the CTA is absent.
 */
export function installDesignStudioGate(): void {
  const cta = document.querySelector<HTMLAnchorElement>('[data-design-studio-cta]');
  if (!cta) return;
  cta.addEventListener('click', (event) => {
    // Let modified clicks (new tab, etc.) behave normally — those users opt out of
    // the gate deliberately, and the studio still cold-loads safely, just slower.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void runGate();
  });
}
