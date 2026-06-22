# Reddit Voice Notes — Session Progress

## v2.0.0 stable — `pretty` merged to `main` (2026-06-21)

**Tag:** `v2.0.0` · **Pre-merge checkpoint:** `pretty-profile-style-premerge`

Largest project milestone: full clip personalization (Design Studio, profiles, custom styles, personal backgrounds, effects scaffold) on top of hardened MVP transcode pipeline (BUG-007 dup-storm fix, semantic stall detection, 60s client ceiling).

**Release build:** `npm run zip` → `.output/reddit-voice-notes-2.0.0-chrome.zip` (~10 MB)

**Sanity check (pre-merge):** `npm run build` + `npm run zip` pass; `tsc --noEmit` has pre-existing strictness warnings in `background-loader.ts` / `background.ts` (non-blocking for WXT build).

## MVP complete — v1.0.0

| Phase | Status |
|-------|--------|
| 0–5 | Done |
| 6 | Done — shortcuts, settings popup, README, v1.0.0 |

## Phase 6 deliverables

- **Keyboard shortcut**: Default `Ctrl+Shift+X` / `⌘+Shift+X`; configurable in popup (`src/settings/`)
- **Manifest command**: `open-voice-recorder` (rebindable at `chrome://extensions/shortcuts`)
- **Settings popup**: Shortcut capture, reset, reload extension
- **README**: Finalized usage, layout, limitations

## Bug fix: cap transcode hang (see `docs/bug-archive.md` BUG-001)

- **Cause**: Cap auto-stop WebM corruption + ~15 MB base64 relay + canvas video bitrate; per-strategy FFmpeg timeouts allowed multi-minute hangs on 15 MB files
- **Fix (2026-06)**: Recording cap **2:00** (118s enforced); FFmpeg worker dispose/queue; strategy timeout capped at 90s; theme assets in `web_accessible_resources`
- **Earlier fixes**: Dedicated cap `setTimeout`; `stopInFlight` guard; chunked base64 encode; cap stop uses `requestData`+`stop`

## Restore prior checkpoint

```bash
git checkout v0.1.0-phase3-stable && npm install && npm run dev
```

## Recent tweaks (v1.0.2)

- **Keyboard shortcut**: Disabled (commented out) — Reddit contenteditable/shadow DOM conflicts; revisit later
- **Cap transcode hang fix**: Removed cap-only 1.1s wait-while-recording flush (was corrupting WebM); cap stop now uses same `requestData`+`stop` as manual; 300ms lead before nominal cap
- **Recording cap**: **2:00** display / **2:00** enforced (lowered from 3:00 — see `docs/bug-archive.md`)
- **BUG-002 fix**: `writeFile` buffer transfer — slice per FFmpeg strategy; exec timeout race guard
- **BUG-003 fix**: explicit pipeline validators (`binary-verify.ts`), stall-based timeout, heartbeats, transcode lock, 2 FFmpeg strategies + job retry

## BUG-005 (2026-06): orphan transcode on recorder reopen

Two different `Sending WebM` byte sizes = two sessions, not one duplicate send. Reopening the mic panel while async stop/preflight/transcode ran left the old session alive. Fixed with `sessionEpoch`, `AbortController`, and early `processing` phase — see `docs/bug-archive.md` BUG-005. Progress pegged at 20% is normal FFmpeg stage mapping; 35% flicker was strategy retry before monotonic fix.

## UX design note

- Order select/radio options to match how users visualize the result (e.g. bar alignment: **Top → Center → Bottom**, not alphabetical or implementation order).

## Known limitations

- **Background tab / minimized window:** `requestAnimationFrame` pauses when the Reddit tab is hidden; audio keeps recording but the canvas freezes on the last drawn frame until the tab is visible again. Expected browser behavior; not worth complicating the pipeline for stress-test edge cases.
- Auto-attach best-effort; download always works
- **2:00 cap** is a pipeline concession until chunked transport / lower video bitrate (BUG-001)
- Reddit allows ~3:00 video comments; extension intentionally stops earlier
- Popup shortcut vs Chrome command page are independent config paths

## v1.5.0 stable (2026-06) — merged `pretty` → `main`, tag `v1.5.0`

- Themes, hardened FFmpeg pipeline, popup clip-appearance settings, 2:00 cap
- **QA finding — live theme swap during recording is safe** (see below); comment-panel lockout kept as UX guard only

## v1.6.0 (`pretty` branch, 2026-06)

- pretty-2–5: settings shell, audio/viz toggles, accessibility presets, reduced-motion waveform draw
- Restart caution when audio/recording prefs change (reload extension recommended)
- Recorder panel + toast accents derived from active clip theme (`src/ui/theme-chrome.ts`)
- Version source: `package.json` → `wxt.config.ts` manifest → `src/utils/version.ts` popup label
- pretty-6: named clip profiles (`savedProfiles` + `activeProfileId` in `rvnUserPrefs`, up to 12)
- **Roadmap:** pretty-7b/c = canvas + popup for personal backgrounds; pretty-8 = light design studio; v2.0 after pretty-8 + pretty-9
- **pretty-7a (2026-06):** ImageDB storage layer — `src/storage/image-db.ts` (IndexedDB blobs, import quotas, object-URL cache), `background-refs.ts` (reconcile/prune); prefs normalize `bg-…` ids only
- **pretty-7b (2026-06):** Canvas draw — `resolveClipBackgrounds()` / `loadBackgroundImageElement()` → `drawThemeBackground()` user layer; `WaveformRenderer.setCustomBackgroundId()` + prefs hot-swap in `voice-recorder.ts`; popup preview passes `customBackgroundId`
- **pretty-7c (2026-06):** Popup personal background UI — upload/pick/delete in Clip appearance; `personal-background.ts` + `settings/personal-background.ts` delete/prune helpers
- **pretty-8 shell (2026-06):** Design Studio popup (`design-studio.html`) — clip appearance migrated; main popup summary + Open Design Studio; profile **Update profile** / **Sure?** UX; fixes: delete-one-only, content-script background relay via `MSG_GET_BACKGROUND_BLOB`
- **pretty-8 prototype milestone (2026-06-20, tag `pretty-8-design-studio-prototype`):** Personal backgrounds **WYSIWYG on Reddit recorder canvas** — preview matches live output and baked MP4. Largest technical hurdle on the project to date: extension ImageDB blobs must reach a **content script** on `https://www.reddit.com` and decode under page CSP.

### Personal background relay — content script canvas (pretty-7/8, QA-verified 2026-06-20)

**Problem:** Design Studio / popup (extension pages) read ImageDB directly; recorder runs on Reddit and cannot. Bundled theme SVGs work via `chrome-extension://` + `web_accessible_resources`; personal blobs do not.

**Failure modes encountered (in order):**

| Symptom | Cause | Fix |
|---------|-------|-----|
| Theme bg only, no console error | Stale async load race in `WaveformRenderer` constructor | Generation counter; defer initial load until `setCustomBackgroundId()` |
| `decode returned null` | `FileReader` → `data:` URL blocked by Reddit `img-src` CSP | `blob:` URL + `createImageBitmap` fallback (`DrawableBackgroundImage`) |
| `createImageBitmap: could not be decoded` | Raw `ArrayBuffer` corrupts across MV3 relay hops | Base64 transport (same rule as WebM in `messaging/binary.ts`) |
| `port relay failed: unknown error` / `message relay failed: no response` | Single-message payload exceeded MV3 practical size for multi-MB images | **Chunked relay:** 256 KB raw slices via port (`meta` → `chunk`* → `done`) + `MSG_GET_BACKGROUND_BLOB_META` / `_CHUNK` fallback |

**Working architecture:**

1. Prefs hold `bg-…` id only; blobs in extension-origin ImageDB.
2. Background worker reads IDB, streams chunked base64 to content script.
3. Content script assembles bytes → `Blob` → decode (blob URL / `ImageBitmap`) → `drawThemeBackground()` user layer.
4. Same draw path as `renderThemePreview()` — preview = recorder canvas = MP4.

**UX split (pretty-8):** Design Studio keeps **active profile** when editing theme/alignment/background (**Update profile**); picking a bundled preset there still clears `activeProfileId` (manual/custom mode). **Recorder popup (2026-06-21):** bundled clip styles are **virtual dummy profiles** (`preset-{themeId}` in `src/settings/preset-profiles.ts`) — not stored in `savedProfiles`, but selected via the same `applyClipProfile()` path as user profiles so preset picks fully reset theme, personal background, custom style, and overrides (fixes dropdown label changing without canvas update).

**Remaining before v2.0 merge:** pretty-9 transcode fix + cap profiling + prod bundle verify (see below).

### Session 2026-06-21 — pretty-8 completion + transcode diagnosis

**pretty-8 done.** Commits `bdec256` → `e881258`: personal bg fit/fill/position; virtual preset profiles (recorder); Design Studio HSV/HEX + radial dials + dual preview + effect toggles + exit guard.

#### Recorder preset bug (fixed, `58bf1e7`)

Dropdown label changed to a bundled preset but canvas kept last saved profile (`activeThemeId` only). Fix: virtual `preset-{themeId}` profiles in `src/settings/preset-profiles.ts`; recorder uses `applyClipProfile()` for all picks including presets.

#### Transcode slowdown — frame duplication storm (BUG-007, **fixed 2026-06-21**)

Offscreen FFmpeg logs show the failure mode is **dup ≈ frame count**, not WASM cold start or WebM relay size.

| Slow | Fast |
|------|------|
| Input `1k tbr`, `Duration: N/A` | Input `~22 tbr` |
| Output `1k fps`, `dup=984+`, `speed` ~0.2× | `dup` single digits, `speed` 4–5× |

**Chain:** `MediaRecorder` + `captureStream(24)` → WebM with missing/broken PTS → FFmpeg `h264-aac` (no `-r` / `-fps_mode` / `-vsync`) → CFR sync duplicates to 1000 fps timeline → thousands of libx264 frames in single-thread WASM.

**Preflight gap:** `webm-preflight.ts` accepts `Duration: N/A` / `Infinity` (normal for Chrome WebM) — does not detect `1k tbr` dup-prone blobs.

**Triggers:** background tab (rAF stall), cap-stop races (BUG-001), sparse frame timestamps.

**Fix:** `ffmpeg-runner.ts` — primary strategy uses `-fflags +genpts+igndts`, `-fps_mode passthrough`, `-r 24`; fallback `h264-aac-fps` with `-vf fps=24`; early abort + strategy retry on dup storm. QA (2026-06-21): full 2:00 cap ~43s transcode on dense audio; near-silent ~25s. Client stall timeout raised 45s → 60s. **2:00 cap kept**; longer length tentatively possible post-BUG-007 — see `constants.ts` note.

## Branch split (post-MVP)

| Branch | Role |
|--------|------|
| `main` | **v3.1.0** stable — Design Studio UX polish on v3 (2026-06) |
| `pretty` | **Merged** into `main` as **v2.0.0** (2026-06-21); branch retained for history |
| `dulcet` | **Merged** into `main` as **v3.0.0** (2026-06); branch retained for history |

## Architecture note: mid-recording theme changes (QA-verified 2026-06)

**Observed:** Changing clip style in the **extension settings popup** while recording works cleanly — canvas updates live and the finished MP4 reflects theme switches mid-clip. The **comment recorder panel** hides/disables its theme picker during recording; that lockout is defensive UX, not a pipeline requirement.

**Why it works (single-canvas WYSIWYG):**

1. `VoiceRecorderSession` subscribes to `onUserPreferencesChanged()` for the whole session (`voice-recorder.ts`).
2. Any `saveAppearancePreferences()` write (popup or panel) → `chrome.storage.local` → listener calls `waveform.setTheme()` / `setBarAlignment()` without restarting MediaRecorder.
3. `WaveformRenderer` RAF loop reads `this.theme` every frame; `setTheme()` hot-swaps theme data + async background image load (`waveform.ts`).
4. `waveform.canvas.captureStream(WAVEFORM_TARGET_FPS)` feeds MediaRecorder — **preview pixels = encoded video pixels**.

**Implication for pretty-7 (IndexedDB custom backgrounds):** Same hot-swap path. Store blob id in prefs; extend `loadBackgroundIfNeeded()` to resolve IndexedDB images; prefs listener already applies mid-recording. No parallel recorder or post-composite needed.

**Policy:** Keep comment-panel theme lockout (reduces accidental mid-take changes). Consider exposing intentional mid-recording style changes only via popup or a future explicit “live style” affordance.

## Future ideas (post-MVP)

- Waveform themes in settings → active on `pretty` branch
- Chunked binary transport for very long recordings
- **Audio processing bypass toggle** (pretty branch work): Prepared disabled-by-default path for `echoCancellation/noiseSuppression/autoGainControl=false` in getUserMedia. Will become user-selectable (with help "?" tooltip explaining "poor audio quality") once tested. Users experiencing telephone/Bluetooth-like quality can opt into raw mic capture. See pretty-branch.md "Future audio pipeline & settings" and code comments with "FUTURE AUDIO TOGGLE".
- Waveform bar alignment options (center mirrored / bottom / top) as user setting alongside themes.
- Extensibility note: recorder pipeline kept open for future voice modulation profiles.

---

## v3.0.0 stable — `dulcet` merged to `main` (2026-06)

**Tag:** `v3.0.0` · **Release zip:** `.output/reddit-voice-notes-3.0.0-chrome.zip` (~10 MB)  
**Plan:** `dulcet-branch.md` · **Baseline merged from:** v2.0.1 on `main`

Largest v3 milestone: client-side voice effects (pitch, EQ, light stylization) with Design Studio preview, profile persistence, intensity/Turbo modulation, and single-pass FFmpeg `-af` export with graceful fallback — without breaking v2 record → transcode → attach.

### Phase status (all complete)

| Phase | Name | Status |
|-------|------|--------|
| **dulcet-0** | Audit & frozen types (`src/voice/`) | **Done** (`7ee7bcc`) |
| **dulcet-1** | Isolated `processAudio()` + offscreen harness | **Done** (`916c21d`) |
| **dulcet-2** | Design Studio voice preview UI | **Done** (`04fc6d1`) |
| **dulcet-3** | Export pipeline wire (FFmpeg `-af` on transcode) | **Done** (`33154b3`) |
| **dulcet-4** | Profile persistence + intensity 0–10 / Turbo (→12) | **Done** (`55fde8a`) |
| **dulcet-5** | Harden, docs, zip, merge `main`, tag v3.0.0 | **Done** |

### What shipped (dulcet-0 → dulcet-3)

**Types & presets (`src/voice/`):** `VoiceEffectConfig`, bundled presets (Deeper, Higher, Slight mask, Robot, Whisper, Custom), FFmpeg filter-graph builders, duration-preserving pitch via `asetrate` + `atempo`.

**Isolated processor (dulcet-1):** `process-audio.ts` + `offscreen-queue.ts`; manual QA via `entrypoints/voice-harness/` and `__rvnVoiceHarness` on offscreen `globalThis`. Robot preset compressor strengthened then **reverted** (`79adb2b`) — original settings kept.

**Design Studio preview (dulcet-2):** Voice section in `src/ui/design-studio/voice-controls.ts`; Web Audio chain in `preview-chain.ts`; last-recording buffer in extension-origin IndexedDB (`last-recording-db.ts`).

**Preview relay fix:** Content-script IDB write failed (reddit.com vs extension origin) — “no recording” / dead Play. Fix: `last-recording-relay.ts` → `MSG_SAVE_LAST_RECORDING` → background → extension IDB. Studio reloads preview on `visibilitychange`.

**Preview decode:** `decodeAudioData` with **HTMLMediaElement fallback** for muxed WebM when buffer decode fails.

**Export wire (dulcet-3):** `voiceEffect` on `UserPreferencesV1`; `saveVoiceEffectPreferences()`; Studio persists settings. `ffmpeg-runner.ts` injects `-af` before `-c:a aac`; on failure → raw audio + `voiceEffectFallback` toast in recorder panel. Disabled = unchanged v2 behavior. Raw WebM retained in memory until export succeeds.

**UI copy:** Presets hint — “Presets include special SFX — not just pitch…”

### Architecture (two paths)

```
Preview:  record on Reddit → relay WebM to extension IDB → Design Studio
          → decode (AudioBuffer or <audio> fallback) → Web Audio chain
          → pitch → EQ → dynamics (coarse; FFmpeg does full SFX on export)

Export:   stop → transcodeWebmToMp4(webm, …, prefs.voiceEffect)
          → background → offscreen enqueueTranscodeJob → runWebmToMp4()
          → optional -af on audio stream inside same muxed WebM transcode
```

Voice effects are **post-capture, in-transcode** — no parallel MediaRecorder graph; waveform video track unchanged (duration-preserving default).

### Pipeline constraints (remember for all future Dulcet work)

**Web Audio — read-only AudioParams:** Many node properties (`playbackRate`, `gain`, filter frequencies, etc.) are **read-only `AudioParam` objects**, not assignable numbers. Always set `.value` on the param (e.g. `source.playbackRate.value = ratio`). `HTMLAudioElement.playbackRate` is a normal number property. Unified helpers: `wirePreviewOutput()` / `wireEffectChain()` in `preview-chain.ts` (buffer + element paths). **Apply this rule anywhere Web Audio nodes are touched** — preview chain, future live monitor, harness.

**WASM / FFmpeg memory:** FFmpeg.wasm runs in a **single offscreen worker** with shared virtual FS and tight heap (~32 MB core + per-job buffers). Existing rules: serialized `enqueueTranscodeJob` queue (no parallel FFmpeg jobs); `writeFile` needs fresh buffer slices (ArrayBuffer detach); `disposeFfmpeg()` on failure/timeout. Future add-ons (e.g. Vosk ~50 MB) need a **separate queue/worker** — do not stack on the transcode queue without profiling.

### Bugs fixed (dulcet sprint)

| Symptom | Cause | Fix | ID |
|---------|-------|-----|-----|
| Play preview does nothing | IDB origin mismatch | Background relay for last recording | `33154b3` |
| `Cannot set property playbackRate… only a getter` | Assigned to AudioParam property | `playbackRate.value` on `AudioBufferSourceNode` | `49e293f` / BUG-008-adjacent |
| Settings popup blank (~10px box) | `types.ts` ↔ `resolve-config.ts` circular import | Direct imports; no re-export from types | `e42bed3` / **BUG-008** |
| Intensity slider → Custom; preset SFX lost | Slider forced `presetId: 'custom'` | `resolveVoiceEffectConfig()` + keep presetId | `b185ca6` / **BUG-009** |

### dulcet-4 — profile persistence

- `voiceEffectConfig` embedded on `ClipProfile`; legacy profiles without it load as voice-off
- `applyClipProfile` / `saveCurrentAsClipProfile` / `updateActiveClipProfile` snapshot live `voiceEffect`
- Dirty + exit guard via `clipProfileMatchesLiveState()` (appearance + voice)
- Intensity slider 0–10 + Turbo toggle (magic 12); `resolveVoiceEffectConfig()` + `scaleVoiceEffectByIntensity()`
- Popup summary: `Voice: Deeper · 7/10` or `Voice: Off` (`formatVoiceEffectSummary`)
- Bundled clip-style presets keep live voice prefs (visual-only virtual profiles)

### dulcet-5 — release hardening

- **v3.0.0** version bump (`package.json`, `version.ts`, manifest via wxt)
- `README.md` rewritten for v3; `docs/bug-archive.md` BUG-008 + BUG-009
- Import-graph audit: no voice cycles; `types.ts` guard comment; `index.ts` barrel marked offscreen-only
- `npm run build` + `npm run zip` pass; `tsc --noEmit` pre-existing warnings only (background-loader, background.ts)

### Module layout (voice — do not regress)

```
types.ts          — leaf types + normalize only (NEVER re-export resolve-config)
resolve-config.ts — resolveVoiceEffectConfig, scale, voiceEffectIsActive, equality
presets.ts        — bundled preset table
filter-graphs.ts  — FFmpeg -af (resolve → scale → build)
preview-chain.ts  — Web Audio preview (resolve → scale)
voice-summary.ts  — popup one-liner (popup imports this, not barrel)
```

**Popup/settings rule:** direct file imports only — not `@/src/voice` barrel (pulls ffmpeg via process-audio).

**Deferred (post-v3):** ephemeral ~30s ad-hoc mic test in Studio

### Transcription (v4 — design only, not started)

Raw-audio STT on cloned WebM; opt-in Vosk UX — see `.ignore/transcript-design-notes.txt`. No Dulcet code changes required yet.

### Restore / test v3

```bash
git checkout main && npm install && npm run dev
```

- Harness: `chrome-extension://<id>/voice-harness.html`
- Studio: record on Reddit → Design Studio → Voice → Play preview
- Export: enable voice effects → record → MP4 reflects preset (toast if fallback)
- Profiles: save voice on profile → switch profiles → voice restores

### Dulcet commit chain

`7ee7bcc` dulcet-0 · `916c21d` dulcet-1 · `04fc6d1` dulcet-2 · `33154b3` dulcet-3 · `55fde8a` dulcet-4 · `b185ca6` intensity fix · `e42bed3` popup fix · dulcet-5 release docs

## v3.1.0 stable on `main` (2026-06-21)

**Tag:** `v3.1.0` · **Release zip:** `.output/reddit-voice-notes-3.1.0-chrome.zip` (~10.3 MB)

Pre-v4 Design Studio UX release — no pipeline changes.

- **Voice preset tips:** `usageHint` on Robot, Whisper, Slight mask
- **Background corners:** 3×3 image position grid; sizing + position side-by-side
- **Collapsible panels:** Bar style (Effects nested), Background, Voice — collapsed summaries via `studio-section-summaries.ts`; single Live preview
- **Summary polish:** S/V integers; higher-contrast alignment badge
- **V4 transcript layers:** `.ignore/transcript-design-notes.txt` — subtitles topmost over bars over background; subtitle backdrop + cheap text effects

### Pre-release audit (v3.1.0 gate)

| Check | Result |
|-------|--------|
| `npm run build` | Pass |
| `npm run zip` | Pass → `reddit-voice-notes-3.1.0-chrome.zip` |
| `npm run compile` | Pre-existing only: `background.ts` browser ns, `background-loader.ts` strictness (non-blocking) |
| Voice import graph | No `@/src/voice` barrel from popup/settings; `types.ts` leaf guard intact |
| Manifest version | `3.1.0` via `package.json` → `wxt.config.ts` |

**Next:** eloquent-1 — parallel transcribe wire from `stopRecording()` (see `eloquent-branch.md`).

## eloquent branch — v4 transcription (2026-06) — compaction handoff

**Branch:** `eloquent` from `main` v3.1.0 · **Plan:** `eloquent-branch.md` · **Architecture:** `docs/transcription-architecture.md` · **Bugs:** `docs/bug-archive.md` BUG-010…015

| Phase | Status |
|-------|--------|
| **eloquent-0** | **Done** — harness QA verified (JSON + SRT); tag **`eloquent-0-vosk-spike`** |
| **eloquent-1** | **Done** — parallel `MSG_TRANSCRIBE_*` wire from `stopRecording()`; session transcript store |
| **eloquent-2** | **Done** — Design Studio Subtitles panel + canvas preview overlay |
| **eloquent-3** | **Done** — FFmpeg subtitle burn-in (`base.mp4` → burned `final.mp4` when subtitles enabled) |
| eloquent-4 … eloquent-5 | Pending |

### eloquent-0 — what shipped

| Area | Files / notes |
|------|----------------|
| Types | `src/transcription/types.ts` — frozen `TranscriptResult`, `TranscriptConfig`, `SubtitleStyleConfig` |
| Decode | `decode-webm-audio.ts` — WebM → mono 16 kHz; copy + `assertPcmUsable` (BUG-015) |
| PCM QA | `pcm-stats.ts` — frame count, duration, peak, rms; relay coerce |
| API | `transcribe-audio.ts` — `transcribeWebmBlob()` + `enqueueTranscribeJob` |
| Sandbox bridge | `vosk-sandbox-client.ts` / `vosk-sandbox-host.ts` / `vosk-sandbox-protocol.ts` |
| Sandbox bundle | `public/vosk-sandbox.html` + `scripts/build-vosk-sandbox.mjs` → `public/vosk-sandbox.js` |
| Model | `scripts/fetch-vosk-model.mjs` → `public/vosk/model.tar.gz` (~40 MB, gitignored) |
| Harness | `entrypoints/transcribe-harness/` |
| SRT | `srt-builder.ts` |
| Messages | `MSG_TRANSCRIBE_*` frozen in `messaging/types.ts` (wire in eloquent-1) |

### Sandbox / CSP stack (each layer separate — do not regress)

| Bug | Problem | Fix |
|-----|---------|-----|
| BUG-010 | blob worker blocked by `child-src 'self'` | `worker-src blob: 'self'` in `wxt.config.ts` sandbox CSP |
| BUG-011 | IDBFS denied in blob:null worker | Non-fatal `syncFilesystem` patch in embedded worker |
| BUG-012 | vosk UMD → `createModel` undefined | UMD→ESM unwrap; `new Model()` + load wait |
| BUG-013 | `chrome-extension://` worker spawn blocked from null sandbox | Revert to blob worker (BUG-011 patch retained) |
| BUG-014 | `new URL(modelUrl, "null/uuid")` invalid | Absolute model URL from parent; worker URL patch |
| BUG-015 | Empty transcript — worker race + no PCM validate | Pace chunks, drain, wait for final; PCM asserts |

**Working architecture:**

```
transcribe-harness (extension origin)
  → decodeWebmToMonoPcm (Web Audio, owned Float32Array)
  → hidden iframe vosk-sandbox.html (manifest sandbox, null origin)
  → postMessage(transferable PCM + chrome-extension:// model URL)
  → vosk-sandbox.js → blob worker → Vosk WASM
  ← postMessage(TranscriptResult)
```

### Dev workflow (transcription QA)

```bash
npm install                    # model + vosk-sandbox.js
npm run build:vosk-sandbox     # after host/build script changes
npm run dev                    # load .output/chrome-mv3-dev at chrome://extensions
# transcribe-harness.html — WebM from recorder (not MP4)
```

Progress stages to watch: `decode-done:<pcm stats>` → `pcm-received:<pcm stats>` → `loading-model` → `inference-drain:<ms>` → `finalizing` → transcript JSON.

### Known limitations (eloquent-0)

- No IDBFS model cache in sandbox — re-download/unpack ~40 MB per cold session (MEMFS).
- Inference pacing is heuristic (~35% realtime drain) — may need tuning for long clips.
- Do not run FFmpeg + Vosk concurrently until memory profiled (separate queues exist).
- Popup/settings must not import `@/src/transcription` barrel (pulls Vosk).

### Commit chain (eloquent, CSP + inference)

`6f4b390` plan · `1898277` eloquent-0 spike · `915ce96` sandbox attempt · `f58996a` static sandbox · `f96248b` BUG-010 · `2e786ce` BUG-011 · `1413376` BUG-012 · `179f345` BUG-013 · `bf34b59` BUG-014 · `84862f9` BUG-015 PCM + inference pacing · tag **`eloquent-0-vosk-spike`**

### eloquent-1 — parallel wire (2026-06)

- `voice-recorder.ts` — non-blocking `webmClone.slice()` + `forkTranscribeWebm()` alongside `transcodeToMp4()`
- `transcribe-client.ts` — content-script `MSG_TRANSCRIBE_*` client (mirrors transcode relay)
- `background.ts` / `offscreen/main.ts` — transcribe relay + `enqueueTranscribeJob`; Vosk deferred via `whenTranscodeQueueIdle()` (memory gate)
- `session-transcript.ts` — in-memory + `sessionStorage` for latest `TranscriptResult`
- Cancel: `transcribeGeneration` + `AbortController` on session bump (BUG-005 pattern)

**QA:** Record on Reddit → console shows `Sending WebM for transcribe` + `Transcribe complete` with segment count; MP4 export unchanged on transcribe failure.

### eloquent-2 — Studio editor (2026-06)

- **Subtitles panel** in Design Studio (after Voice) — toggle, editable transcript textarea, position/font/backdrop controls
- **Canvas preview** — `drawSubtitlePreview()` topmost over bars in `renderThemePreview()`
- **Transcript relay** — `relaySaveSessionTranscript` → background → extension IDB (`session-transcript-db.ts`); Studio reloads on `visibilitychange`
- **Summary chip** — `formatSubtitleSummary()` in collapsed panel header
- Session-only draft (profile persistence = eloquent-4); export still `base.mp4` only until eloquent-3

**QA:** Record on Reddit → wait for `Transcribe complete` in console → Design Studio → enable Subtitles → edit text → preview updates live.

### eloquent-3 — burn-in export (2026-06-21)

- **Pipeline:** `stopRecording()` → transcode (`0–55%`) → await transcribe when subtitles enabled (`56–80%`) → second FFmpeg pass via `MSG_BURNIN_*` (`82–100%`)
- **Strategies:** `subtitles` filter + SRT (`buildSrtFromSegments`) → `drawtext` chain fallback
- **Fallback:** Subtitles off, transcribe fail, or burn-in fail → `base.mp4` unchanged semantics; toast on burn-in fallback
- **Files:** `subtitle-burnin.ts`, `burnin-client.ts`, `ffmpeg-runner.ts` (`runSubtitleBurnIn`), `voice-recorder.ts`, `background.ts`, `offscreen/main.ts`

**QA:** Enable Subtitles in Design Studio → record on Reddit → wait through Transcribing + Burning subtitles → attach MP4 → verify hard subs in player.

### eloquent-4a — edit before bake (2026-06-22) — **v3.3.0**

**Handoff:** `docs/eloquent-4-handoff.md` · **Tag:** `v3.3.0` (`fc50797`+)

- Studio: YouTube-style cue preview + segment editor + Confirm & save + Bake button
- Record stop delivers **base.mp4** only; burn-in deferred to user-confirmed Studio bake
- Session transcript: `originalResult` / `editedResult` in `rvnSessionTranscript` IDB
- **BUG-026:** recorder popup stuck at processing ~80% — fixed: stopped before base-MP4 relay; transcribe off progress bar

**QA verified (user):** edit → confirm → bake → recorder **stopped** → attach on Reddit; **edited SRT burns correctly**.

### v3.3.1 — BUG-027 UI fix

False **Update profile** highlight on Design Studio open — subtitle draft synced after profile dirty check; see `docs/bug-archive.md` BUG-027.

### v3.5.1 — BUG-031 drawtext textfile + transcript delivery UX (2026-06-22)

- **Burn-in:** cue text via `textfile=` per segment (fixes apostrophe/comma filter parse failures).
- **Studio:** unsaved-transcript bake prompt; `Pending` / `Ready` / `Timed out` transcript badges (120s, matches `TRANSCRIBE_TIMEOUT_MS`).
- **Stamp:** `BURNIN_PIPELINE_STAMP` → `drawtext-only-v3`.

**QA:** Record speech with apostrophes → bake with midnight bokeh preset → captions visible; new recording shows Pending until IDB transcript lands.

### Next: eloquent-4b

Segment-aware canvas preview, fonts, optional chunked base-MP4 relay.

## HANDOFF — eloquent profile nominal (2026-06-21)

**Tag:** `eloquent-profile-nominal` (`8834d4e`) — **user-verified:** profiles, backgrounds, Save/Update/Clone working  
**Handoff doc:** `docs/eloquent-profile-handoff.md` (root cause, what changed vs failed attempts, race rules, open subtitle issues)

### Why it works (one paragraph)

`rvnUserPrefs` was always correct in Extension Storage; Design Studio `activePrefs` was stale due to **concurrent subtitle/appearance RMW writes**, **parallel boot loads**, and a **subtitle `getDraftConfig` throw** that aborted `applyPrefs` before background/button sync. Fixed with `enqueuePrefsOp`, `load→reconcile→mount(initialPrefs)`, `prefsHydrated` gate, and `buildDraftConfig()` closure.

### Verified working

Profiles, HSV/styles, canvas + library backgrounds, Save/Update/Clone, voice preview, transcription, global subtitle toggle.

### Open (subtitle edits — not blocking profile UI)

Legacy profiles lack `transcriptConfig` snapshot until **Update profile** once; session transcript text stays in IDB not profile blobs; profile dirty labels don't use live subtitle draft (BUG-021 reverted). See handoff doc § Open / unfixed.

### Do not regress

Serialized prefs queue, studio boot order, `prefsHydrated`, no `flushPersist` before profile saves (BUG-021). Tags: `eloquent-profile-nominal` → `eloquent-prefs-hydrated` → `eloquent-semi-fixed`.

### Post-nominal — voice preview refresh + eloquent-3/4 call (2026-06-21)

**Sprint:** Voice preview auto-updates when a new WebM lands in `rvnLastRecording` while Design Studio stays open (`LAST_RECORDING_READY_KEY` + 2s IDB poll, same pattern as transcript refresh).

**Priority call:** Ship **eloquent-3** burn-in from `TranscriptResult.segments` JSON (`srt-builder.ts`) before fixing canvas segment preview or building a YouTube-style segment editor (**eloquent-4**). Transcription pipeline is correct; preview ingests flat full-text only (`subtitle-preview.ts` / `previewText()`).

**Open (non-blocking for burn-in):** Canvas subtitle preview does not show per-segment cues; Subtitles panel is far below Live preview; segment timing nudge UI tabled to eloquent-4. See `docs/eloquent-profile-handoff.md` § Open / unfixed.

## eloquent profile checkpoint — prefs hydrated (2026-06-21) [intermediate]

**Tag:** `eloquent-prefs-hydrated` (`7c11796`) — BUG-023 only; BUG-024 still open at tag  
**Doc:** `docs/eloquent-profile-checkpoint-hydrated.md`

## eloquent profile checkpoint — semi-fixed (2026-06-21) [superseded]

**Tag:** `eloquent-semi-fixed` (annotated WIP checkpoint — not a release)  
**Full audit:** `docs/eloquent-profile-checkpoint.md`  
**Superseded by:** `eloquent-prefs-hydrated` for profile apply behavior

### Working at checkpoint

| Area | Status |
|------|--------|
| Transcription pipeline | ✅ BUG-018 fix holds (`runTranscribeWebmBlob`) |
| Subtitles toggle persist | ✅ BUG-017/019/020 |
| Profile dropdown + names | ✅ |
| Bar styles / HSV / clip style on profile select | ✅ BUG-022 |
| Backgrounds + previews | ✅ |
| Design Studio panels / summaries | ✅ |

### Broken at checkpoint

| Area | Status |
|------|--------|
| **Clone / Save to new** button | ❌ hidden |
| **Update profile / Sure?** | ❌ stuck on **Save as profile** |
| Root UI condition | `activeProfileId` null or preset at `syncProfileButton` time (BUG-023) |

### Commit arc (do not re-apply BUG-021 wholesale)

`3bf833d` BUG-016 → `22fc616` BUG-017 → `a61f3f1` BUG-018 → `c997fa4` BUG-019 → `eaeba08` BUG-020 → `3dcd917` BUG-021 (**regression**) → checkpoint BUG-022 revert+style fix

### Storage audit (2026-06-21)

No profile migration from Local Storage → Extension Storage ever happened. Profiles in `rvnUserPrefs` (`chrome.storage.local`) since pretty-6 (`6541575`). DevTools **Extension Storage → Reddit Voice Notes** is normal manifest labeling. Only `localStorage` key: `rvn.subtitles.enabled` (BUG-019). Blobs: `rvnImageDb` IDB; session transcript: `rvnSessionTranscript` IDB. Full table: `docs/eloquent-profile-checkpoint.md` § Storage architecture audit.

### Next sprint (proposed)

Fix **BUG-023 only** — verify `activeProfileId` persistence on profile `<select>` change before any new subtitle/profile dirty logic.

---

## v4 Safety Net & Streamlined Principles (2026-06-22)

After the BUG-017…024 cluster (concurrent prefs RMW, boot races, throw-aborted syncs), the following artifacts were added to make v4 development resilient:

- **`docs/code-review.md`** — The canonical `/code-review` gate. **Mandatory**: name a stable fallback tag first (`v3.1.0` for main baseline; `eloquent-profile-nominal` for profile/subtitle work), run build/zip gate, and re-verify the race rules before touching prefs/profile/subtitle code.
- **`docs/v4-development-principles.md`** — Single source that consolidates branch design patterns (pretty/dulcet/eloquent), the fork-at-stop parallel model, compositing layers (bg < bars < subtitles burn-in), separate WASM queues, semantic health only, `enqueuePrefsOp` + `prefsHydrated` + `buildDraftConfig()` closure discipline, and one-phase-per-sprint rule.
- Stable restore tags (confirmed):
  - `v3.1.0` (main) — current release baseline.
  - `eloquent-profile-nominal` (8834d4e on eloquent) — verified profile + background + voice + subtitle toggle state.
- All future eloquent work (eloquent-3 burn-in onward) and any prefs/storage changes must pass the `/code-review` checklist before landing.

**Sprint contract reminder:** one well-defined phase/integration per exchange. Record the fallback tag used for the sprint.

Restore from known-good (example):
```bash
git checkout eloquent-profile-nominal && npm install && npm run dev
```

See also: `docs/engineering-principles.md`, `docs/eloquent-profile-handoff.md`, and the individual branch plans.
