# Reddit Voice Notes

A privacy-first Chrome Manifest V3 extension that records short voice notes directly in Reddit comment boxes and exports them as MP4 videos with an animated waveform — ready for Reddit's video-in-comments feature.

All recording, visualization, transcoding, and voice effects happen **client-side** in the browser. The only data that leaves your machine is the final MP4 you choose to upload to Reddit.

Works with:

- Chrome
- Edge
- Opera
- Brave
- Any Chromium-based MV3 browser.

Incompatible:

- Firefox
- Safari
- Tor Browser

## Try it without installing

Want to shape and test a character voice before installing anything? The
**[Static Voice Studio demo](https://bra-khet.github.io/reddit-voice-notes-chrome/)**
runs the Design Studio's Voice panel entirely in your browser — build a voice,
audition it on bundled clips or your own mic, and copy it straight into the
extension (or paste one back out). It's a self-contained Vite app in
[`demo/`](demo/) that deploys automatically to GitHub Pages via
[`.github/workflows/deploy-demo.yml`](.github/workflows/deploy-demo.yml).
*(The full Orientation hub is still a work in progress.)*

## Status

**Current `main` v5.8.0 — Timeline Visual Subtitle Editor** (2026-07-10) — the subtitle cue editor is now a visual timeline: draggable/resizable cue bars over a waveform lane, stage-mode zoom + minimap, keyboard nudge / undo / multi-select, on-bar smart suggestions, and non-destructive ✂ trim intent. It rides the editing-suite backend from v5.6.0–v5.7.0 (clean-audio voice re-apply + partial re-bake splice, so cue edits re-encode only the changed regions). Design Studio remains the standalone recording suite (live WYSIWYG capture, Take lifecycle, Reddit attach). Full release notes: `docs/release-notes-v5.8.0.md`.

**v5.7.0** — Partial re-bake splice: cue edits re-encode only the changed keyframe-aligned regions (default-on).  
**v5.6.0** — Audio decoupling + voice re-apply (visuals bit-exact) + editing/timeline backend.  
**v5.5.0 / v5.5.1** — Browser-side full composite (mediabunny); FFmpeg alphamerge wall eliminated.  
**v5.4.0** — Design Studio First: standalone recording suite + Take lifecycle.  
**v5.0.0 — Dulcet II** — graph-native DSP voice engine.

Previous: **v4.0.0** (Eloquent I — subtitles + v4 Studio), **v3.x** (voice + UX). See `docs/HISTORY.md`. Architecture: `docs/architecture/`.

### What's new in v4.0 (Eloquent I)

| Area | Highlights |
|------|------------|
| **Subtitles** | Vosk WASM transcription; segment editor; bake hard subs into MP4 (repeatable) |
| **Design Studio v4** | Hero preview + status cards + sub-panels; profile Subtitles? / Ready? strip |
| **Workflow** | 3-phase guidance: Design → Capture → Polish & Bake (cross-tab stepper) |
| **Fonts** | Bundled DejaVu family; WYSIWYG preview matches burn-in output |
| **Profiles** | `transcriptConfig` on clip profiles; disable-subtitles confirm guard |

### v3.1 recap

| Area | Highlights |
|------|------------|
| **Collapsible Studio** | Bar style, Background, and Voice roll-ups with live collapsed summaries |
| **Bar style** | Renamed from Style; Effects nested inside; summary shows swatch, S/V, alignment badge |
| **Background** | 3×3 corner alignment; sizing + position side-by-side |
| **Voice tips** | Robot / Whisper / Slight mask show compensating hints when selected |
| **Preview** | One master Live preview (secondary/tertiary previews removed) |

### v3.0 recap

| Area | Highlights |
|------|------------|
| **Voice effects** | Bundled presets (Deeper, Higher, Slight mask, Robot, Whisper, Custom); duration-preserving pitch; optional EQ/dynamics/reverb via FFmpeg |
| **Intensity + Turbo** | Slider 0–10 modulates active preset strength; Turbo maps to magic 12; bundled preset stays selected while adjusting intensity |
| **Design Studio Voice** | Preview last recording via Web Audio; no transcode needed to audition |
| **Profile persistence** | `voiceEffectConfig` embedded on clip profiles; same Update / Clone / Save to new / exit guard as visual fields |
| **Export** | Single-pass `-af` on WebM→MP4 transcode; silent fallback to raw audio + toast on filter failure |
| **Popup summary** | One-line voice status (e.g. `Voice: Robot · 7/10`) |

### v2.0 recap

| Area | Highlights |
|------|------------|
| **Design Studio** | Clip appearance — colors, backgrounds, effects, live preview |
| **Profiles & styles** | Up to 12 saved clip profiles and 12 custom color styles |
| **Personal backgrounds** | IndexedDB + chunked relay to Reddit canvas (WYSIWYG) |
| **Pipeline** | BUG-007 dup-storm fix, stall detection, 60s client ceiling, 2:00 cap |

## Features

- Mic button injected next to Reddit's video icon (Shadow DOM–aware)
- Floating recorder with live waveform, **2-minute cap**, discard/cancel flows
- Client-side WebM capture → FFmpeg.wasm MP4 (offscreen document)
- Optional **voice effects** on export (off by default; per-profile)
- Optional **automated subtitles** — Vosk STT + Design Studio edit + FFmpeg burn-in (off by default)
- Bundled + custom clip themes; hot-swap safe mid-recording
- Download MP4 (primary, always reliable)
- Best-effort **Attach to Reddit** via native file input
- Settings popup + **Design Studio** for visual and voice personalization — see `docs/design-studio.md`
- Reload extension from popup after updates

## Voice effects (v3)

1. Open **Design Studio** from the extension popup
2. **Voice** section — enable effects, pick a preset, adjust intensity (or Turbo)
3. **Play preview** uses your last Reddit recording (record first, then reopen Studio)
4. Voice settings save on clip profiles via **Update profile** / **Save to new**
5. Next recording applies active voice config during transcode

**Disabled path:** identical to v2 — no `-af`, no extra WASM work.

## Character voice presets (Dulcet II / v5)

This is the flagship of the project — it's called Reddit **Voice** Notes for a reason.
v5 rebuilds voice effects on a composable, mix-and-match **graph fragment** system
optimized for highly stylized fantasy / video-game / anime / V-tuber-style character
voices, and ships a set of ready-made **character presets** as starting points.

Each preset is just a curated recipe of fragments — nothing you can't build (or
re-create) yourself by combining the same building blocks:

| Preset | Character |
|--------|-----------|
| **Cyber Oracle** | Clangorous metallic prophet in a vast digital cathedral |
| **NerdRage 🧪** | Homage to the NurdRage YouTube channel (the original Cyber Oracle voicing, preserved as-is) |
| **Glitch Beast** | Snarling, stuttering cyber-monster |
| **Ethereal Singer** | Bright, breathy spirit with a shimmering synth halo |
| **Radio Demon** | Crackly, squashed vintage-broadcast menace |
| **Helium Sprite** | Tiny, hyper cartoon-pixie chatter |
| **Abyssal Titan** | Colossal, subterranean god-voice from the deep dark |

### Roll your own

Presets are composed from **21 fragments across 7 categories** — Pitch & Formant,
Dynamics & Clarity, Modulation & Movement, Color & Embellishment, Spatial / Reverb,
Textural / Granular, and Hybrid Layers. Enable the ones you want, set their high-level
sliders (Amount / Character / Edge / Air …), and a global **Intensity / Turbo** scales
the whole chain. Use a preset as a launchpad: start from "Cyber Oracle", then push the
ring-mod or swap the convolution space to make it your own.

The fragment model, the canonical chain order, and the design philosophy are documented
in [`docs/dsp-foundation-design.md`](docs/dsp-foundation-design.md). Presets live in
`src/voice/dsp/preset-graphs.ts`.

## Subtitles (v4)

1. Open **Design Studio** → **Subtitles** → enable transcription
2. Record on Reddit → wait for transcript **Ready** badge in Studio
3. Edit cues in the segment editor → **Confirm & save** → **Bake**
4. Return to Reddit → **Attach** the baked MP4 (hard subs)

**Disabled path:** identical to v3 — no Vosk load, no burn-in pass, same `base.mp4` timing.

**Manual QA harnesses:** `voice-harness.html` (voice effects), `transcribe-harness.html` (Vosk STT)

## Tech stack

- **[WXT](https://wxt.dev)** — Manifest V3 extension framework with Vite, TypeScript, and hot reload
- **Vanilla TypeScript** — no framework in content scripts; Shadow DOM for UI
- **ffmpeg.wasm** — lazy-loaded client-side transcoding in an offscreen document
- **Web Audio API** — Design Studio voice preview only (export uses FFmpeg filters)
- **IndexedDB** — personal background blobs + last recording snapshot for preview

## Project layout

```
entrypoints/
  background.ts          # Service worker, transcode relay, last-recording IDB
  content.ts             # Runs on reddit.com only
  design-studio/         # Clip + voice personalization (v2/v3)
  offscreen/             # FFmpeg WASM worker
  popup/                 # Settings hub
  voice-harness/         # Manual voice effect QA (v3)
  transcribe-harness/    # Manual Vosk transcription QA (v4 eloquent)
public/
  icon/                  # Extension icons
  ffmpeg/                # WASM core (copied on postinstall)
  vosk/                  # Vosk model tar.gz (fetched on postinstall, gitignored)
  vosk-sandbox.html/js   # Manifest sandbox STT host (esbuild on postinstall)

docs/
  design-studio.md               # Canonical Design Studio semantics (four sections)
  transcription-architecture.md  # MV3 CSP / sandbox design audit (eloquent)
src/
  recorder/              # getUserMedia + canvas + MediaRecorder
  voice/                 # Effect types, presets, resolve-config, preview, -af graphs
  settings/              # Profiles, custom styles, user prefs
  storage/               # ImageDB, last-recording relay
  ui/design-studio/      # Studio controls + voice-controls.ts
  ffmpeg/                # Transcode messaging + ffmpeg-runner
  transcription/         # Vosk STT types + transcribeWebmBlob (eloquent)
docs/
  engineering-principles.md
  bug-archive.md         # BUG-001 … BUG-009
dulcet-branch.md         # v3 phase plan
pretty-branch.md         # v2 phase plan
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- Chrome or Edge (Chromium 120+)

### Setup

```bash
npm install
```

### Dev mode (hot reload)

```bash
npm run dev
```

Load `.output/chrome-mv3-dev/` in `chrome://extensions` (Developer mode → Load unpacked).

### Usage

1. Click the mic button in a Reddit comment composer
2. Record → Stop → wait for FFmpeg → **Download MP4** or **Attach to Reddit**
3. Optional: **Design Studio** for clip appearance and voice effects
4. Post your comment

### Production build

```bash
npm run build
```

Output: `.output/chrome-mv3/`

### Release zip (GitHub / sideload)

```bash
npm run zip
```

Output: `.output/reddit-voice-notes-5.0.0-chrome.zip` (~57 MB — includes Vosk model + fonts)

### Type check

```bash
npm run compile
```

Note: `tsc --noEmit` may report pre-existing strictness issues in a few files; the WXT production build is the release gate (`npm run build`).

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | User preferences, profiles, voice config |
| `offscreen` | FFmpeg WASM transcoding (Chrome 109+) |
| `tabs` | Transcode progress relay to Reddit content script |
| `host_permissions` for `reddit.com` | Content script injection |
| Microphone (runtime) | Requested when recording starts |

## MVP constraints

- **2-minute hard cap** on recordings (see `docs/bug-archive.md` BUG-001)
- **MP4 output** (H.264 + AAC) for Reddit compatibility
- **Download path is primary** — auto-attach is best-effort
- **Client-side only** — no external servers except Reddit upload
- **Voice effects:** single FFmpeg pass; `loudnorm` presets may add several seconds on long clips

## Known limitations

- Reload extension + hard-refresh Reddit after updates
- Keyboard shortcut reinstatement deferred — use mic button
- Background tab pauses canvas `requestAnimationFrame` (audio still records)
- Voice preview requires a prior recording in the same browser session
- Auto-attach may break when Reddit changes uploader UI — download always works
- WASM memory is tight (~32 MB FFmpeg core + ~40 MB Vosk model); separate transcode/transcribe queues
- Subtitle bundle adds ~40 MB Vosk model at install (`npm install` fetches on postinstall)

## Release tags

| Tag | Meaning |
|-----|---------|
| `v5.2.0` | **Voice QoL** — custom-voice lock guard + clipboard voice backup (2026-06) |
| `v5.1.0` | Animated GIF backgrounds (2026-06) |
| `v5.0.0` | **Dulcet II** — graph-native voice DSP rebuild + character presets (`dulcet-ii` merge, 2026-06) |
| `v4.0.0` | **Eloquent I** — automated subtitles + Design Studio v4 (`eloquent` merge, 2026-06) |
| `v3.1.0` | Design Studio collapsible panels + UX polish (2026-06) |
| `v3.0.0` | Voice effects (`dulcet` merge, 2026-06) |
| `v2.0.0` | Design Studio + personalization (`pretty` merge) |
| `v1.5.0` | Prior stable MVP + themes |

## Dev dependency security notes

`npm audit` may report vulnerabilities in WXT's **dev-only** toolchain. These are not shipped in the extension bundle. Use `overrides` in `package.json`. Do **not** run `npm audit fix --force` — it downgrades WXT.

## License

Private — v4.0 stable.