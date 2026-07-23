# Reddit Voice Notes

<!--
CHANGED: Lead with the complete hosted authoring workflow and frame Reddit as an optional extension destination.
WHY: The Design Studio now records, edits, bakes, and downloads without an install or Reddit prerequisite.
-->

Reddit Voice Notes is a privacy-first voice-note studio for Chromium browsers. Design the look and
voice, record with a WYSIWYG preview, edit captions and timing, bake, and download an MP4 entirely
in your browser. The Chrome Manifest V3 extension adds quick capture and optional attachment inside
eligible Reddit comment boxes.

All recording, visualization, transcription, transcoding, editing, and voice effects happen
**client-side**. Nothing leaves your machine until you choose to share the finished MP4.

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

The hosted **[Design Studio](https://bra-khet.github.io/reddit-voice-notes-chrome/design-studio/)**
is the full product: record, style, caption, edit the timeline, bake, and download without installing
the extension. The first visit warms the local media engines; later visits reuse the cached copy.

Start at the **[Orientation hub](https://bra-khet.github.io/reddit-voice-notes-chrome/)**, follow the
interactive **[Field Guide](https://bra-khet.github.io/reddit-voice-notes-chrome/tutorial/)**, or open
the lightweight **[Voice Lab](https://bra-khet.github.io/reddit-voice-notes-chrome/studio/)** when you
only want to audition and transfer a voice profile.

These surfaces live in [`demo/`](demo/) and deploy automatically through
[`.github/workflows/deploy-demo.yml`](.github/workflows/deploy-demo.yml).

## Status

**Current stable — v6.0.0 Polish & Visual Maturity** (2026-07-23 · **tagged `v6.0.0`**, push user-owned).

Four tracks ship together as a stable product checkpoint: audio-reactive Style Control Center,
direct-manipulation Background Layout v2, Cividis popup refresh, and the **full Design Studio on
GitHub Pages** (no install required). Field Guide and orientation hub teach
**Design → Capture → Polish & Bake**. Full notes + GitHub-ready summary:
[`docs/release-notes-v6.0.0.md`](docs/release-notes-v6.0.0.md).

### What's new in v6.0

| Area | Highlights |
|------|------------|
| **Hosted Design Studio** | Full record → style → caption → bake → download on Pages; extension optional |
| **Audio-reactive visuals** | 6 spectra · 7 atmospheres · 7 stackables · Style Control Center · performance governor |
| **Background Layout v2** | Drag/zoom/precision · presets · dim/blur/blends/Holo/GIF · framing aids · A/B |
| **Popup** | Cividis indigo→amber skin · elevated reload caution |
| **Field Guide** | Single canonical tutorial matching hosted + extension workflow |

### Recent line (v5)

| Version | Focus |
|---------|--------|
| **v5.11.0** | Preferences full-IDB migration · Export/Import · signal-only coordinator |
| **v5.10.0** | Raw trim apply — post-trim voice re-apply works again |
| **v5.9.0** | Atomic trim apply |
| **v5.8.0** | Visual subtitle timeline editor |
| **v5.7.0** | Partial re-bake splice (default-on) |
| **v5.6.0** | Audio decoupling + voice re-apply |
| **v5.5.0 / v5.5.1** | Browser-side full composite (default-on) |
| **v5.4.0** | Design Studio First + Take lifecycle |
| **v5.0.0** | Dulcet II graph-native voice DSP |

Previous: **v4.0.0** (Eloquent I — subtitles + v4 Studio), **v3.x** (voice + UX). See
[`docs/HISTORY.md`](docs/HISTORY.md). Architecture: [`docs/architecture/`](docs/architecture/).

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
3. Use **Last Voice Note** for the current saved recording, or **One-Time Test** to audition with your mic
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
2. Record in the **Current Take** deck → wait for the transcript to appear
3. Edit words and timing in **List** or **Timeline** → **Confirm & save** → **Bake**
4. Download the captioned MP4; with the extension, attachment on Reddit is an optional next step

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
