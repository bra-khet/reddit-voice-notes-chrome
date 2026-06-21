# Reddit Voice Notes

A privacy-first Chrome Manifest V3 extension that records short voice notes directly in Reddit comment boxes and exports them as MP4 videos with an animated waveform — ready for Reddit's video-in-comments feature.

All recording, visualization, and transcoding happens **client-side** in the browser. The only data that leaves your machine is the final MP4 you choose to upload to Reddit.

## Status

**Stable `main` v2.0.0** (2026-06) — The full personalization release: themed waveform canvas, named clip profiles, custom color styles, personal image backgrounds, Design Studio, and a hardened FFmpeg pipeline.

Previous stable: **v1.5.0** (MVP themes + pipeline hardening). Development history on the merged `pretty` branch is documented in `pretty-branch.md`.

### What's new in v2.0

| Area | Highlights |
|------|------------|
| **Design Studio** | Dedicated popup for clip appearance — HSV/HEX color pickers, radial dials, triple live previews, background fit/fill/position |
| **Profiles & styles** | Up to 12 saved clip profiles and 12 custom color styles; **Update**, **Clone**, and **Save to new** fork paths |
| **Personal backgrounds** | IndexedDB image library, chunked relay to Reddit canvas, WYSIWYG preview = recorded MP4 |
| **Effects** | Background flair (bokeh/sparkle), boosted bar glow; Effects section scaffold for future layers |
| **Pipeline** | BUG-007 dup-storm fix (`-fps_mode passthrough`), stall detection, cancel propagation, 60s client stall ceiling |
| **Settings hub** | Audio/viz toggles, accessibility presets, reduced-motion waveform, themed recorder chrome |

## Features

- Mic button injected next to Reddit's video icon (Shadow DOM–aware)
- Floating recorder with live waveform, **2-minute cap**, discard/cancel flows
- Client-side WebM capture → FFmpeg.wasm MP4 (offscreen document)
- Bundled + custom clip themes; hot-swap safe mid-recording (popup / Design Studio)
- Download MP4 (primary, always reliable)
- Best-effort **Attach to Reddit** via native file input
- Settings popup + **Design Studio** for clip personalization
- Reload extension from popup after updates

## Tech stack

- **[WXT](https://wxt.dev)** — Manifest V3 extension framework with Vite, TypeScript, and hot reload
- **Vanilla TypeScript** — no framework in content scripts; Shadow DOM for UI
- **ffmpeg.wasm** — lazy-loaded client-side transcoding in an offscreen document
- **IndexedDB** — personal background blobs (`rvnImageDb`)

## Project layout

```
entrypoints/
  background.ts          # Service worker, transcode relay, background blob relay
  content.ts             # Runs on reddit.com only
  design-studio/         # Clip personalization popup (v2)
  offscreen/             # FFmpeg WASM worker
  popup/                 # Settings hub
public/
  icon/                  # Extension icons
  ffmpeg/                # WASM core (copied on postinstall)
src/
  recorder/              # getUserMedia + canvas + MediaRecorder
  reddit-injector/       # DOM detection, injection, auto-attach
  settings/              # Profiles, custom styles, user prefs
  storage/               # ImageDB + background relay
  theme/                 # Presets, overrides, backgrounds
  ui/design-studio/      # Studio controls + save pathways
  ffmpeg/                # Transcode messaging + ffmpeg-runner
  messaging/             # MV3 message types + base64 binary transport
wxt.config.ts
docs/
  engineering-principles.md
  bug-archive.md
pretty-branch.md         # v2 phase plan + merge history
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

Visit [reddit.com](https://www.reddit.com), open a post with video comments enabled, and expand the comment box. You should see a microphone button next to Reddit's video icon.

### Usage

1. Click the mic button in a Reddit comment composer
2. Record → Stop → wait for FFmpeg → **Download MP4** or **Attach to Reddit**
3. Optional: open the extension popup or **Design Studio** to personalize clip appearance before recording
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

Output: `.output/reddit-voice-notes-2.0.0-chrome.zip` (~10 MB)

### Type check

```bash
npm run compile
```

Note: `tsc --noEmit` may report pre-existing strictness issues in a few files; the WXT production build is the release gate (`npm run build`).

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | User preferences, profiles, shortcut settings |
| `offscreen` | FFmpeg WASM transcoding (Chrome 109+) |
| `tabs` | Transcode progress relay to Reddit content script |
| `host_permissions` for `reddit.com` | Content script injection |
| Microphone (runtime) | Requested when recording starts |

## MVP constraints

- **2-minute hard cap** on recordings (see `docs/bug-archive.md` BUG-001; longer caps tentatively possible post-BUG-007)
- **MP4 output** (H.264 + AAC) for Reddit compatibility
- **Download path is primary** — auto-attach is best-effort
- **Client-side only** — no external servers except Reddit upload

## Updating for Reddit UI changes

Reddit-specific selectors and attach logic live in `src/reddit-injector/`. Search for `UPDATE WHEN REDDIT UI CHANGES`.

## Shadow DOM note

Reddit's comment toolbar lives inside web-component shadow trees. The extension walks open shadow roots (and optionally uses `chrome.dom.openOrClosedShadowRoot` when available). Do **not** add a `dom` permission to `manifest.json` — injection works without it.

## Known limitations

- Reload extension + hard-refresh Reddit after updates
- Keyboard shortcut reinstatement deferred (Reddit contenteditable conflicts) — use mic button
- Background tab pauses canvas `requestAnimationFrame` (audio still records)
- Auto-attach may break when Reddit changes uploader UI — download always works

## Release tags

| Tag | Meaning |
|-----|---------|
| `v2.0.0` | Stable release on `main` — merge of `pretty` (2026-06) |
| `pretty-profile-style-premerge` | Pre-merge checkpoint on `pretty` |
| `v1.5.0` | Prior stable MVP + themes |

## Dev dependency security notes

`npm audit` may report vulnerabilities in WXT's **dev-only** toolchain. These are not shipped in the extension bundle. Use `overrides` in `package.json`. Do **not** run `npm audit fix --force` — it downgrades WXT.

## License

Private — v2.0 stable.