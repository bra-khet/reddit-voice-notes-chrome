# Repo map — durable skeleton (orientation seed)

> **Purpose:** 60-second re-orientation for any session running
> `architecture-hardening`. This is the *stable* skeleton — things that rarely
> change. The **detailed, versioned** view is the living map at
> `docs/architecture/architecture-map.md` (created/maintained by Phase 1).
> When this seed and the living map disagree, the living map wins for current
> detail; fix this seed only when the skeleton itself shifts (a new context,
> pipeline, or storage class).

Verify file paths before relying on them — this repo refactors often, and a
stale path in a doc is exactly the kind of finding Phase 2 should catch.

---

## What the product is

A Chrome **MV3** extension built with **WXT** (`wxt.config.ts`, `srcDir: '.'`).
Users record a short voice note inside the Reddit comment composer; the
extension renders an animated waveform video, optionally applies a voice effect,
transcodes to MP4 (FFmpeg WASM), optionally transcribes (Vosk WASM) and burns in
subtitles, then attaches the MP4 to the Reddit post. **Design Studio** (an
extension page) is the primary product surface for styling, preview, transcript
editing, and baking.

3-phase *user* mental model (distinct from this skill's phases — don't conflate):
**Design → Capture → Polish & Bake**, carried cross-tab by `rvn.workflow.phase`.

## The six execution contexts (and why boundaries matter)

The single most important architectural fact: **a fix in one context does not
transfer to another**, because each has a different CSP, origin, and API surface.
Most historical bugs live on these seams.

| Context | Origin / CSP | `eval` | `chrome.*` | Runs | Key entry |
|---------|--------------|--------|-----------|------|-----------|
| **Content script** (reddit.com) | page origin, isolated world | n/a | limited | recorder UI, composer inject, canvas capture | `entrypoints/content.ts`, `src/reddit-injector/*`, `src/recorder/*` |
| **Background SW** (MV3) | extension, `wasm-unsafe-eval` | forbidden | yes | message relay, offscreen lifecycle, keep-alive | `entrypoints/background.ts` |
| **Offscreen doc** | extension, `wasm-unsafe-eval` | forbidden | yes | **FFmpeg** transcode + subtitle burn-in (WASM) | `entrypoints/offscreen/main.ts`, `src/ffmpeg/*` |
| **Manifest sandbox** | opaque/null, `unsafe-eval` + `worker-src blob:` | **allowed** | **no** | **Vosk** STT (Emscripten + blob workers) | `public/vosk-sandbox.html` + `public/vosk-sandbox.js` |
| **Design Studio** | extension page | forbidden | yes | styling, preview, transcript edit, bake trigger | `entrypoints/design-studio/*`, `src/ui/design-studio/*` |
| **Popup** | extension page | forbidden | yes | quick settings | `entrypoints/popup/*`, `src/ui/popup/*` |

CSP source of truth: `wxt.config.ts` → `manifest.content_security_policy`.
Why Vosk needs the sandbox (not offscreen): `docs/transcription-architecture.md`.

## Message contracts (the wire)

Three offscreen pipelines share **one symmetric contract** — recognizing that
symmetry is what makes adding a 4th pipeline cheap:

```
START → ACK → (background relays) → OFFSCREEN → PROGRESS* → COMPLETE | CANCEL
```

| Pipeline | START const | Worker | Notes |
|----------|-------------|--------|-------|
| Transcode | `MSG_TRANSCODE_*` | FFmpeg (offscreen) | optional `voiceEffect` `-af`; `voiceEffectFallback` flag on failure |
| Transcribe | `MSG_TRANSCRIBE_*` | Vosk (sandbox via offscreen) | raw WebM clone; runs in parallel, must not block transcode |
| Burn-in | `MSG_BURNIN_*` | FFmpeg (offscreen) | 2nd pass; `segmentsJson` + `styleJson` |

All constants and payload interfaces: **`src/messaging/types.ts`** (single
registry — read this to enumerate the wire). Relay plumbing:
`entrypoints/background.ts` + `src/messaging/relay-registry.ts`.

**Relay is the fragile part.** Offscreen `runtime.sendMessage` does **not** reach
content scripts, so background re-broadcasts via `tabs.sendMessage` keyed by a
`jobId → tabId` registry that must survive MV3 SW restarts (BUG-032). Design
Studio (an extension page) listens on `runtime.onMessage` directly and **skips**
the tab relay (`burnInSkipTabRelayByJobId`). Large binaries cross hops as
**base64** (`src/messaging/binary.ts`, validated by `binary-verify.ts`) or via a
chunked **port** (`BACKGROUND_BLOB_PORT`) / chunked baked-MP4 messages.

Cross-context **signals** are storage-key writes, not messages:
`*.ready` keys (below) are "new data available — poll IDB" pings.

## State ownership (where data lives)

Split by size and reach. **Never put blobs or transcript text in prefs.**

**`chrome.storage.local`** (small, cross-context, hot-swappable):

| Key | Holds |
|-----|-------|
| `rvnUserPrefs` | profiles, custom styles, appearance, voice, `transcriptConfig` (style/toggle only) |
| `rvn.subtitles.enabled` | atomic subtitle on/off |
| `rvn.lastRecording.ready` | signal: new WebM for voice preview |
| `rvn.sessionTranscript.ready` | signal: new transcript row |
| `rvn.bakedMp4.ready` | signal: baked MP4 ready for recorder |
| `rvn.workflow.phase` | `'design' \| 'capture' \| 'polish'` |

**IndexedDB** (large binary / structured, extension-origin):

| Store | Holds | Module |
|-------|-------|--------|
| `rvnImageDb` | personal background blobs | `src/storage/image-db.ts` |
| `rvnLastRecording` | last WebM (voice preview source) | `src/storage/last-recording-db.ts` |
| `rvnSessionTranscript` | Vosk + edited transcript | `src/storage/session-transcript-db.ts` |
| `rvnLastBaseMp4` | transcoded base for bake | `src/storage/last-base-mp4-db.ts` |
| `rvnLastBakedMp4` | burned-in output | `src/storage/last-baked-mp4-db.ts` |

Authoritative storage map (with read/write owners): `docs/design-studio.md` §3.2.
Content scripts can't read extension IDB — they relay via background (chunked).

## The four first-class concerns (the spine)

Every Phase-1 map keeps a current section on each. Pointers to ground truth:

1. **Preview ↔ bake boundary.** Preview = canvas + Web Audio (fully expressive,
   RAF). Bake = FFmpeg (`-af` for audio, `drawtext` for subtitles — *static*
   `fontcolor` per filter). The promise: *if it's in Live preview, the export
   path must reproduce it.* Fidelity gaps are quantized/approximated, not faked
   (e.g. rainbow → 0.25 s static slices). See `docs/design-studio.md` §3.3, §7.4
   and `docs/engineering-principles.md` § pipeline-native solutions.
2. **Effect composition.** Three independent layers: **voice** (audio track,
   `-af`), **bars** (canvas waveform + glow), **subtitles** (drawtext burn-in on
   `base.mp4`, never in canvas RAF). Compositing order bottom→top:
   background → bars → subtitles. `src/voice/*`, waveform/recorder, `src/ffmpeg/*`.
3. **Message contracts.** See above. `src/messaging/types.ts` is the registry.
4. **State ownership.** See above. Prefs vs IDB vs signals; one writer per datum.

## Key directories

```
entrypoints/          background.ts, content.ts, offscreen/, design-studio/,
                      popup/, voice-harness/, transcribe-harness/
src/messaging/        types.ts (wire registry), relay-registry.ts, binary*.ts,
                      background-blob.ts, baked-mp4-blob.ts
src/ffmpeg/           transcoder, transcode-queue/-lock/-cancel, burn-in, webm-preflight
src/voice/            filter-graphs, preview-chain, process-audio, resolve-config, presets
src/transcription/    decode-webm-audio, vosk-sandbox-{host,client,entry}, srt-builder
src/storage/          *-db.ts (the 5 IDB stores) + relays
src/ui/design-studio/ mount-clip-studio (orchestrator), *-controls, subtitle-*, studio-*
src/theme/            presets, backgrounds, effects (bokeh/sparkle), color-utils
scripts/              build-vosk-sandbox.mjs, copy-ffmpeg-core.mjs, fetch-vosk-model.mjs
docs/                 canonical docs (see below)
```

## Canonical docs (win on their topic — extend, don't duplicate)

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics, preview=bake, dirty layers, storage map, **outbound index (§12)** |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack, postMessage trust model |
| `docs/engineering-principles.md` | semantic health, branching save pathways, pipeline-native effects, ImageDB |
| `docs/bug-archive.md` | `BUG-###` history (Phase-3 raw material) |
| `docs/v4-development-principles.md` | branch model, compositing, WASM queues |
| `claude-progress.md` | session timeline + release tags |

## Build / verify quick reference

- `npm run compile` — `tsc --noEmit` (note: pre-existing strictness warnings in
  `background.ts` / `background-loader.ts` are non-blocking for WXT build).
- `npm run build` — runs `build:vosk-sandbox` then `wxt build`.
- After editing `vosk-sandbox-host.ts`: `npm run build:vosk-sandbox` + reload.
- Manual QA harnesses: `transcribe-harness.html`, `voice-harness.html`.
