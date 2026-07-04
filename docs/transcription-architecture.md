# Transcription architecture (eloquent / v4)

Design audit for client-side Vosk STT in a Chrome MV3 extension (2026). Read before changing the transcription pipeline.

**Design Studio integration (Subtitles section):** `docs/design-studio.md` §7 — edit→confirm→bake UX, session IDB, and preview vs export fidelity.

## Problem statement

Add optional offline subtitles without breaking the stable path:

```
record → canvas WebM → FFmpeg transcode → attach/download MP4
```

## Chrome MV3 constraints (non-negotiable)

| Surface | CSP | `unsafe-eval` | `chrome.*` APIs | Typical origin |
|---------|-----|---------------|-----------------|----------------|
| **extension_pages** (popup, harness, offscreen, design-studio) | `script-src 'self' 'wasm-unsafe-eval'` | **Forbidden** | Yes | `chrome-extension://<id>` |
| **manifest sandbox** (`sandbox.pages`) | sandbox CSP with `'unsafe-eval'` + `worker-src blob:` | **Allowed** | **No** | Opaque / `null` in iframe |
| **content scripts** (reddit.com) | Page CSP + isolated world | N/A | Limited | `https://www.reddit.com` |
| **service worker** (background) | extension_pages equivalent | **Forbidden** | Yes | extension |

**Implication:** Vosk-browser (Emscripten `new Function()` + **blob Web Workers**) cannot run on extension_pages or in the main harness bundle. It must run inside a **manifest sandbox page** with both `'unsafe-eval'` and `worker-src blob:` (see BUG-010).

**Not the same as personal-background relay:** Image relay solved Reddit **page** CSP and MV3 **message size** limits via chunked base64 + `createImageBitmap`. Transcription solves **extension** CSP eval limits via sandbox isolation + `postMessage`.

## Per-step security & compatibility (sandbox path)

Each hop has **different** rules — fixes for one layer do not transfer.

| Step | Where | Origin / CSP | Requirement | Bug refs |
|------|-------|--------------|-------------|----------|
| WebM decode | Extension page | `chrome-extension://` | Web Audio only; no eval | — |
| PCM relay | `postMessage` + transferable | cross null ↔ extension | `targetOrigin: '*'`; validate `event.source` | — |
| Sandbox document | `vosk-sandbox.html` | null + sandbox CSP | Static bundle; no Vite HMR localhost | eloquent-0 |
| Main-thread Vosk | sandbox JS | `unsafe-eval` OK | esbuild UMD→ESM unwrap | BUG-012 |
| Worker spawn | blob worker | `worker-src blob:` | Cannot use `chrome-extension://` worker URL from null parent | BUG-010, BUG-013 |
| Worker IDBFS | blob:null worker | no IndexedDB | Non-fatal sync; MEMFS per session | BUG-011, BUG-013 |
| Model URL | worker fetch | blob:null base invalid | Parent passes **absolute** `chrome-extension://…/vosk/model.tar.gz` | BUG-014 |
| Model bytes | worker XHR/fetch | WAR | `vosk/*` in `web_accessible_resources` | wxt.config |
| Inference | worker WASM | sandbox CSP | Pace `acceptWaveformFloat` chunks; drain before `retrieveFinalResult`; wait for final `result` | BUG-015 |
| PCM validate | decode + relay | — | `assertPcmUsable` at decode, client send, sandbox receive | BUG-015 |

**Viability (eloquent-0):** Yes, with the patched sandbox + blob-worker path above. It is **not** drop-in vosk-browser; each null-origin sharp edge needs an explicit build-time or protocol patch. Long-term, extension-origin offscreen + different Vosk packaging may be cleaner if IDBFS caching or worker ergonomics become requirements.

## Layer model (compositing — unchanged from v4 design)

Bottom → top in final MP4:

1. Background (canvas)
2. Audio bars (canvas)
3. Subtitles (FFmpeg burn-in pass — eloquent-3+)

STT reads **raw audio** from cloned WebM (not voice-modulated export).

## Pipeline (eloquent-0 implemented)

```
┌─────────────────────────────────────────────────────────────────┐
│ Extension page (transcribe-harness / future offscreen client)   │
│  CSP: wasm-unsafe-eval only                                     │
│                                                                 │
│  1. WebM blob (recorder capture)                                │
│  2. decodeWebmToMonoPcm() — Web Audio, no eval                  │
│  3. hidden <iframe src="vosk-sandbox.html">                     │
│  4. postMessage({ samples, modelUrl }) ───────────────┐         │
└───────────────────────────────────────────────────────│─────────┘
                                                        │
┌───────────────────────────────────────────────────────▼─────────┐
│ Manifest sandbox: public/vosk-sandbox.html                        │
│  CSP: unsafe-eval allowed                                         │
│  Origin: opaque (null) — do NOT rely on event.origin matching     │
│                                                                   │
│  public/vosk-sandbox.js (esbuild bundle, ~6 MB, vosk-browser)     │
│  5. load Vosk model from vosk/model.tar.gz (extension URL)        │
│  6. acceptWaveformFloat → segments                                │
│  7. postMessage({ TranscriptResult }) ──────────────────┐         │
└─────────────────────────────────────────────────────────│─────────┘
                                                          │
┌─────────────────────────────────────────────────────────▼─────────┐
│ Extension page receives result (validate event.source === iframe)   │
└─────────────────────────────────────────────────────────────────────┘
```

Parallel future path (eloquent-1):

```
stopRecording()
  webmBlob (validated, retained for transcode)
  webmClone = blob.slice()
  ├─ transcodeWebmToMp4(webmBlob)     → base.mp4   [existing FFmpeg queue]
  └─ transcribeWebmBlob(webmClone)    → transcript [enqueueTranscribeJob]
```

**Never** run FFmpeg and Vosk concurrently until memory is profiled (~32 MB FFmpeg heap + ~40 MB model).

## Memory & worker isolation

| Component | Queue / isolation |
|-----------|-------------------|
| FFmpeg | `enqueueTranscodeJob` — single offscreen worker |
| Vosk | `enqueueTranscribeJob` — separate serialized queue |
| Vosk WASM worker | vosk-browser blob worker inside sandbox (`worker-src blob:`); IDBFS sync non-fatal — MEMFS per session (BUG-013) |

Model load is **opt-in** (eloquent-4 UI); not at extension startup.

## Why not WXT `entrypoints/vosk.sandbox`?

WXT dev mode injects Vite HMR scripts (`http://localhost:*/@vite/client`) into HTML entrypoints. Manifest sandbox pages load with **opaque/null origin** and cannot fetch localhost scripts (CORS). Production WXT build works; **dev breaks**.

**Fix:** Static sandbox shipped from `public/`:

- `public/vosk-sandbox.html` — listed in `manifest.sandbox.pages`
- `public/vosk-sandbox.js` — esbuild bundle via `npm run build:vosk-sandbox`
- Rebuild after changing `vosk-sandbox-host.ts` or upgrading `vosk-browser`; reload extension

## postMessage security model

Sandbox iframe has opaque origin — **do not** compare `event.origin` to `location.origin`.

| Direction | Trust model | targetOrigin |
|-----------|-------------|--------------|
| Parent → sandbox | `event.source === window.parent` (in sandbox) | `'*'` |
| Sandbox → parent | `event.source === iframe.contentWindow` (in parent) | `'*'` |

PCM buffers use `postMessage` **transferable** `ArrayBuffer` (no base64 chunking needed for ≤2:00 16 kHz mono ≈ 8 MB).

## File map

| File | Role |
|------|------|
| `src/transcription/decode-webm-audio.ts` | WebM → mono 16 kHz PCM (extension page) |
| `src/transcription/vosk-sandbox-client.ts` | iframe bridge (extension pages) |
| `src/transcription/vosk-sandbox-host.ts` | Vosk inference (sandbox only) |
| `src/transcription/vosk-sandbox-entry.ts` | esbuild entry |
| `scripts/build-vosk-sandbox.mjs` | Bundle host → `public/vosk-sandbox.js` |
| `public/vosk-sandbox.html` | Manifest sandbox shell |
| `scripts/fetch-vosk-model.mjs` | Model → `public/vosk/model.tar.gz` |
| `entrypoints/transcribe-harness/` | Manual QA |
| `src/messaging/types.ts` | `MSG_TRANSCRIBE_*` (eloquent-1 wire) |

## Dev workflow

```bash
npm install                    # model + vosk-sandbox.js + ffmpeg
npm run dev                    # WXT dev server
# After editing vosk-sandbox-host.ts:
npm run build:vosk-sandbox && reload extension at chrome://extensions
```

Open `transcribe-harness.html` → load WebM from recorder → Transcribe.

## Graceful failure emission & timecode scaffolding (v5.3 subtitle QoL)

Before v5.3 a Vosk no-speech / empty / inference error left the Studio stuck on amber "Pending" until the 120 s timeout (silent failure). Now every transcribe outcome resolves to a persisted, explicit state.

**Emission path (content script):**

```
forkTranscribeWebm() resolves (applied | fallback | timeout)
  └─ if NOT applied → classifyTranscribeFailure()  [transcribe-failure.ts]
        → 'no-speech' | 'inference-error' | 'empty-result' | 'timeout'
     buildScaffoldTranscriptResult(clipDurationSeconds)  [transcript-editing.ts]
        → evenly-timed empty slots (soft-hyphen ­ placeholder)
     relaySaveSessionTranscript(scaffold, jobId, { error, isScaffolded:true })
        → MSG_SAVE_SESSION_TRANSCRIPT → background saveSessionTranscript()
        → rvnSessionTranscript IDB (carries error + isScaffolded) + SESSION_TRANSCRIPT_READY_KEY
```

- **Classifier** (`transcribe-failure.ts`): no-speech is detected by `VOSK_NO_SPEECH_ERROR_MARKER` (the sandbox host *throws* on empty text, arriving as `fallback:true`); applied→null, timeout marker→timeout, fallback→inference-error, empty→no-speech, else→empty-result.
- **Clip duration** comes from the recorder timer (`elapsedSeconds`, matches `LAST_RECORDING_READY_KEY` meta) — no re-decode, no new storage.
- **Studio resolve** (`subtitle-controls.ts deliveryStatusForSnapshot`): maps `error`/`isScaffolded` → `no-speech` | `failed` | `scaffolded`, short-circuits the pending timer, and opens the segment editor in scaffolding mode (red status strip + timed empty slots).

**Soft-hyphen placeholder (`­`, U+00AD):** empty scaffold slots carry a soft hyphen so they survive `.trim()`-based emptiness filters and persist through editing; everything blank-aware uses `cueTextIsBlank` / `stripScaffoldPlaceholder`. Empty slots bake to nothing (`usableSegments` skips them).

**Long-segment Smart Split** (`splitSegmentIntoChunks` + `src/utils/text-metrics.ts`): a long cue is split at word boundaries into chunks that each fit one caption line (canvas width measured with the live subtitle font). **v5.3.6:** editor overflow/Split uses `smartSplitCaptionMaxWidth()` (~1.5× preview line, `SMART_SPLIT_WIDTH_RELAXATION`) — less aggressive than v5.3.0–v5.3.5 now that canvas overlay removed the drawtext layer budget. Time span divided proportionally to chunk character length. Pure + node-tested (`scripts/test-smart-split.mjs`).

Pure modules are unit-tested without a framework via esbuild bundle + `node:assert`: `test-scaffold.mjs`, `test-transcribe-failure.mjs`, `test-smart-split.mjs`, `test-burnin-budget.mjs`, `test-bake-segments.mjs`, `test-bake-chronos.mjs`, `test-canvas-render-perf-guard.mjs`, `test-overlay-lab-segments.mjs`.

## Subtitle burn-in render paths (eloquent-3+)

Production has **two** bake families:

1. **`drawtext-font` + bundled `DejaVuSans.ttf`** (`subtitle-burnin.ts`) — default / fallback; budgeted **degradation chain** (see below).
2. **Canvas overlay + cheap composite** (v5.3.4) — offline Canvas 2D → transparent WebM → `normalizeOverlayWebmForComposite` → single `overlay=0:0` FFmpeg filter. No per-cue drawtext layer explosion.

Historical `subtitles-srt` (libass) was removed in BUG-030.

### Canvas overlay path (v5.3.4)

**When selected:** `shouldPreferCanvasOverlay()` in `subtitle-burnin.ts` auto-picks canvas when `useCanvasOverlay` is set, when `subtitleStyleHasCanvasOnlyEffects()` (dual border, hue rotate, text gradient/wave), or when glow is enabled and cue count exceeds `CANVAS_OVERLAY_AUTO_CUE_THRESHOLD` (6). Production bake runs in Design Studio (`subtitle-bake.ts` → `subtitle-canvas-bake.ts`); drawtext tiers remain fallback when overlay bytes are absent or render perf guard aborts.

**Pipeline (Design Studio tab — needs `document`, `MediaRecorder`, `FontFace`):**

```
prepareSegmentsForSubtitleBake()     [transcript-editing.ts — shared with drawtext]
  → renderSubtitleOverlay()        [subtitle-overlay-renderer.ts — 30 fps paint + capture]
  → normalizeOverlayWebmForComposite() [overlay-webm-finalize.ts — libvpx yuva420p pre-pass]
  → runSubtitleBurnIn(useCanvasOverlay, canvasOverlayBytes) [ffmpeg-runner / offscreen or in-tab]
       filter: [1:v]format=yuva420p[ol];[0:v][ol]overlay=0:0:shortest=1[vout]
```

**Rich effects live in canvas only** — `subtitle-effects.ts` exports `resolveCanvasOverlayGlowHex`, `buildCanvasOverlayHaloLayerSpecs`, text gradient helpers, etc. Drawtext uses simpler `resolveGlowColorHex` + `buildGlowLayerSpecs` (static rings, no hue rotate / dual border / gradient wave). **Sync rule:** any new subtitle visual effect must declare whether it is canvas-only (`subtitleStyleHasCanvasOnlyEffects`) or needs drawtext parity.

**Segment prep:** `prepareSegmentsForSubtitleBake()` is the single source for blank/scaffold filter, missing timings, min cue duration, and clip clamp — used by drawtext normalize, overlay renderer, production bake, lab compare, and canvas bake.

**Perf guard (Phase 5.3):** production bake aborts offline render past a 2.5–3 min budget (`canvas-render-perf-guard.ts`) and falls back to drawtext. Guard covers **render only**; VP8A normalize can exceed render time on long clips (see perf notes in `docs/v5.3.4-subtitle-canvas-overlay.md` and `docs/future-ideas.md` § Canvas Subtitle Bake Performance).

#### Cue-stable overlay caching (v5.3.5)

**Goal:** Skip redundant `paintCue` work when cue identity, style, and quantized animation phase are unchanged across frames.

**Flow (inside `recordOverlayTimeline` → `paintFrame`):**

```
cuesAtTimestamp(timestamp)
  → per cue: makeCueOverlayCacheKey(cue, style, themeBar, timestamp)
  → cache hit  → paintCtx.drawImage(ImageBitmap)
  → cache miss → paintCue on temp OffscreenCanvas → createImageBitmap → LRU store
```

**Key module:** `subtitle-overlay-cue-cache.ts` — `CueOverlayCache` (64-entry LRU), `CUE_OVERLAY_CACHE_PHASE_BUCKETS = 32`, `hashSubtitleStyleForCueCache()`, `quantizeOverlayAnimationPhase()`.

**Options:** `enableCueCache` (default true), `debug.onCacheStats` / `debug.logCacheStats`. Bypassed when `singleFrameDebug` is on. Returns `renderMetrics.cueCache` on `SubtitleOverlayResult`.

**Observed limits (QA 2026-07):** Sparse transcripts hit ~99% cache rate and stay at MediaRecorder pacing floor (~1.1× render realtime). Rich wave+hue styles generate many unique phase keys; LRU cap causes evictions on animated dense clips. Full bake total time remains normalize-dominated. Spec + harness data: `docs/5.3.5-cue-stable-overlay-caching-design.md` §5.

**QA harness:** gated **Subtitle Overlay Lab** in Design Studio (`subtitle-overlay-lab.ts`) — synthetic segment sets, effect toggles, compare, downloads, **timing JSON v2** (`overlay-lab-timing-summary.ts`). Spec: `docs/v5.3.4-subtitle-canvas-overlay.md`; cache QA: `docs/5.3.5-cue-stable-overlay-caching-design.md`.

| Module | Role |
|--------|------|
| `subtitle-overlay-renderer.ts` | Paint loop, MediaRecorder, cue cache fast path, preview/bake entry |
| `subtitle-overlay-cue-cache.ts` | Cache keys, phase buckets, LRU `ImageBitmap` store (v5.3.5) |
| `subtitle-overlay-fonts.ts` | DejaVu FontFace loading |
| `overlay-webm-finalize.ts` | VP8 remux / yuva normalize before composite |
| `subtitle-canvas-bake.ts` | Dev + production canvas bake orchestration |
| `subtitle-overlay-compare.ts` | Side-by-side drawtext vs canvas QA |
| `subtitle-overlay-lab.ts` | Persistent lab panel + timing logs |
| `overlay-lab-timing-summary.ts` | Timing JSON v2 `summary` builder (v5.3.5) |
| `canvas-render-perf-guard.ts` | Render budget + drawtext fallback |
| `bake-chronos.ts` | Elapsed / ETA meter on production bake |

| Capability | `drawtext` + bundled TTF | Canvas overlay (v5.3.4) | `subtitles` + SRT/ASS (libass) |
|------------|--------------------------|-------------------------|--------------------------------|
| Timed cues | `enable='between(t,start,end)'` per cue | Per-frame paint at 30 fps | Native ASS timing |
| Backdrop / glow / border | Stacked drawtext duplicate layers (`GlowRingMode`) | Real `shadowBlur`, strokes, gradients | ASS styles |
| Dual border / hue rotate / gradient wave | **No** — canvas-only triggers auto-select | **Yes** | Theoretically yes |
| Layer budget | ~64 drawtext filters (BUG-035) | None (paint passes) | Style-based |
| Animated color (`\t()`, rainbow) | **Removed (v5.3)** — static per cue | Per-frame hue rotate at overlay fps | Theoretically smooth |
| ffmpeg.wasm fonts | `fontfile=` to wasm virtual FS | Overlay is pre-rendered video | Needs libass + fontsdir |
| Failure mode when misconfigured | Log needles + thrown error (BUG-030) | Normalize/composite throw; render perf → drawtext fallback | **Exit 0, no visible subs** (BUG-025) |

**Filtergraph budget + degradation chain (BUG-035):** the graph scales as cues × glow-ring layers, and ffmpeg.wasm aborts past ~70 drawtext filters (640×360). `buildBurnInStrategies` builds tiers `drawtext-glow` (soft halo, `single` ring ≈9 glow/cue) → `drawtext-glow-min` (`min` ring ≈4/cue) → `drawtext-plain`, dedupes, and keeps those within `MAX_BURNIN_DRAWTEXT_LAYERS = 64` (richest-in-budget first). `burnInWithStrategies` reloads a fresh wasm instance per tier, so a tier that still OOMs degrades instead of hard-failing. `blurRadius` controls ring **spread**, not layer count (`buildGlowLayerSpecs` `GlowRingMode`), so glow cost is flat.

**Headroom / rules:**

- Keep the per-cue layer budget in mind for any new glow/effect — cost is cues × layers; prefer flat-cost ring modes over stacked rings.
- `textfile=` per cue (BUG-031) — punctuation-safe; keep using this pattern.
- Empty scaffold slots are excluded from the graph (`usableSegments` / `cueTextIsBlank`).
- Revisit libass only via **isolated harness** — confirm wasm build includes libass, bundle fonts, validate pixels; do not restore silent fallback.

Full bug timeline: `docs/bug-archive.md` BUG-025, BUG-028, BUG-030, BUG-031, BUG-034, BUG-035.

## Phase status

| Phase | Scope | Status |
|-------|-------|--------|
| eloquent-0 | Spike, types, harness, sandbox architecture | **Done** |
| eloquent-1 | Parallel wire from `stopRecording()` | **Done** |
| eloquent-2 | Design Studio Subtitles panel + preview | **Done** |
| eloquent-3 | FFmpeg subtitle burn-in | **Done** |
| eloquent-4 | Studio editor polish + relay hardening | **Partial** (`v3.6.0`) |
| v5.3 Subtitle QoL | Graceful failure → scaffold, Smart Split, per-cue delete, bake budget, rainbow removed | **Done** (`subtitle-qol-failure-scaffold-v1`) |
| v5.3.4 Canvas overlay | Offline Canvas 2D overlay WebM + alpha composite; lab harness; perf guard | **Done** (`v5.3.4`) |
| v5.3.5 Cue-stable cache | `ImageBitmap` LRU cache per cue/phase; timing JSON v2; 32 phase buckets | **Done** (`v5.3.5`) |

See `eloquent-branch.md` for full phase plan, `docs/design-studio.md` for Studio semantics, `docs/v5.3.4-subtitle-canvas-overlay.md` for canvas overlay phase spec, and `docs/5.3.5-cue-stable-overlay-caching-design.md` for cache design + QA record.