> **Archive provenance:** Archived after the v6.0.0 stable checkpoint — 2026-07-23.
> Original living path: `docs/gif-animation-design-implementation.md`.
> Preserved as shipped-design history; the current background contract lives in `docs/design-studio.md`.

# Animated GIF Backgrounds — Finalized Development Plan

**Branch:** `animated` (small, contained feature branch off `main` @ v5 line)
**Codename:** `animated-gif-bg`
**Status:** Plan finalized 2026-06-26 · **Phase 1 done** (26db0d1) · **Phase 2 done** (f521bb8), awaiting QA · **Phase 3 next**
**Fallback tag for this sprint:** `v4.0.0` (last tagged `main` release; record a fresh tag before merge)

> This document supersedes the original FFmpeg-centric draft. The draft's core
> premise — "the FFmpeg transcode pipeline already integrates backgrounds, just
> unlock the gate and feed a looping GIF into FFmpeg" — does **not** match this
> codebase (see § Architectural Correction). The animation is driven on the
> **canvas**, not in FFmpeg. Decision locked by user 2026-06-26.

---

## Purpose

Let users import animated GIFs as personal backgrounds. The GIF loops smoothly in
the **live recorder canvas, the Design Studio preview, and the exported MP4** —
because all three are the same pixels. Minimal new surface area, zero changes to
the hardened transcode / voice / subtitle-burn-in pipeline.

---

## Architectural Correction (why the strategy changed)

The original draft assumed a post-process compositing model (overlay a looping GIF
under the waveform inside FFmpeg). This project does **not** work that way.

**This is a single-canvas WYSIWYG pipeline:**

1. `WaveformRenderer.drawFrame()` calls `drawThemeBackground(...)` **every frame**,
   painting the background (theme or personal image) directly onto the canvas
   — `src/recorder/waveform.ts`.
2. `canvas.captureStream(WAVEFORM_TARGET_FPS=24)` → `MediaRecorder` → WebM. **The
   background is baked into the pixels at capture time.**
3. `src/ffmpeg/ffmpeg-runner.ts` transcodes WebM→MP4 with **audio-only** filters
   (`-af` / `-filter_complex` for voice) and an optional **subtitle** burn-in pass.
   It has **no** background image/video input, no overlay, no `stream_loop`.
   FFmpeg never touches the background.

**Implication:** there is no "FFmpeg background path" to unlock. Routing a looping
GIF through FFmpeg would require *building* a brand-new compositing stage
(transparent canvas background + reliable VP8/VP9 alpha through `MediaRecorder` +
GIF overlay in FFmpeg) — high risk, touches the hardened export code, and breaks
the project's load-bearing **preview = recorder = MP4** guarantee.

**The native path is the one the draft dismissed.** The canvas *already* renders
time-driven animated backgrounds: `drawThemeBackground` receives
`{ timeMs, audioEnergy }` and the `bokeh` / `sparkle` / `twinkle` overlays animate
per frame (`src/theme/backgrounds.ts`; see `engineering-principles.md` "Cheap
per-frame flairs"). An animated GIF is the *same pattern*: advance a frame index by
elapsed time and `drawImage` the current frame. Chrome's `ImageDecoder` (WebCodecs)
decodes GIF frames natively, so no JS GIF parser is bundled, and the work lives in
the **page heap** — the ~32 MB WASM-heap limit (an FFmpeg constraint) does not apply.

### What this buys us

| Property | Canvas-native (chosen) | FFmpeg composite (rejected draft) |
|---|---|---|
| WYSIWYG (preview = recorder = MP4) | ✅ preserved | ❌ preview static, export animated |
| Export pipeline risk | ✅ none — FFmpeg untouched | ❌ rewrites transcode compositing |
| Relay / storage changes | ✅ none — relay already ships GIF bytes | needs payload + alpha plumbing |
| WASM 32 MB heap pressure | ✅ N/A (page heap) | ⚠️ a real concern |
| New cost | GIF frame decode + per-frame advance | transparent-canvas alpha capture (fragile) |

---

## Architectural Fit (foundation already present)

- `resolveMediaKindForMime('image/gif')` → `'animated'` (`src/storage/image-db.ts`).
- `BackgroundMediaKind`, `BACKGROUND_MIME_TYPES`, quotas (`MAX_SINGLE_IMAGE_BACKGROUND_BYTES`
  routes `'animated'` to the 8 MiB image cap via `maxBytesForKind`), `BackgroundAssetRecord`,
  the `mediaKind` IndexedDB index, and `pruneUnreferencedBackgrounds` /
  `reconcileBackgroundPreferences` are all id-based and **kind-agnostic**.
- Blob relay (`BACKGROUND_BLOB_PORT`, chunked base64) and the storage split
  (`chrome.storage.local` = id only, IndexedDB = blob + kind) already carry **any**
  byte payload, GIF included — **no protocol change** for animation.
- The import gate `BACKGROUND_IMPORT_ENABLED_KINDS` (currently `['image']`) is the
  only blocker for import. `probeImageDimensions` already decodes a GIF's **first
  frame** via `createImageBitmap`, so dimensions probe correctly today.

The only genuinely new code is a small **animated-background controller** that turns
GIF bytes into timed frames, plus per-frame frame-selection in the two RAF loops
(recorder + Studio preview).

---

## Development Phases

### Phase 1 — Enable import & schema polish · engine-independent · low risk (~1 h)

Identical regardless of animation engine, so it commits us to nothing and ships a
useful intermediate state (GIF imports + draws as a **static first frame** through
the existing canvas path).

- `src/storage/image-db-types.ts`
  - Add `'animated'` to `BACKGROUND_IMPORT_ENABLED_KINDS` → `['image', 'animated']`.
  - Refresh comments: animated GIFs are importable now; **video** stays gated.
- `src/storage/image-db.ts` — **no change required** (verified): `assertImportAllowed`
  + `maxBytesForKind` already route `'animated'` to the 8 MiB image quota,
  `probeImageDimensions` returns the GIF's first-frame size, and the disabled-kind
  message already reads correctly (only `'video'` can now reach the throw).
- `src/ui/popup/personal-background.ts`
  - Optional micro-polish: append a subtle **"· Animated"** tag to the library
    option label when `mediaKind === 'animated'` (label-only; no layout change).
- Docs note in `engineering-principles.md` / `design-studio.md`: GIF import enabled;
  animation arrives in Phase 2; **no fidelity gap** (canvas drives all three surfaces).

**Success criteria**
- GIFs import successfully, stored with `mediaKind: 'animated'`.
- First-frame dimensions probed correctly.
- Import / quota / prune / reconcile behavior unchanged.
- `tsc --noEmit` clean (modulo pre-existing warnings); `wxt build` green.

### Phase 2 — Canvas frame-animation engine · core work (~4–6 h)

**Goal:** decode GIF frames once, advance them by elapsed wall-clock time in the RAF
loops, and draw the current frame through the existing `drawThemeBackground` user
layer — so the recorder canvas, Studio preview, and captured MP4 all loop in sync.

1. **New `src/recorder/animated-background.ts`** — an `AnimatedBackground` controller:
   - `decodeAnimatedBackground(bytes, mimeType)` using WebCodecs `ImageDecoder`
     (`'image/gif'`); collect per-frame `ImageBitmap` + `duration` into a cumulative
     timeline; expose `frameAt(timeMs): DrawableBackgroundImage` (modulo total
     duration → seamless loop). Single-frame GIFs collapse to a static draw.
   - Memory guards: cap frame count / total decoded pixels; optionally downscale
     oversized GIFs; `dispose()` closes all `ImageBitmap`s on swap/stop.
   - Graceful fallback: decode failure → first frame only (existing static path).
2. **`src/storage/background-loader.ts`** — an animated-aware resolve that returns
   either a static `DrawableBackgroundImage` or an `AnimatedBackground`, in **both**
   contexts (extension page = local blob via `mediaKind`; content script = relayed
   bytes, branching on `mimeType === 'image/gif'`). Relay is unchanged.
3. **`src/recorder/waveform.ts`** — hold an `AnimatedBackground | null`; build it in
   `loadBackgroundIfNeeded` when the asset is animated; in `drawFrame`, select the
   current frame by `performance.now()` and pass it as `userBackgroundImage`. Respect
   `reduceMotion` (freeze on frame 0 — mirrors the existing `timeMs: 0` behavior).
4. **Design Studio preview loop** (`renderThemePreview` / preview block RAF) — same
   per-frame advance so the Studio preview animates (WYSIWYG parity).
5. No FFmpeg, relay, storage, prefs, dirty-tracking, or save-path changes.

**Success criteria**
- Recorder canvas, Studio preview, and exported MP4 all loop the GIF smoothly for
  the full recording, in sync.
- Position / fit-fill / dim overlay behave identically to static backgrounds.
- `reduceMotion` freezes to first frame everywhere.
- No regression on static image backgrounds; 24 fps draw budget holds.
- Decode failure falls back to static first frame with clear logging.

### Phase 3 — Integration, testing & docs (~2–3 h)

- Vary GIFs: short loop, long cycle, 1-frame, high-fps, near-8 MB, odd aspect ratios.
- Memory: max-size GIF + full-length recording; confirm `dispose()` eviction on swap.
- Confirm reduce-motion and the known **hidden-tab rAF freeze** behave consistently
  (animation pauses with the canvas, same as today's effects — not a new limitation).
- Doc polish in `engineering-principles.md`, `design-studio.md`, and
  `docs/architecture/architecture-map.md` (background flow now: animated canvas layer).
- Tag a stable checkpoint before merging `animated` → `main`.

**Success criteria:** feature feels complete; all manual QA passes incl. edge cases
and memory bounds; docs reflect the canvas-native reality (no fidelity gap).

---

## Risks & Mitigations

- **Large/many-frame GIF memory (page heap)** → frame-count / pixel cap + optional
  downscale; `dispose()` closes bitmaps on swap; fall back to static on cap breach.
- **`ImageDecoder` availability** → it's a Chrome global (MV3 target is Chrome);
  feature-detect and fall back to first-frame `createImageBitmap` if absent.
- **24 fps draw budget** → blitting a pre-decoded `ImageBitmap` is cheap; profile the
  recorder canvas at 24 fps before merge (same gate as bokeh/sparkle effects).
- **Hidden-tab freeze** → pre-existing, documented rAF behavior; animation simply
  pauses with the canvas. Consistent, not a regression.

---

## Out of Scope (this phase)

- Any FFmpeg-side compositing or transparent-canvas alpha capture.
- Video (`.mp4`/`.webm`) backgrounds — schema-ready but still gated.
- Frame-accurate GIF timing beyond the 24 fps capture cadence.

---

## References to Existing Patterns

- Single-canvas WYSIWYG + mid-recording hot-swap (`claude-progress.md`, "single-canvas WYSIWYG").
- Time-driven per-frame background effects: bokeh / sparkle / twinkle (`src/theme/backgrounds.ts`).
- Chunked blob relay & storage split (`engineering-principles.md` "Personal backgrounds — ImageDB").
- Stale-load generation guard in `loadBackgroundIfNeeded` (`src/recorder/waveform.ts`).
- `/code-review` gate + fallback-tag discipline before any merge (`docs/code-review.md`).
