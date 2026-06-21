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
| `main` | **v3.0.0** stable — voice effects + v2 personalization (2026-06) |
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

## v3.0.x polish on `main` (2026-06-21)

Pre-v4 UX polish — no version bump.

- **Voice preset tips:** `usageHint` on Robot, Whisper, Slight mask — shown in Design Studio when selected (`presets.ts` → `voice-controls.ts`)
- **Background corners:** `top-left` / `top-right` / `bottom-left` / `bottom-right` image position (`theme/types.ts`, `background-layout.ts`, 3×3 position grid)
- **Background layout:** Image sizing + position side-by-side (`studio__layout-row` flex)
- **Studio collapsible panels:** Header + profile bar + single **Live preview** stay fixed; **Bar style** (Effects nested inside), **Background**, **Voice** are `<details>` roll-ups with collapsed summaries (`studio-section-summaries.ts`); secondary/tertiary previews removed
- **V4 transcript layers:** `.ignore/transcript-design-notes.txt` — subtitles topmost over bars over background; subtitle backdrop + cheap text effects (shadow clone cheat)