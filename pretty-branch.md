# `pretty` branch — visual polish & personalization

**`main`** stays frozen as the MVP (`v1.0.2-live`). All visual/customization work happens here.

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

| Rule | Rationale |
|------|-----------|
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

## Suggested implementation order

1. **Theme data model** — named presets in storage; default matches current MVP look
2. **Waveform presets** — 2–3 high-impact bar styles (classic, rounded glow, minimal line)
3. **Background presets** — solid/gradient first, then image picker from extension assets or user upload
4. **Settings UI** — pick theme + background; live preview in popup or on recorder open
5. **Accessibility pass** — contrast checks + reduced-motion variant
6. **Perf pass** — profile 3-min cap path; ensure no regression vs `main`

## Branch workflow

```bash
git checkout pretty
npm run dev          # iterate on .output/chrome-mv3-dev/
npm run build        # verify prod bundle before merge consideration
```

Merge back to `main` only when a polish milestone is stable and tested — not required for every tweak.