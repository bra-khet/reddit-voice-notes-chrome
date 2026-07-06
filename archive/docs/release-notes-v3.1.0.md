# Reddit Voice Notes v3.1.0

**Design Studio refresh** — a focused UX release on top of v3.0 voice effects. No changes to the recording or transcode pipeline; this is all about making personalization easier to navigate.

**Current Studio reference:** `docs/design-studio.md` (canonical semantics as of v3.6.0). This release note documents the v3.1.0 UX milestone only.

## Highlights

### Collapsible Design Studio panels
The studio now works one section at a time. Header, profile bar, and a single **Live preview** stay pinned at the top. Everything else rolls up into expandable panels that show a useful summary when closed:

- **Bar style** — style name, color swatch, saturation/value readout, bar alignment indicator, and active effects chips
- **Background** — theme vs personal background, plus fit/fill and position when a custom image is set
- **Voice** — same one-liner as the extension popup (e.g. `Robot · 8/10`, `Whisper · Turbo`, `Off`)

### Bar style (formerly “Style”)
Renamed for clarity: these controls shape the **waveform bars**, not the whole clip. **Effects** (boosted bar glow + background flair) now live nested inside Bar style under a smaller green header, since they’re part of the foreground bar layer.

### Background layout
- **Corner alignment** — full 3×3 grid (top-left through bottom-right) for personal background placement
- **Side-by-side controls** — image sizing and position sit on one row instead of stacked

### Voice preset guidance
Robot, Whisper, and Slight mask show a short tip when selected — polite reminders to speak clearly or a bit louder so the effect works as intended.

### Preview simplification
Secondary and tertiary preview canvases are gone. One master live preview is enough now that sections collapse; less scrolling, less visual noise.

## Technical notes

- Version: `3.1.0` (`package.json` → manifest → popup label)
- Release artifact: `npm run zip` → `.output/reddit-voice-notes-3.1.0-chrome.zip` (~10.3 MB)
- **No pipeline changes** — voice effects, FFmpeg transcode, and profile persistence behave as in v3.0.0
- Forward-compat comments added for v4 (subtitles/captions panel, compositing layers documented in transcript design notes)

## Upgrade from v3.0.0

1. Remove or disable the old build at `chrome://extensions`
2. Load the new zip (or pull `main` / checkout tag `v3.1.0` and run `npm run zip`)
3. Reload the extension and hard-refresh Reddit

Saved profiles, voice settings, and personal backgrounds carry over — same `rvnUserPrefs` storage.

## What’s next

v4 branches from here: optional transcription/subtitles (Vosk), with subtitles composited as the topmost layer over bars and background.

---

**Full tag history:** `v3.1.0` · `v3.0.0` · `v2.0.0`