# `pretty` branch — visual polish & personalization

**MERGED → `main` as v2.0.0 (2026-06-21).** This document is the historical phase plan and engineering record for the v2 release. Active stable development continues on **`main`**; `pretty` is retained as a merged branch reference.

**Current Studio semantics:** `docs/design-studio.md` — canonical Bar style / Background behavior. This file is historical when the two disagree.

**Prior:** `main` v1.5.0 (MVP themes + pipeline). **`pretty`** shipped v1.6.0–v2.0.0 gate (pretty-0 through pretty-9).

## Goal

Give yourself and friends a **quick, easy, visually appealing** way to leave personalized voice notes on Reddit — without sacrificing the lean, stable recording → transcode → attach flow the MVP already has.

## North star

> Personalized voice clips that feel intentional and fun, not generic screen recordings.

Prioritize features with **mass appeal and high impact**. Skip niche effects that cost CPU or add fragility.

**v2.0 gate (on `pretty`):** Ship **pretty-7** (personal image backgrounds) and **pretty-8** (light design studio) before tagging **v2.0** and merging to `main`. **pretty-9** is perf validation and merge readiness only.

## Focus areas

### Waveform (live preview + baked into output video)

- Bar styling: width, spacing, corner radius, glow, symmetry, idle vs active motion — **layout fields (count, spacing, width) deferred**; see pretty-8 for color + light effects only
- Color palettes and user-selectable themes (including high-contrast / colorblind-safe options)
- Canvas-only tricks: gradients, layered fills, simple particle/sparkle accents, eased bar heights — no heavy shaders

### Video background (finished MP4 / live canvas)

- Solid presets, gradients, and **optional image / GIF / subtle loop** backgrounds for personalized clips
- Safe areas so waveform bars stay readable on busy backgrounds
- Consider blur/dim overlay on photo backgrounds (cheap `drawImage` + semi-transparent rect)

### Finished media polish

- Consistent framing between preview and exported MP4 (what you see ≈ what Reddit gets)
- Optional subtle branding/watermark slot (off by default)
- Sensible defaults so first-time users look good without configuring anything

### UI chrome (recorder panel, toasts, popup)

- Align recorder UI with chosen theme
- Settings surface for theme/background picks (extend existing popup patterns in `src/settings/`)

### Accessibility & edge cases

- High-contrast themes; don't rely on color alone for state (recording vs idle vs error)
- Readable bar motion at low mic levels (silence shouldn't look "broken")
- Respect `prefers-reduced-motion` where possible (static or simplified waveform)
- Background images: size limits, load failures, CORS/extension URL handling — always fall back to default theme
- Keep transcode time in mind: longer clips + heavy canvas effects = larger WebM; profile before adding per-frame work

## Engineering constraints

Read **`docs/engineering-principles.md`** before pipeline or settings work.

| Rule | Rationale |
|------|-----------|
| **Semantic health checking** | Progress/stall/timeouts must track real work-state, not syntactic pings (see BUG-006) |
| **Ideally constrained settings** | Quality toggles use `ideal` constraints + graceful fallback ladders |
| **HTML Canvas first** | Waveform + background already live here (`src/recorder/waveform.ts`) |
| **Stay near 24 fps** | `WAVEFORM_TARGET_FPS` — don't raise without measuring transcode impact |
| **Cheap per frame** | Reuse gradients/paths; avoid full-canvas `getImageData` every frame |
| **Lean dependency footprint** | No new runtime deps unless unavoidable |
| **Stable over flashy** | Feature-flag or preset-gate experimental looks |
| **MVP paths untouched when possible** | Theme = data driving existing draw calls, not parallel recorders |

## Likely touch points

```
src/recorder/waveform.ts      # draw loop, themes
src/recorder/voice-recorder.ts # canvas stream → MediaRecorder (preview = output)
src/ui/tokens.ts              # shared colors / spacing
src/ui/recorder-panel.ts      # live UI theming
src/settings/                 # persist user theme/background choices (ids only)
src/storage/                  # ImageDB blobs + ref reconcile/prune (pretty-7a)
entrypoints/popup/            # quick settings (presets, profiles, image pick)
entrypoints/design-studio/    # light design studio popup (pretty-8)
src/ui/design-studio/         # color pickers, radial knobs, preview blocks, exit guard
src/settings/preset-profiles.ts # virtual preset-* profiles (recorder popup)
src/theme/background-layout.ts  # personal bg fit/fill + position
src/theme/                    # presets + future override merge for studio output
```

## Out of scope (for now)

- Re-architecting FFmpeg pipeline
- Server-side rendering or external APIs
- Keyboard shortcut reinstatement (separate concern; stays disabled on MVP `main`)

## Future audio pipeline & settings (pretty branch tracking)

These items are prepared or designed-for but not activated in the current sprint:

- **Browser audio processing toggle** (`rawMicCapture` in `rvnUserPrefs`): Default **on** (economy). Live in Audio settings (pretty-3). Implementation in `src/recorder/mic-constraints.ts` via `acquireMicStream()` with `OverconstrainedError` fallback ladder. Applies on next recorder open.
- **Enhanced capture toggle** (`preferHighQualityCapture`): Default **off** (browser sample rate/channels). When on, requests **ideal** 48 kHz + ideal stereo, degrading to mono / browser defaults. Live in pretty-3; applies on next recorder open.
- **Waveform bar vertical alignment**: Center-mirrored (current), bottom-aligned (classic spectrum), and top-aligned will be user-selectable settings (future UI surface similar to theme picker). The draw code in waveform.ts is being structured to support switching the bar anchoring/positioning without large refactors.
- **Voice modulation / recorder profiles**: The analysis + recording pipeline should remain extensible. Do not lock out future addition of processing graphs, profile classes, or modulation nodes if voice effects are added later.
- **Full-spectrum / music mode** (`fullSpectrumViz`): Default off — voice-focused 80 Hz – 16 kHz. Toggle in Audio settings (pretty-3) widens to ~20 Hz – nyquist; hot-swaps live during recording like themes.

These notes are intentionally recorded here so decisions about defaults vs. options can be made after testing.

## Version 2 phase plan (`pretty` branch)

`main` = v1 MVP (recording pipeline). `pretty` = v2 (beautification + settings hub). Phases are sequential; later phases assume earlier storage/UI scaffolding.

| Phase | Name | Scope | Status |
|-------|------|-------|--------|
| **pretty-0** | Theme foundation | Theme model, 5 bundled presets, canvas draw refactor, persistence normalization, `rvnUserPrefs` v1 scaffold | Done |
| **pretty-1** | Popup — clip appearance | Theme picker, static canvas preview (same draw path as output), bar alignment; synced with recorder panel | Done (in `v1.5.0`) |
| **pretty-2** | Popup — full settings shell | Section cards for Audio, Recording, Notifications; disabled placeholders for unreleased toggles; reduced-motion; audio capture profile + constraint scaffold | Done |
| **pretty-3** | Audio & viz toggles | Enable raw mic + enhanced capture toggles, full-spectrum/music viz mode, help tooltips | Done |
| **pretty-4** | Accessibility & themes | High-contrast / colorblind-safe presets, `prefers-reduced-motion` waveform, contrast pass | Done |
| **pretty-5** | UI chrome | Recorder panel + toast theming aligned with active clip style | Done |
| **pretty-6** | Named profiles | User-saved theme combos (beyond built-in presets) in `rvnUserPrefs` | Done |
| **pretty-7a** | ImageDB — storage layer | IndexedDB for user background blobs (too large for `chrome.storage.local`); import/size limits; migration hooks in prefs | Done |
| **pretty-7b** | ImageDB — canvas integration | Draw user images to live canvas during record (not post-composite); fit/fill + position + dim overlay; fallback on load failure | Done |
| **pretty-7c** | ImageDB — popup UI | Pick / upload / remove personal backgrounds; preview in popup; assign to profile or active theme | Done |
| **pretty-8** | Light design studio | Design Studio shell, personal bg WYSIWYG, HSV/HEX custom styles, bokeh/sparkle/glow, dual preview, radial color controls, fit/fill bg layout, virtual preset profiles (recorder), studio exit guard | Done |
| **pretty-9** | Perf & merge readiness | Transcode dup-storm fix, cap QA, prod zip verify, merge to `main`, tag **v2.0.0** | Done |

### Milestone: `pretty-8-design-studio-prototype` (2026-06-20)

**Tagged on `pretty` branch.** Initial working Design Studio prototype: upload/pick personal backgrounds in studio, live preview, and **matching output on the Reddit recorder canvas** (no console errors in QA).

**Why this was the hardest engineering problem so far:** Crossing the extension ↔ page boundary with multi-MB image blobs while preserving single-canvas WYSIWYG. Extension pages use ImageDB directly; Reddit content scripts require a background-worker relay with chunked base64 (MV3 message size limits), CSP-safe decode (`createImageBitmap` / blob URLs), and race-free async loading in `WaveformRenderer`.

**Key files:** `src/storage/background-loader.ts`, `src/messaging/background-blob.ts`, `entrypoints/background.ts`, `src/recorder/waveform.ts`, `src/theme/backgrounds.ts`, `entrypoints/design-studio/`.

**Completed after prototype tag (2026-06-21):** HSV/HEX custom clip styles (`customStyleId` + `designOverrides` on profiles), bokeh/sparkle/glow effect toggles, personal background **fit/fill + position** controls, Design Studio layout polish (profile bar above preview, dual preview canvases, radial hue ring + 360° sat/brightness dials), virtual **preset profiles** for recorder popup, studio exit guard for unsaved changes.

**Still before v2.0 merge:** pretty-9 transcode fix (see below), cap profiling, prod bundle verify.

### ImageDB notes (pretty-7)

- Personal backgrounds are **drawn to the canvas during capture** — preview = output, same as bundled presets today.
- **Two-layer storage:** blobs in **IndexedDB** (`rvnImageDb` / `backgrounds` store); prefs hold only `bg-…` ids + profile refs (`appearance.customBackgroundId`, `ClipProfile.customBackgroundId`).
- **pretty-7a (done):** `src/storage/image-db.ts` — import, quotas, list/get/delete, object-URL cache; `background-refs.ts` — reconcile stale prefs refs, prune orphans. Image import only; video MIME reserved behind `import_disabled` until loop canvas support.
- **Limits (7a):** 8 MB/image, 24 assets, 64 MB total; 15 MB reserved cap for future video/loops.
- **7b (done):** `resolveClipBackgrounds()` + `setCustomBackgroundId()` hot-swap personal images on live canvas and popup preview; **fit** (letterbox with theme+effects in gaps) vs **fill** (crop); position top/left/center/right/bottom (`backgroundScaleMode`, `backgroundPosition` on prefs + profiles); 35% dim; missing blob falls back to theme background. Key files: `src/theme/background-layout.ts`, `src/theme/backgrounds.ts`, `src/ui/design-studio/background-layout-controls.ts`.
- **7c (done):** Popup upload/pick/delete in Clip appearance; profiles persist `customBackgroundId`; library quota hint.
- **7d / relay (done, prototype tag):** Chunked base64 blob relay (`BACKGROUND_BLOB_PORT` + meta/chunk messages) from background worker to Reddit content script; CSP-safe decode; recorder canvas matches Design Studio preview.

### QA finding: live theme swap during recording (2026-06)

**Verified safe.** Changing theme via the extension settings popup mid-recording updates the canvas and bakes into the MP4. Comment-panel theme picker stays locked during recording (`recorder-panel.ts`) — UI guard only.

**Mechanism (intentional architecture, not accidental):**

| Piece | Role |
|-------|------|
| `saveAppearancePreferences()` | Writes `rvnUserPrefs` to `chrome.storage.local` |
| `onUserPreferencesChanged()` | Cross-context listener (popup ↔ content script) |
| `VoiceRecorderSession` prefs hook | Calls `waveform.setTheme()` / `setBarAlignment()` while recording |
| `WaveformRenderer.drawFrame()` | Reads current theme every RAF tick |
| `canvas.captureStream()` | MediaRecorder encodes whatever the canvas drew each frame |

**Takeaway:** IndexedDB user images should plug into `loadBackgroundIfNeeded()` + the existing prefs listener — same hot-swap model as bundled SVG backgrounds. No recorder restart required.

### Light design studio (pretty-8) — scope & UX

A **very light** design suite ships **before v2.0**. It extends named profiles and bundled presets with user-chosen **colors** and a small set of **canvas flairs**, without reopening waveform layout or analysis logic.

#### In scope (pretty-8)

| Area | Examples |
|------|----------|
| **Colors** | Bar fill, glow, optional background tint — via simple **HEX** fields and/or compact **HSV** sliders |
| **Background flairs** | Toggle bundled **bokeh**; optional preset accents (e.g. **star twinkle**, soft sparkle) using existing canvas draw paths — no new shaders |
| **Persistence** | Overrides stored on **saved profiles** (and/or a `designOverrides` blob merged atop a base preset); hot-swap safe mid-recording like themes |
| **Preview** | Same canvas draw path as output (`renderThemePreview` / `WaveformRenderer`) |

#### Explicitly out of scope (pretty-8 and until revisited)

- **Bar count**, **bar spacing**, **bar width**, corner-radius sliders — these touch layout math and bar aggregation; defer to avoid pipeline churn
- Full-spectrum / FFT / viz band logic changes
- GIF/video loop backgrounds, heavy particles, or per-frame `getImageData`
- A full theme-authoring IDE (every `WaveformTheme` field editable)

#### UI decision: **separate popup** (recommended)

The main settings popup (~300px) should stay a **quick hub**: preset pick, profile save/load, image attach (pretty-7), alignment.

**pretty-8 adds a dedicated design-studio surface** (second extension popup page, e.g. `design-studio.html`):

- Opened via **“Customize colors & effects…”** from Clip appearance (especially when editing a saved profile)
- Room for HSV/HEX controls, effect toggles, and a larger live preview without crowding Audio / Recording sections
- **Save** writes overrides back to the active profile (or prompts to save as new profile)
- **Cancel / back** returns without touching the lean main popup

Rationale: color pickers and effect toggles need horizontal space and focused layout; stuffing them into the main popup would fight the “quick, easy” north star.

#### Likely implementation sketch

1. `DesignOverrides` type — `{ barColor?, glowColor?, backgroundEffect?: 'none' | 'bokeh' | 'sparkle' | … }` merged over `getThemeById(baseThemeId)`
2. `ClipProfile` gains optional `designOverrides` (pretty-6 ids unchanged; additive field)
3. `entrypoints/design-studio/` — studio shell + preview canvas
4. `waveform.ts` / `backgrounds.ts` — read merged theme; sparkle = cheap layered draws like existing bokeh

Profile before merge: measure canvas cost of any new flair at 24 fps on a 2:00 clip.

#### pretty-8 deliverables (done, 2026-06-21)

| Deliverable | Notes | Key files |
|-------------|-------|-----------|
| Custom clip styles | HSV/HEX pickers, `customStyleId`, `designOverrides` merged over base preset | `src/ui/design-studio/color-picker.ts`, `src/ui/design-studio/radial-knob.ts` |
| Effect toggles | Bokeh, sparkle, boosted glow; `deriveGlowColor()` uses **same-hue** glow (not complement) | `src/ui/design-studio/effect-controls.ts`, `src/theme/` |
| Dual preview | Primary + secondary canvases between Style and Background; both use `renderThemePreview` | `src/ui/design-studio/preview-block.ts`, `mount-clip-studio.ts` |
| Background layout | Fit (letterbox) vs Fill (crop); position illustrated controls (not dropdowns) | `background-layout.ts`, `background-layout-controls.ts` |
| Studio exit guard | Warn on unsaved profile/style changes | `src/ui/design-studio/studio-exit.ts` |
| Recorder preset fix | Virtual `preset-{themeId}` profiles; recorder always `applyClipProfile()` | `src/settings/preset-profiles.ts` |

**Design Studio UX polish (commits `bcb35df`–`e881258`):** Profile bar above primary preview; open sections instead of stacked duplicate panels; hue ring drawn on canvas (center fixed); sat/brightness as 360° radial dials with 0/100 crossover at 12 o'clock (+90° offset); knob values below labels.

### Recorder popup: virtual preset profiles (2026-06-21, commit `58bf1e7`)

**Bug:** Clip style dropdown showed the preset name but the canvas stayed on the last saved profile — only `activeThemeId` updated; `activeCustomStyleId`, `designOverrides`, and personal background lingered.

**Fix:** Built-in clip styles are **read-only dummy profiles** (`preset-{themeId}`) resolved by `getClipProfileById()` but never stored in `savedProfiles`. Recorder dropdown values are `profile:preset-*`; selecting one runs the same `applyClipProfile()` path as user profiles, fully resetting theme, personal bg, custom style, and overrides.

**UX split preserved:** Design Studio still clears `activeProfileId` when picking a bundled preset (manual/custom mode). Recorder popup uses virtual preset profiles for a consistent reset path.

### pretty-9: transcode slowdown diagnosis + fix (2026-06-21)

User inspected offscreen/service-worker FFmpeg logs during slow and failed transcodes. **Root cause is an FFmpeg frame-duplication storm**, not general WASM slowness or relay payload size.

#### Symptom comparison

| Slow (bad) | Fast (good) |
|------------|-------------|
| Input: `vp8 … 1k tbr, 1k tbn`, `Duration: N/A` | Input: `~22 tbr`; output `~22 fps` |
| Output: `1k fps` | `dup` in single digits |
| `dup=984` at frame 1006; "More than 1000 frames duplicated" | `speed` 4–5× |
| `speed` ~0.2× | 44s clip transcodes in ~10s |

#### Causal chain

1. Chrome `MediaRecorder` + `canvas.captureStream(24)` sometimes produces WebM with **broken or missing video PTS** → FFmpeg reports **`1k tbr`** (bogus 1000 fps timebase).
2. `h264-aac` strategy in `src/ffmpeg/ffmpeg-runner.ts` has **no** `-r`, `-fps_mode`, `-vsync`, or timestamp normalization.
3. FFmpeg CFR sync duplicates frames to the bogus 1000 fps timeline → thousands of libx264 encodes in WASM (`threads=1`, no SIMD).
4. Preflight (`src/ffmpeg/webm-preflight.ts`) does **not** catch this — Chrome often reports `Duration: N/A` / `Infinity` on blobs that look valid and sometimes transcode fine.

#### Likely triggers

- Tab backgrounded (`requestAnimationFrame` stalls; sparse/bursty frame timestamps)
- Cap-stop races (see BUG-001)
- Stop timing / final-chunk edge cases

#### Fix implemented (2026-06-21)

| Layer | Action |
|-------|--------|
| FFmpeg primary | `h264-aac`: `-fflags +genpts+igndts`, `-fps_mode passthrough`, `-r 24` |
| FFmpeg fallback | `h264-aac-fps`: `-vf fps=24` when primary still dup-storms |
| Early abort | Log watcher aborts strategy when dup ≥ 100 or dup/frame ≥ 0.5 → retry next strategy |
| Remux | `faststart` unchanged as last resort |

**Related files:** `src/ffmpeg/ffmpeg-runner.ts`. See `docs/bug-archive.md` **BUG-007**.

### Session commits (2026-06-21, `pretty` branch)

| Commit | Summary |
|--------|---------|
| `bdec256` | Personal background fit/fill + position controls |
| `58bf1e7` | Virtual preset profiles — recorder clip style dropdown fix |
| `bcb35df` | Design Studio layout polish + radial HSV color controls |
| `c16332c` | Hue wheel center fix + 360° SV dial graphics |
| `e881258` | SV dial top-zero rotation + knob label spacing |

### Milestone: `pretty-profile-style-premerge` (2026-06-21)

**Annotated tag on `pretty` branch.** Checkpoint before merging to `main`: profile/style UX complete, transcode hardened, Effects section scaffold for future layered flairs.

**Includes:** Design Studio profiles + custom styles; HSV/HEX + radial dials; Clone / Save to new fork paths; nested style roll-up prompts; virtual preset profiles (recorder); personal bg fit/fill/position; BUG-007 dup-storm fix; 60s transcode stall; Effects section (background flair + tertiary preview).

**Resume merge work from this tag** if anything else must ship before `pretty` → `main`.

### v2.0 merge (completed 2026-06-21)

- **Tag `v2.0.0`** on `main` after merge of `pretty`
- **Checkpoint tags:** `pretty-profile-style-premerge`, `pretty-8-design-studio-prototype`
- **Release artifact:** `npm run zip` → `.output/reddit-voice-notes-2.0.0-chrome.zip`

## Legacy suggested order (superseded by phase table above)

1. ~~Theme data model~~ → pretty-0
2. ~~Waveform presets~~ → pretty-0
3. ~~Background presets (bundled)~~ → pretty-0
4. ~~Settings UI (clip appearance)~~ → pretty-1
5. Accessibility pass → pretty-4
6. ImageDB + personal backgrounds → pretty-7
7. Light design studio → pretty-8
8. Perf pass + v2.0 merge → pretty-9

## Branch workflow

```bash
git checkout pretty
npm run dev          # iterate on .output/chrome-mv3-dev/
npm run build        # verify prod bundle before merge consideration
```

Merge back to `main` only when a polish milestone is stable and tested — not required for every tweak.