> **Archive provenance:** Full living-file snapshot captured after the v6.0.0 stable checkpoint — 2026-07-23.
> Original path: `docs/transcription-architecture.md`. Phase chronology moved here; the current Vosk and subtitle-bake contract remains living.

# Transcription & subtitle-bake architecture

**Status:** Canonical Vosk/CSP and subtitle-bake reference, refreshed through **H13 QA hardening on v5.10.0** (2026-07-12). Read before changing transcription, overlay painting, composite strategy, partial splice, or trim/cue ownership.

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

## Layer model (current through v5.9)

Bottom → top in final MP4:

1. Background (canvas)
2. Audio bars (canvas)
3. Subtitles (post-base composite; default browser decode→shared painter→encode/mux, FFmpeg fallbacks retained)

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

Current capture fork (Studio or Reddit):

```
stopRecording()
  webmBlob (validated, retained for transcode)
  webmClone = blob.slice()
  ├─ transcodeWebmToMp4(webmBlob)     → base.mp4   [existing FFmpeg queue]
  └─ transcribeWebmBlob(webmClone)    → transcript [enqueueTranscribeJob]
```

Transcode and transcription dispatch concurrently but execute through independent serialized offscreen queues; STT never blocks recorder completion. Offscreen creation/dispatch is itself serialized to avoid the cold-start race in BUG-034.

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

**Terminal emission path (background-owned since BUG-038):**

```
forkTranscribeWebm() resolves (applied | fallback | timeout)
  └─ offscreen MSG_TRANSCRIBE_COMPLETE → background terminal owner
     prepareTranscribeCompletionForPersistence()  [transcribe-completion.ts]
     if NOT applied → classifyTranscribeFailure()  [transcribe-failure.ts]
        → 'no-speech' | 'inference-error' | 'empty-result' | 'timeout'
     buildScaffoldTranscriptResult(clipDurationSeconds)  [transcript-editing.ts]
        → evenly-timed empty slots (soft-hyphen ­ placeholder)
     background saveSessionTranscript(result|scaffold, jobId, metadata)
        → rvnSessionTranscript IDB commit
        → SESSION_TRANSCRIPT_READY_KEY (publish only after commit)
```

- **Classifier** (`transcribe-failure.ts`): no-speech is detected by `VOSK_NO_SPEECH_ERROR_MARKER` (the sandbox host *throws* on empty text, arriving as `fallback:true`); applied→null, timeout marker→timeout, fallback→inference-error, empty→no-speech, else→empty-result.
- **Clip duration** comes from the recorder timer and rides `TranscribeStartRequest.durationSeconds` into a background-only job context — no re-decode, no new storage key.
- **Tab-close survival (BUG-038):** terminal normalization/persistence and the 125 s watchdog live in the background service worker kept alive for the accepted relay job. Studio pagehide detaches while STT remains pending (including the post-transcode `stopped` window), so teardown does not emit CANCEL. The initiating page may disappear after ACK without dropping success or timeout. Explicit cancellation/supersession retires the context, so a late old COMPLETE cannot overwrite the newer take.
- **Studio resolve** (`subtitle-controls.ts deliveryStatusForSnapshot`): maps `error`/`isScaffolded` → `no-speech` | `failed` | `scaffolded`, short-circuits the pending timer, and opens the segment editor in scaffolding mode (red status strip + timed empty slots).

**Soft-hyphen placeholder (`­`, U+00AD):** empty scaffold slots carry a soft hyphen so they survive `.trim()`-based emptiness filters and persist through editing; everything blank-aware uses `cueTextIsBlank` / `stripScaffoldPlaceholder`. Empty slots bake to nothing (`usableSegments` skips them).

**Long-segment Smart Split** (`splitSegmentIntoChunks` + `src/utils/text-metrics.ts`): a long cue is split at word boundaries into chunks that each fit one caption line (canvas width measured with the live subtitle font). **v5.3.6:** editor overflow/Split uses `smartSplitCaptionMaxWidth()` (~1.5× preview line, `SMART_SPLIT_WIDTH_RELAXATION`) — less aggressive than v5.3.0–v5.3.5 now that canvas overlay removed the drawtext layer budget. Time span divided proportionally to chunk character length. Pure + node-tested (`scripts/test-smart-split.mjs`).

Pure modules are unit-tested without a framework via esbuild bundle + `node:assert`: `test-scaffold.mjs`, `test-transcribe-failure.mjs`, `test-smart-split.mjs`, `test-burnin-budget.mjs`, `test-bake-segments.mjs`, `test-bake-chronos.mjs`, `test-canvas-render-perf-guard.mjs`, `test-overlay-lab-segments.mjs`.

## Subtitle bake and composite paths (eloquent-3 → v5.9)

Production has a default rich path plus permanent fallbacks:

1. **Browser full composite (default since v5.5.1)** — decode clean base in Studio, invoke `createOverlayFramePainter` directly at every decoded frame PTS, Canvas2D blend, VideoEncoder + mediabunny mux. No overlay IVF/WebM and no FFmpeg hop.
2. **Verified partial re-bake splice (eligible re-bakes, default on since v5.7.0)** — copy kept packets from prior bake, re-composite dirty GOPs from clean base, then prove kept-region pixels match; any miss runs the full ladder.
3. **FFmpeg rich fallbacks** — dual-IVF WebCodecs overlay + alphamerge, then MediaRecorder overlay (parallel→serial + normalize) + overlay composite.
4. **`drawtext-font` fallback** — bundled DejaVu TTF with bounded degradation chain.

Historical `subtitles-srt` (libass) was removed in BUG-030.

### Shared-painter rich subtitle path (v5.3.4 foundation; v5.5 default executor)

**When selected:** `shouldPreferCanvasOverlay()` chooses the rich painter for canvas-only effects or sufficiently complex styles. Production bake runs in Design Studio (`subtitle-bake.ts` → `subtitle-canvas-bake.ts`). `experimental.browserComposite` defaults on, so the first attempt paints directly into decoded base frames; overlay-byte encoders run only after probe/error fallback.

**Default pipeline (Design Studio tab):**

```
prepareSegmentsForSubtitleBake()     [transcript-editing.ts — shared with drawtext]
  → renderBrowserComposite()       [browser-composite.ts]
       base MP4 decode → createOverlayFramePainter at exact base PTS
       → Canvas2D source-over blend → VideoEncoder → audio passthrough → MP4 mux
  → validate frame/packet count + duration → rvnLastBakedMp4
```

Fallback after browser probe/error: WebCodecs dual-IVF → FFmpeg alphamerge; then MediaRecorder overlay → normalize → FFmpeg overlay; then drawtext.

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

**Key module:** `subtitle-overlay-cue-cache.ts` — `CueOverlayCache` (64-entry LRU), `CUE_OVERLAY_CACHE_PHASE_BUCKETS = 24` (v5.3.8 Oklch), `hashSubtitleStyleForCueCache()`, `quantizeOverlayAnimationPhase()`.

**Animated hue (v5.3.8):** rainbow / monochromatic glow rotation uses perceptually uniform Oklch hue in `src/utils/oklch.ts` via `resolveCanvasOverlayGlowHex()` — replaces prior HSV rotation that required 32 phase buckets to mask uneven steps.

**Frame pacing (BUG-036 fix):** cache misses must not block MediaRecorder delivery. Miss path blits synchronously; `createImageBitmap` populates LRU in the background. `compensatedCaptureWaitMs()` keeps wall-clock frame spacing at `1/fps` after variable paint cost.

**Options:** `enableCueCache` (default true), `debug.onCacheStats` / `debug.logCacheStats`. Bypassed when `singleFrameDebug` is on. Returns `renderMetrics.cueCache` on `SubtitleOverlayResult`.

**Observed limits (QA 2026-07):** Sparse transcripts hit ~99% cache rate and stay at MediaRecorder pacing floor (~1.1× render realtime). Rich wave+hue styles generate many unique phase keys; LRU cap causes evictions on animated dense clips. Full bake total time remains normalize-dominated. Spec + harness data: `docs/5.3.5-cue-stable-overlay-caching-design.md` §5.

**QA harness:** gated **Subtitle Overlay Lab** in Design Studio (`subtitle-overlay-lab.ts`) — synthetic segment sets, effect toggles, compare, downloads, **timing JSON v3** (`overlay-lab-timing-summary.ts`), parallel A/B toggle (v5.3.9), WebCodecs A/B toggle (v5.3.10). Spec: `docs/v5.3.4-subtitle-canvas-overlay.md`; cache QA: `docs/5.3.5-cue-stable-overlay-caching-design.md`.

#### Parallel chunked bake (v5.3.9)

**The bottleneck was pacing, not paint.** The capture loop is wall-clock paced — MediaRecorder ingests canvas frames in real time (`compensatedCaptureWaitMs`), so a 60 s overlay takes ≥60 s regardless of paint speed, and the v5.3.5 cache already reduced paint to a bitmap blit. **No Web Workers:** MediaRecorder/captureStream cannot run in a worker, VP8 encode already runs on Chrome media threads, and shipping paint to a worker would add per-frame transfer latency into a loop that is ~90% idle. Instead, N paced capture loops run **concurrently on the Design Studio page**, multiplexing the idle wait for a ~N× render-stage speedup.

```
resolveParallelChunkCount()        [overlay-chunk-planner.ts — duration/cores/memory gate]
  → planOverlayChunks()           [frame-aligned, cue-gap boundaries, mid-cue slice fallback]
  → N × captureOverlayChunkRaw()  [subtitle-overlay-renderer.ts — concurrent, staggered 150 ms]
  → concatOverlayChunksForComposite() [overlay-chunk-concat.ts — v5.3.9.1: primary tier is
       stream-copy `-f concat` demuxer with per-file `outpoint` trim; decode+re-encode is fallback only]
  → normalizeOverlayWebmForComposite() [always runs — same as serial path]
  → runSubtitleBurnIn(...)         [composite unchanged]
```

**Determinism rule:** chunks paint at global timestamps `(startFrame + i) / fps` — the exact serial expression — so animation phase, cue timing, and cache keys are chunk-invariant (no seam hue jumps). Chunk boundaries prefer **cue gaps** (MediaRecorder duration jitter is ±1 frame per chunk; invisible when the seam is blank). Per-chunk `outpoint` / `trim=end=` drops tail-hold frames each capture appends, so seams add zero blank time and cue drift does not accumulate.

**Normalize (MediaRecorder paths only, v5.3.9.1):** concat stitches only; `normalizeOverlayWebmForComposite` runs afterward for serial and parallel MediaRecorder paths. **WebCodecs path (v5.3.10):** normalize **eliminated** — dual IVF streams are composite-ready by construction; `alphamerge` runs inside the burn-in graph. QA (2026-07-05): WebCodecs 60 s bake **46–50 s** sub-real-time vs legacy **228–310 s**.

#### WebCodecs overlay encode (v5.3.10) — **first FFmpeg-composite fallback**

```
plan chunks (same v5.3.9 planner)
  → per chunk: createOverlayFramePainter → dual VideoEncoder (VP8 color + alpha-as-gray)
  → pure-TS IVF concat (src/encoding/ivf.ts — ~ms stitch)
  → runSubtitleBurnIn via buildWebCodecsOverlayStrategies
       (alphamerge + calibrated lutyuv range expand + unpremultiply + overlay)
  → NO normalize stage
```

**Gating + fallback chain (combined):** `experimental.browserComposite` defaults to browser decode→direct painter→encode/mux. On probe/error fallback, `experimental.webCodecsBake` (default true) runs the capability + session-cached alpha-luma calibration probe → dual-IVF orchestrator → FFmpeg alphamerge. Any non-abort failure retries the full MediaRecorder path (parallel → serial → normalize → FFmpeg overlay), then the perf/error fallback is drawtext. Alphamerge failure never jumps directly to drawtext.

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
| `overlay-chunk-planner.ts` | v5.3.9 pure chunk planning: count heuristic, cue-gap boundaries, cache budget |
| `subtitle-overlay-parallel.ts` | v5.3.9 orchestrator: concurrent staggered captures, abort fan-out, serial fallback |
| `overlay-concat-args.ts` | v5.3.9 pure FFmpeg concat arg builder (leaf, Node-tested) |
| `overlay-chunk-concat.ts` | v5.3.9 concat exec: stream-copy demuxer (MediaRecorder path only) |
| `src/encoding/*` | v5.3.10: IVF mux/concat, WebCodecs dual encoder, calibration probe, segment model |
| `subtitle-overlay-webcodecs.ts` | v5.3.10 WebCodecs orchestrator (planner reuse, dual IVF output) |
| `overlay-alphamerge-args.ts` | v5.3.10 pure composite arg builder (alphamerge tiers) |
| `src/composite/browser-composite.ts` | v5.5+ default direct-painter composite (decode/blend/encode/mux) |
| `src/composite/composite-splice.ts` / `composite-fidelity.ts` | v5.7+ verified dirty-GOP re-bake |
| `src/editing/trim-apply.ts` | v5.9 base cut + dual-copy cue shift; next bake forced full |

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
| v5.3.9 Parallel chunked bake | Concurrent paced chunk captures + stream-copy concat + normalize; auto-gated, serial fallback | **Done** (`v5.3.9`) |
| v5.3.10 WebCodecs encode | Dual VP8 IVF + alphamerge composite; normalize eliminated on fast path | **Done** (`v5.3.10`) |
| v5.5.0 / v5.5.1 Browser composite | Direct base decode + shared-painter blend + encode/mux; default on | **Done** |
| v5.7.0 Partial re-bake | Verified dirty-GOP splice with full fallback | **Done** |
| v5.8.0 Timeline editor | Shared cue draft, frame-snap, waveform, trim preview/intent | **Done** |
| v5.9.0 Atomic trim | Shorter base + both transcript copies shifted; stale stamps dropped; full next bake | **Done / QA PASS** |

See `archive/progress/eloquent-branch.md` for full phase plan, `docs/design-studio.md` for Studio semantics, `docs/v5.3.4-subtitle-canvas-overlay.md` for canvas overlay phase spec, and `docs/5.3.5-cue-stable-overlay-caching-design.md` for cache design + QA record.

## Resume in a new chat (carry-forward)

```
Transcription/subtitle architecture refreshed through H13 + H14/BUG-038 on v5.10.0 (browser QA PASS, merged).
Vosk: extension page decodes PCM → null-origin sandbox → blob worker; MEMFS per session.
Capture: Studio or Reddit forks raw-clone STT from offscreen FFmpeg transcode; queues are independent.
BUG-038: background owns terminal transcript persistence + 125s watchdog; tab close cannot drop success/timeout.
Default bake: clean base decode → shared painter at exact PTS → Canvas2D blend → encode/mux in Studio.
Fallbacks: dual-IVF+FFmpeg → MediaRecorder+FFmpeg → drawtext; all remain supported.
Eligible re-bakes use verified dirty-GOP splice (I16); any miss runs the full ladder.
Timeline cue timing is frame-exact (I17); trim preview=APPLY shifts both transcript copies (I18).
Read docs/architecture/architecture-map.md v2.11 before changing contexts, stores, or pipelines.
```
