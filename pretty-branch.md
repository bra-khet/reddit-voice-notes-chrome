# `pretty` branch — visual polish & personalization

**`main`** is the stable release line (`v1.5.0` as of 2026-06). Continued experimentation happens on **`pretty`**.

## Goal

Give yourself and friends a **quick, easy, visually appealing** way to leave personalized voice notes on Reddit — without sacrificing the lean, stable recording → transcode → attach flow the MVP already has.

## North star

> Personalized voice clips that feel intentional and fun, not generic screen recordings.

Prioritize features with **mass appeal and high impact**. Skip niche effects that cost CPU or add fragility.

## Focus areas

### Waveform (live preview + baked into output video)

- Bar styling: width, spacing, corner radius, glow, symmetry, idle vs active motion
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
src/settings/                 # persist user theme/background choices
entrypoints/popup/            # settings UI for personalization
```

## Out of scope (for now)

- Re-architecting FFmpeg pipeline
- Server-side rendering or external APIs
- Keyboard shortcut reinstatement (separate concern; stays disabled on MVP `main`)

## Future audio pipeline & settings (pretty branch tracking)

These items are prepared or designed-for but not activated in the current sprint:

- **Browser audio processing toggle** (`rawMicCapture` in `rvnUserPrefs`): Default **on** (economy). Popup placeholder in Audio settings shell. Implementation in `src/recorder/mic-constraints.ts` via `acquireMicStream()` with `OverconstrainedError` fallback ladder.
- **Enhanced capture toggle** (`preferHighQualityCapture`): Default **off** (browser sample rate/channels). When on, requests **ideal** 48 kHz + ideal stereo, degrading to mono / browser defaults. Popup placeholder shipped in pretty-2 shell; wired in pretty-3.
- **Waveform bar vertical alignment**: Center-mirrored (current), bottom-aligned (classic spectrum), and top-aligned will be user-selectable settings (future UI surface similar to theme picker). The draw code in waveform.ts is being structured to support switching the bar anchoring/positioning without large refactors.
- **Voice modulation / recorder profiles**: The analysis + recording pipeline should remain extensible. Do not lock out future addition of processing graphs, profile classes, or modulation nodes if voice effects are added later.
- **Full-spectrum / music mode**: The 32-bar viz currently focuses on 80 Hz – 16 kHz voice range (with revisit-before-merge comment required in code). A toggle for wider music representation will be considered later if users request piping music through the recorder.

These notes are intentionally recorded here so decisions about defaults vs. options can be made after testing.

## Version 2 phase plan (`pretty` branch)

`main` = v1 MVP (recording pipeline). `pretty` = v2 (beautification + settings hub). Phases are sequential; later phases assume earlier storage/UI scaffolding.

| Phase | Name | Scope | Status |
|-------|------|-------|--------|
| **pretty-0** | Theme foundation | Theme model, 5 bundled presets, canvas draw refactor, persistence normalization, `rvnUserPrefs` v1 scaffold | Done |
| **pretty-1** | Popup — clip appearance | Theme picker, static canvas preview (same draw path as output), bar alignment; synced with recorder panel | Done (in `v1.5.0`) |
| **pretty-2** | Popup — full settings shell | Section cards for Audio, Recording, Notifications; disabled placeholders for unreleased toggles; reduced-motion; audio capture profile + constraint scaffold | Done |
| **pretty-3** | Audio & viz toggles | Enable raw mic + enhanced capture toggles, full-spectrum/music viz mode, help tooltips | Planned |
| **pretty-4** | Accessibility & themes | High-contrast / colorblind-safe presets, `prefers-reduced-motion` waveform, contrast pass | Planned |
| **pretty-5** | UI chrome | Recorder panel + toast theming aligned with active clip style | Planned |
| **pretty-6** | Named profiles | User-saved theme combos (beyond built-in presets) in `rvnUserPrefs` | Planned |
| **pretty-7a** | ImageDB — storage layer | IndexedDB for user background blobs (too large for `chrome.storage.local`); import/size limits; migration hooks in prefs | Planned |
| **pretty-7b** | ImageDB — canvas integration | Draw user images to live canvas during record (not post-composite); fit/fill + dim overlay; fallback on load failure | Planned |
| **pretty-7c** | ImageDB — popup UI | Pick / upload / remove personal backgrounds; preview in popup; assign to profile or active theme | Planned |
| **pretty-8** | Perf & merge readiness | 3-min cap profiling, prod bundle verify, merge criteria vs `main` | Planned |

### ImageDB notes (pretty-7)

- Personal backgrounds are **drawn to the canvas during capture** — preview = output, same as bundled presets today.
- Storage lives in **IndexedDB** (not `chrome.storage.local`); prefs hold only image record ids + metadata.
- `UserPreferencesV1` will gain `appearance.customBackgroundId` (or profile-level refs) without breaking v1 merge defaults.

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

## Legacy suggested order (superseded by phase table above)

1. ~~Theme data model~~ → pretty-0
2. ~~Waveform presets~~ → pretty-0
3. ~~Background presets (bundled)~~ → pretty-0
4. ~~Settings UI (clip appearance)~~ → pretty-1
5. Accessibility pass → pretty-4
6. Perf pass → pretty-8

## Branch workflow

```bash
git checkout pretty
npm run dev          # iterate on .output/chrome-mv3-dev/
npm run build        # verify prod bundle before merge consideration
```

Merge back to `main` only when a polish milestone is stable and tested — not required for every tweak.