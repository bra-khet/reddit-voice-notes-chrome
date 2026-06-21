# `pretty` branch — visual polish & personalization

**`main`** is the stable release line (`v1.5.0` as of 2026-06). Continued experimentation happens on **`pretty`** (`v1.6.0` — audio settings, accessibility presets, themed UI chrome).

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
entrypoints/design-studio/    # light design studio popup (pretty-8) — planned
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
| **pretty-7b** | ImageDB — canvas integration | Draw user images to live canvas during record (not post-composite); fit/fill + dim overlay; fallback on load failure | Done |
| **pretty-7c** | ImageDB — popup UI | Pick / upload / remove personal backgrounds; preview in popup; assign to profile or active theme | Done |
| **pretty-8** | Light design studio | Clip appearance migrated to Design Studio popup; profile **Update** UX; color/effect pickers next | In progress |
| **pretty-9** | Perf & merge readiness | 2:00 cap profiling, prod bundle verify, merge criteria vs `main`, tag **v2.0** | Planned |

### ImageDB notes (pretty-7)

- Personal backgrounds are **drawn to the canvas during capture** — preview = output, same as bundled presets today.
- **Two-layer storage:** blobs in **IndexedDB** (`rvnImageDb` / `backgrounds` store); prefs hold only `bg-…` ids + profile refs (`appearance.customBackgroundId`, `ClipProfile.customBackgroundId`).
- **pretty-7a (done):** `src/storage/image-db.ts` — import, quotas, list/get/delete, object-URL cache; `background-refs.ts` — reconcile stale prefs refs, prune orphans. Image import only; video MIME reserved behind `import_disabled` until loop canvas support.
- **Limits (7a):** 8 MB/image, 24 assets, 64 MB total; 15 MB reserved cap for future video/loops.
- **7b (done):** `resolveClipBackgrounds()` + `setCustomBackgroundId()` hot-swap personal images on live canvas and popup preview; fill + 35% dim; missing blob falls back to theme background.
- **7c (done):** Popup upload/pick/delete in Clip appearance; profiles persist `customBackgroundId`; library quota hint.

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