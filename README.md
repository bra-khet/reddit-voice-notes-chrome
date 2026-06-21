# Reddit Voice Notes

A privacy-first Chrome Manifest V3 extension that records short voice notes directly in Reddit comment boxes and exports them as MP4 videos with an animated waveform — ready for Reddit's video-in-comments feature.

All recording, visualization, transcoding, and voice effects happen **client-side** in the browser. The only data that leaves your machine is the final MP4 you choose to upload to Reddit.

## Status

**Stable `main` v3.1.0** (2026-06) — Design Studio UX polish on v3 voice effects: collapsible Bar style / Background / Voice panels, corner background alignment, preset usage tips, single live preview.

Previous stable: **v3.0.0** (voice effects), **v2.0.0** (Design Studio + personalization). History: `pretty-branch.md` (v2), `dulcet-branch.md` (v3).

### What's new in v3.1

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
- Bundled + custom clip themes; hot-swap safe mid-recording
- Download MP4 (primary, always reliable)
- Best-effort **Attach to Reddit** via native file input
- Settings popup + **Design Studio** for visual and voice personalization
- Reload extension from popup after updates

## Voice effects (v3)

1. Open **Design Studio** from the extension popup
2. **Voice** section — enable effects, pick a preset, adjust intensity (or Turbo)
3. **Play preview** uses your last Reddit recording (record first, then reopen Studio)
4. Voice settings save on clip profiles via **Update profile** / **Save to new**
5. Next recording applies active voice config during transcode

**Disabled path:** identical to v2 — no `-af`, no extra WASM work.

**Manual QA harnesses:** `voice-harness.html` (voice effects), `transcribe-harness.html` (Vosk STT spike, eloquent branch)

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

Output: `.output/reddit-voice-notes-3.1.0-chrome.zip` (~10 MB)

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
- WASM memory is tight (~32 MB FFmpeg core); no parallel transcode jobs

## Release tags

| Tag | Meaning |
|-----|---------|
| `v3.1.0` | Design Studio collapsible panels + UX polish (2026-06) |
| `v3.0.0` | Voice effects (`dulcet` merge, 2026-06) |
| `v2.0.0` | Design Studio + personalization (`pretty` merge) |
| `v1.5.0` | Prior stable MVP + themes |

## Dev dependency security notes

`npm audit` may report vulnerabilities in WXT's **dev-only** toolchain. These are not shipped in the extension bundle. Use `overrides` in `package.json`. Do **not** run `npm audit fix --force` — it downgrades WXT.

## License

Private — v3.1 stable.