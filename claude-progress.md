# Reddit Voice Notes — Session Progress

## v5.3.5 — Cue-Stable Overlay Caching (`feature/v5.3.5-cue-stable-overlay-caching`) — IN PROGRESS (2026-07-03)

**Plan:** `docs/5.3.5-cue-stable-overlay-caching-design.md`  
**Baseline:** v5.3.4 on `main` (`cd1fbcc`)

Cache fully painted cue graphics (`ImageBitmap` + LRU) keyed by cue identity, style hash, and quantized animation phase. Fast path replaces per-frame `paintCue` with `drawImage` blits. On by default for bake; bypassed in `singleFrameDebug`.

**Landed this session:**
- `subtitle-overlay-cue-cache.ts` — keys, 16 phase buckets, 64-entry LRU, stats
- `subtitle-overlay-renderer.ts` — `paintCueWithCache`, `enableCueCache` / `debug.logCacheStats`
- `scripts/test-cue-cache.mjs` — 9 unit tests (keys + phase bucketing)

**Remaining:** Overlay Lab perf QA, arch doc §, release notes, optional SSIM visual parity check.

### Restore / test

```bash
git checkout feature/v5.3.5-cue-stable-overlay-caching && npm install && npm run dev
node scripts/test-cue-cache.mjs
```

---

## v5.3.4 — Subtitle Canvas Overlay (`feature/v5.3.4-subtitle-canvas-overlay`) — COMPLETE (2026-07-03)

**Plan (source of truth):** `docs/v5.3.4-subtitle-canvas-overlay.md` (progress table, Phase 3.5 spec, handoff checklists)  
**Task tracker:** `TODO.md` (short pointer only — detail lives in design doc)

Offload per-cue glow/border from FFmpeg `drawtext` (BUG-035 / 64-layer ceiling) to an offline Canvas 2D overlay WebM, then cheap FFmpeg composite. Additive; drawtext path remains fallback until Phase 4 wires strategy selection.

| Phase | Status | Commit |
|-------|--------|--------|
| 1 — skeleton + dev harness | DONE, user-QA'd | `2c8c450` |
| 2 — render loop + MediaRecorder capture | DONE, user-QA'd | `88f856c` |
| 2½ — empty WebM, seek/scrub, VP8 edge hardening | DONE, user-QA'd | `224c361`, `9ab41fe` |
| 3 — paint fidelity + compare harness + glow fix | DONE, user-QA'd | `c54e874`, `6a609ce`, `2334c6b` |
| **3.5 — canvas visual polish** | **DONE**, user-QA'd | `dbbc9cb` … `432683a` |
| **4 — burn-in pipeline integration** | **DONE**, user-QA'd | `ac2d52e` … `6641d35` |
| 5 — production polish, lab panel, arch docs | **DONE**, user-QA'd | `ed4265f` … |

**User QA (2026-07-01, all pass):** single overlay render, download, scrub; compare harness (drawtext + canvas both visible); halo + border modes functional after duplicate-layer glow fix. **Remaining aesthetic:** halo too sharp / border-like → Phase 3.5.1.

**Phase 3.5.1 (2026-07-01):** DONE — user QA pass. Canvas halo uses `buildGlowLayerSpecs(..., 'full')` + `shadowBlur` underpass (`dbbc9cb`). Softness acceptable; no VP8 bleed.

**Phase 3.5.2 (2026-07-01):** Dual contrasting border — QA pass on contrast matrix. `resolveInnerBorderColor()` + stroke-based dual border.

**Halo polish (2026-07-01):** Patchy/muddy soft halo — `buildCanvasOverlayHaloLayerSpecs` integral-normalized rings + budget-split underpass (`324ab90`).

**3.5.2/3.5.1 follow-up polish (2026-07-01):** (1) Dual border strokes now scale with `glow.opacity` (fixed halo+dual inner keyline ignoring strength slider). (2) Per-cue glow clip from text metrics + bleed — fixes top-right artifacts on long cues (uniform frame inset was clipping whisper ring / shadowBlur).

**Checkpoint tag (2026-07-01):** `5.3.4-double-border` → `a0c3ba8` (dual border + halo polish complete; fallback before 3.5.3 gradient work).

**Phase 3.5.3 (2026-07-01):** Opinionated vertical text gradient — QA pass. Stop 0 = glyph top highlight, stop 1 = bottom base; white bottom `#f6f6f6`.

**Phase 3.5.3b (2026-07-01):** Text gradient wave — QA pass. `createCanvasOverlayTextGradient()` + `textGradientWave`; cycle `CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS` = 3.5s. Tag `5.3.4-gradient-wave`.

**Phase 3.5.4:** Deferred — backdrop `borderRadius` QA pass; no code changes needed.

**Future ideas:** `docs/future-ideas.md` — subtitle gradient/wave + glow hue-rotate tunable variable catalog.

**Phase 3.5.5 (2026-07-01):** Per-frame glow hue rotate — QA pass. `colorSource: 'rainbow'`, `hueRotateMode` (`rainbow` | `monochromatic`), `resolveCanvasOverlayGlowHex()`; DEV UI under Theme glow. Canvas overlay only.

**Glow clip hardening (2026-07-01):** QA pass — cap-glyph + long-cue edge artifacts resolved. Ink-box `TextMetrics` clip + asymmetric bleed (top/left/right/bottom); glow-only clip (main text/gradient outside); horizontal bleed for line start/end (`432683a`).

**Phase 3.5.6 (2026-07-02):** Dev harness QA note — subtitle panel toggles (halo, gradient, wave, dual border, hue rotate) apply to both render/compare buttons.

**Checkpoint tag (2026-07-02):** `5.3.4-phase-3.5-complete` → `432683a` (all 3.5 effects QA'd; gate cleared for Phase 4).

**Phase 4 (2026-07-02):** Burn-in integration — `useCanvasOverlay` + `canvasOverlayBytes` on `SubtitleBurnInInput`; `buildCanvasOverlayStrategy()` (single `overlay=0:0` filter); `shouldPreferCanvasOverlay()` auto-select; drawtext tiers remain fallback. Dev button **Bake with Canvas Overlay (full pipeline)** — user QA pass (2026-07-02). **Production bake:** `bakeSubtitlesInStudio` auto-selects canvas via `shouldPreferCanvasOverlay` (render + composite in Studio; drawtext offscreen fallback when plain style). Dev harness modal + button row scroll/wrap CSS.

**Alpha composite fix (2026-07-02):** Canvas bake blocked base video with opaque black matte — wasm decode dropped VP8A. Fix: `normalizeOverlayWebmForComposite()` (`libvpx` → yuva420p WebM) before composite; composite tiers use `format=yuva420p` + `-c:v libvpx` decode (no `format=auto`). **Follow-up:** wasm codec name is `libvpx` not `libvpx-vp8`; `writeBurnInExtras` slices overlay bytes per strategy retry (fixes detached ArrayBuffer on multi-tier canvas bake).

**Phase 4 user QA (2026-07-02):** Pass — full canvas bake visually correct (alpha composite, subtitles readable). **Performance note:** ~few seconds wall time per second of video (canvas 30 fps render + normalize + wasm composite). Acceptable for now; percent stage indicators work. Polished chronos meter / elapsed-time UX deferred to Phase 5 (not implementing progress bar this sprint).

**Checkpoint tag (2026-07-02):** `5.3.4-phase-4-complete`.

**Phase 5.1 (2026-07-02):** Chronos meter on subtitle bake — user-QA'd. Amber progress bar + elapsed/ETA line (`bake-chronos.ts`); per-frame `onRenderProgress`; alpha-normalize creep + "Preparing overlay…"; soft-step display ratio for compositing ETA.

**Phase 5.2 (2026-07-02):** Shared `prepareSegmentsForSubtitleBake()` — drawtext + canvas overlay use one segment-prep path (blank/scaffold filter, missing timings, min duration, clip clamp). Tests: `test-bake-segments.mjs`.

**Phase 5.3 (2026-07-02):** Canvas render perf guard — production bake aborts slow offline render (2.5–3 min budget) and falls back to drawtext. **Stress QA timeouts:** `FINALIZE_TIMEOUT_MS` 6 min; render guard cap 3 min / floor 2.5 min. Bake UI hint for multi-minute long-clip bakes. Perf optimization deferred → `docs/future-ideas.md`.

**Phase 5.4 (2026-07-02):** Subtitle Overlay Lab — persistent gated QA panel replacing inline dev harness. Synthetic segment sets (short 3 / medium 8 / long 16 cues), lab effect toggles, backdrop radius slider, inner-border color preview, side-by-side compare, separate downloads (overlay / drawtext / composite / timing JSON), one-click full canvas bake. Modules: `subtitle-overlay-lab.ts`, `subtitle-overlay-lab-segments.ts`. Tests: `test-overlay-lab-segments.mjs`.

**Phase 5.5 (2026-07-03):** `docs/transcription-architecture.md` — canvas overlay path, module map, strategy table, perf guard scope. Sync comments in `subtitle-burnin.ts`, `subtitle-effects.ts`.

**Phase 5.6 (2026-07-03):** User QA via Overlay Lab timing logs (`.ignore/sub-QA-harness-logs/`) + stress notes — 3–534 cues, 11–120 s clips, rich effects; full bake 534 cues / 62 s OK (~286 s). Perf analysis recorded in design doc § Performance QA.

**v5.3.4 release (2026-07-03):** Merged `feature/v5.3.4-subtitle-canvas-overlay` → `main`. Tags: `5.3.4-phase-5-complete`, `5.3.4-complete`. Package `5.3.4`. Push deferred (user).

**Key modules:** `subtitle-overlay-renderer.ts`, `subtitle-overlay-fonts.ts`, `overlay-webm-finalize.ts`, `subtitle-overlay-compare.ts`, `subtitle-overlay-lab.ts`, `subtitle-controls.ts`.

**Phase 3.5 scope (before Phase 4):** (1) halo diffusion, (2) dual contrasting border, (3) opinionated text gradient, (4) backdrop rounding QA/tune (`borderRadius` already wired), (5) rainbow per-frame glow. Canvas-only — no drawtext layer explosion. See design doc Phase 3.5 for full spec.

**Doc refresh (2026-07-01):** Integrated `TODO.md` polish deliverables into `docs/v5.3.4-subtitle-canvas-overlay.md` as Phase 3.5; reconciled phase order (3.5 before 4); aligned API notes with existing `SubtitleGlowConfig` / `specialHue` / `backdrop.borderRadius`; noted rounded rects already ship in Phase 3.

### Restore / test

```bash
git checkout feature/v5.3.4-subtitle-canvas-overlay && npm install && npm run dev
```

Design Studio → Subtitles → DEV buttons. Record on Reddit first for compare drawtext side.

---

## Dulcet II Branch 4 `dulcet-ii/character-system` — ✅ COMPLETE (2026-06-25)

Graph-native voice system, merged to `dulcet-ii/integration`. Six commits 9b4a443 → 5cfa5c1.

- **4.1** — graph-native backbone (`VoiceEffectConfig.graph`), standalone Custom composer (7 fragment categories, curated core + Advanced reveal, seed-then-tweak, blank-slate / reset-order), wired into the Studio voice panel replacing the pitch/formant/character knobs.
- **4.2** — character **chip picker** as the front door (replaces the legacy preset + character dropdowns); new **Incognito** anonymizer preset (pitch+formant+de-ess, graph-native replacement for the old "slight mask").
- **4.2b** — voice **state hardening** (surfaced by loading a legacy profile): `formatVoiceEffectSummary` + dirty-check moved onto the graph world (were blind to `graph`/`characterPresetId` → "Off" / phantom names); `voiceEffectUserIntentKey` made id-free (volatile fragment ids caused permanent-dirty); `voiceControls.flushPersist()` contract added + flushed in `studioPersist` (profile snapshot was racing the 250ms voice debounce); dirty-check now reads the live draft. Custom-voice status pill (named after the profile) + helper. Fixed smart-quote class attrs from 4.2.
- **4.3** — **legacy strip** (−1,117 lines): deleted `presets.ts`, `filter-graphs.ts`, `migrate-v1.ts`, `offscreen-queue.ts`; removed flat fields (pitchShift/eq/dynamics/reverb) + `presetId`/`VoiceEffectPresetId` from `VoiceEffectConfig`; removed `resolveVoiceEffectConfig`/`scaleVoiceEffectByIntensity`/`voiceEffectIsActive` + the legacy `processAudio`/`processAudioBytes`; removed the always-disabled "Play preview" button (preview-chain is now a dry player); voice-harness + offscreen harness are graph-only.

**The bake never changed** — the real export always used `resolveVoiceGraph` → `buildStylizedGraph`. All bugs were in the legacy *state/describe/compare* layer, now removed. Confirmed by user production smoke test. `tsc --noEmit` + `wxt build` clean. Deferred: per-primitive non-linear intensity curves.

**Architecture note:** see memory `project_voice_resolve_worlds.md` and `docs/architecture/extension-points.md` (rewritten for the graph-native model).

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
| `main` | **v4.0.0** stable — **Eloquent I** subtitles + Design Studio v4 (2026-06-24) |
| `eloquent` | **Merged** into `main` as **v4.0.0** (2026-06-24); branch retained for history |
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

### v3.6.0 stable — eloquent subtitle pipeline hardened (2026-06-22)

**Tag:** `v3.6.0` · **Branch:** `eloquent` · **Handoff:** `docs/eloquent-4-handoff.md`  
**Release zip:** `.output/reddit-voice-notes-3.6.0-chrome.zip`

**Why this is stable:** User-verified multi-run edit→bake→attach (with and without cue edits). Burn-in loop BUG-028…032 closed: valid drawtext colors, backdrop plate compositing, no silent SRT fallback, offscreen recycle + code stamp on HMR, per-cue `textfile=` for punctuation, session-persisted transcribe relay registry. Pending → Ready transcript badges give honest delivery UX while Vosk runs in parallel.

| Sprint | Scope |
|--------|-------|
| v3.5.0 | Segment editor polish, cue preview, OOB badge, recorder Design Studio CTA |
| v3.5.1 (BUG-031) | `textfile=` burn-in; unsaved bake guard; Pending/Ready/Timed out badges |
| v3.5.2 (BUG-032) | `relay-registry.ts`; never delete relay maps before `relay*Failure` |
| BUG-028…030 | drawtext color fixes, backdrop layer order, offscreen stale-worker hardening |

**QA verified (user, 2026-06-22):** Repeat recordings seamless; edits optional; pending badges accurate; no transcribe relay console warnings after reload.

**Design Studio reference:** `docs/design-studio.md` — canonical semantic framework for the four sections (Bar style, Background, Voice, Subtitles), dirty-state taxonomy, storage map, and UI refresh guardrails.

**Restore:**
```bash
git checkout v3.6.0 && npm install && npm run dev
```

### Next: eloquent-4b remainder + eloquent-5

Segment-aware canvas preview, font picker, optional chunked base-MP4 relay, profile subtitle UX polish, then eloquent-5 harden → merge `main` → **v4.0.0**.

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

Serialized prefs queue, studio boot order, `prefsHydrated`, no `flushPersist` before profile saves (BUG-021). Full rules: `docs/design-studio.md` §3. Tags: `v3.6.0` (Studio stable) · `eloquent-profile-nominal` (profile baseline).

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

No profile migration from Local Storage → Extension Storage ever happened. Profiles in `rvnUserPrefs` (`chrome.storage.local`) since pretty-6 (`6541575`). DevTools **Extension Storage → Reddit Voice Notes** is normal manifest labeling. Only `localStorage` key: `rvn.subtitles.enabled` (BUG-019). Blobs: `rvnImageDb` IDB; session transcript: `rvnSessionTranscript` IDB. Full table (current): `docs/design-studio.md` §3.2. Historical audit: `docs/eloquent-profile-checkpoint.md`.

### Next sprint (proposed)

Fix **BUG-023 only** — verify `activeProfileId` persistence on profile `<select>` change before any new subtitle/profile dirty logic.

---

## v4 Safety Net & Streamlined Principles (2026-06-22)

After the BUG-017…024 cluster (concurrent prefs RMW, boot races, throw-aborted syncs), the following artifacts were added to make v4 development resilient:

- **`docs/design-studio.md`** — **Canonical Design Studio reference** — four sections, dirty-state taxonomy, storage map, UI refresh guardrails.
- **`docs/code-review.md`** — The canonical `/code-review` gate. **Mandatory**: name a stable fallback tag first (`v3.1.0` for main baseline; **`v3.7.0`** for eloquent UI shell + subtitles; `v3.6.0` for pipeline-only baseline; `eloquent-profile-nominal` for profile-only regressions), run build/zip gate, and re-verify the race rules before touching prefs/profile/subtitle code.
- **`docs/v4-development-principles.md`** — Cross-branch pipeline law (fork-at-stop, compositing, WASM queues, prefs discipline). Studio UI semantics: `docs/design-studio.md`.
- Stable restore tags (confirmed):
  - `v3.1.0` (main) — release baseline without subtitles.
  - `v3.7.0` (eloquent) — v4 UI shell + subtitle pipeline (**current**).
  - `v3.6.0` (eloquent) — subtitle pipeline; pre–v4 shell.
  - `eloquent-profile-nominal` (8834d4e on eloquent) — profile + background + voice + subtitle toggle (pre–burn-in hardening).
- All future eloquent work (eloquent-3 burn-in onward) and any prefs/storage changes must pass the `/code-review` checklist before landing.

**Sprint contract reminder:** one well-defined phase/integration per exchange. Record the fallback tag used for the sprint.

Restore from known-good (example):
```bash
git checkout eloquent-profile-nominal && npm install && npm run dev
```

See also: `docs/design-studio.md`, `docs/engineering-principles.md`, `docs/eloquent-profile-handoff.md`, and the individual branch plans.

## v3.7.0 stable — Design Studio v4 UI shell (2026-06-23)

**Tag:** `v3.7.0` · **Branch:** `eloquent` · **Release:** `docs/release-notes-v3.7.0.md`  
**Restore:** `git checkout v3.7.0 && npm install && npm run dev`  
**Prior:** `v3.6.0` (subtitle pipeline; legacy `<details>` layout)

### Shipped (condensed)

- **Shell:** `.studio-v4` — hero row + 1×4 status cards + sub-panel navigation (`5217d55`…`519c098`)
- **Profile status:** Subtitles? + Ready? strip; sub-panel exit guard + v4 button palette
- **Live preview:** Shared 628×348 box; canvas `clip-path` + mask-cutout bezel overlay (**logic verified** — see below)
- **Recorder:** Always-visible **Go here first** + Open Design Studio CTA

### Hero preview layering (canonical — do not regress)

1. One shared preview box (`aspect-ratio` = frame artboard **628×348**).
2. Canvas fills box; `clip-path: inset(...)` punches WYSIWYG viewport hole.
3. Bezel SVG mask overlay (`::after`, `z-index: 3`, `0 0 / 100% 100%`).
4. No translucent center fill over canvas. Artboard must match drawn frame (no dead viewBox margin).

**Assets:** `preview-window-frame.svg` · `preview-window-frame.legacy.svg`

### Next (post–v3.7)

Sub-panel control chrome (knobs/sliders), main Done asset, eloquent-4b remainder → eloquent-5 → merge `main` → v4.0.0.

## v3.7.1 — sub-panel previews (2026-06-23, in progress toward v3.8)

**Version:** `3.7.1` · **Branch:** `eloquent`

## UX Refresh Sprint — 3-Phase Workflow Guidance (2026-06-23, in progress toward v3.8)

**Branch:** `eloquent` · **Fallback tag:** `v3.7.1`

### Guiding principles source
`.ignore/ux-guiding-principles.txt` + `.ignore/ux-refresh-sprint.txt`

### Goal
Add a clear, professional **3-Phase Creative Workflow** guidance layer on top of the existing eloquent UI so users always know where they are and what to do next across the Reddit↔Studio tab split.

| Phase | Tab | Status |
|-------|-----|--------|
| **Phase 1: Design** | Design Studio | Shown on banner when no recording exists |
| **Phase 2: Capture** | Reddit tab | Set when user clicks "Switch to Reddit"; recorder label changes |
| **Phase 3: Polish & Bake** | Design Studio | Auto-promoted when recording exists; banner CTAs surface bake flow |

### Shipped (commit `66752f2`)

| File | Change |
|------|--------|
| `src/workflow/workflow-state.ts` (NEW) | `WorkflowPhase` type; `rvn.workflow.phase` CRUD; `activateRedditTab()` |
| `src/ui/design-studio/workflow-phase-banner.ts` (NEW) | 3-step stepper + contextual CTA + "Why the switch?" disclosure |
| `entrypoints/design-studio/style.css` | `.wf-banner` / `.wf-stepper` / `.wf-step` / `.wf-cta` — CVD palette |
| `entrypoints/design-studio/main.ts` | Load phase in parallel with prefs at boot |
| `src/ui/design-studio/mount-clip-studio.ts` | Inject `data-workflow-banner`; mount/sync/dispose banner |
| `src/ui/recorder-panel.ts` | Phase-aware hint labels; `setWorkflowPhase('polish')` on stop |

**Design principles checklist:**
- ✅ Visibility of System Status — 3-step indicator always visible; phase label contextual
- ✅ Match Between System and Real World — Design→Capture→Polish framing mirrors film production
- ✅ User Control & Freedom — "Switch to Reddit" / "Switch to Reddit to attach" CTAs on banner
- ✅ Consistency — same phase names in both tabs; same `rvn.workflow.phase` key
- ✅ Reduce Cognitive Load — "Why the switch?" is collapsed by default; CTA changes per phase
- ✅ Minimal & High-Impact — 6 files changed; no existing feature removed or refactored

### Shipped (prev)

- **Bar style / Background sub-panels:** Compact framed WYSIWYG live preview at top (same 628×348 clip-path + bezel, max-width ~280px) — shares `renderThemePreview` RAF loop with hero canvas.
- **Subtitles sub-panel:** Caption text preview at top (`drawSubtitleTextOnlyPreview` — style fidelity without full bars/bg); **Bake** moved from bottom to top with amber 9-slice chrome (`studio-v4__bake-btn`).
- **Preview kinds:** `subpanel` + `subtitle-text` in `preview-block.ts`.
- **Bake button states:** `unavailable` / `ready` / `baking` / `complete` — class-driven visuals aligned with `canBakeNow()` (requires transcript matched to current recording + delivery ready + confirmed edits).
- **Bake compositing fix:** `button-frame-9slice` must use border-image **edges only** (no `fill`) — SVG center is dark `#12001f`; `fill` painted over CSS amber gradients (flash-then-gray symptom). See `studioV4BorderImageEdgesOnly()`.
- **Bake UX:** “Repeatable” hint under bake status; disable-subtitles guard clears IDB transcript only after confirm (no accidental wipe on re-enable).

## v4.0.0 stable — **Eloquent I** merged to `main` (2026-06-24)

**Tag:** `v4.0.0` · **Codename:** Eloquent I · **Release:** `docs/release-notes-v4.0.0.md`  
**Merge:** `eloquent` → `main` (92 commits from v3.1.0)  
**Release zip:** `.output/reddit-voice-notes-4.0.0-chrome.zip` (~57 MB)

### Pre-merge gate (passed)

| Check | Result |
|-------|--------|
| `npm run build` | Pass |
| `npm run zip` | Pass |
| `npm run compile` | Pre-existing strictness warnings only (non-blocking) |
| eloquent-5 hardening | H1–H4 resolved; relay SW-restart; font loader resilience |
| User-verified | Edit → bake → attach; repeatable rebake; disable guard |

### What shipped (condensed)

- **Subtitles:** Vosk WASM STT, parallel transcribe wire, edit-before-bake, FFmpeg burn-in, DejaVu fonts
- **Design Studio v4:** Hero preview, status cards, sub-panels, segment editor, workflow phase banner
- **Architecture:** `docs/architecture/` map + hardening backlog; `docs/v4-development-principles.md`

**Restore:**
```bash
git checkout v4.0.0 && npm install && npm run dev
```

---

## Dulcet II (v5) — `dulcet-ii/dsp-foundation` (2026-06-24, in progress)

**Design doc:** `docs/dsp-foundation-design.md` · **Roadmap:** `docs/v5-development-roadmap*.md` + `docs/v5-implementation-notes.md`

### Branch naming (git ref D/F conflict — important)
v5 reuses the "dulcet" codename, but the old `dulcet` branch (merged v3) still exists,
and git can't have both a branch `dulcet-ii` and branches under `dulcet-ii/`. So
**`dulcet-ii` is a namespace**: integration line = `dulcet-ii/integration`; features =
`dulcet-ii/dsp-foundation` (+ `pitch-formant`, `preview-pipeline`, `character-system`).
Read roadmap's `dulcet`→`dulcet-ii/integration`, `dulcet/<x>`→`dulcet-ii/<x>`.

### Locked v5 decisions (user, 2026-06-24)
1. Fresh `dulcet-ii` namespace; old `dulcet` untouched.
2. **Replace + migrate** the voice config — fragment graph is canonical, flat
   `VoiceEffectConfig` becomes a legacy migration input. No prod user data (dev
   profiles only) → no long-term compat shim. Forward-looking posture for all v5.
3. Backend-agnostic fragment descriptors + FFmpeg emitter now; Web Audio in Branch 3.

### Sub-Phase 1.1 — DONE
New self-contained `src/voice/dsp/` module (additive, **unwired** — legacy export
path untouched, build green):
- `fragment-types.ts` — canonical `StylizedGraph` + 21 fragment kinds / 7 categories +
  `FRAGMENT_DEFS` registry + normalize/create. Pure-data leaf (no WASM, popup-safe).
- `renderer.ts` — backend-agnostic `FragmentRenderer` + `RenderContext`.
- `ffmpeg-renderer.ts` — emits `-af` / (1.2) `-filter_complex`; v1 primitive emitters
  (pitch, eq, compressor, gate, limiter, echo) implemented; stylized kinds skip to 1.2.
- `build-stylized-graph.ts` — `buildStylizedGraph()` + `CANONICAL_CHAIN_ORDER`.
- `migrate-v1.ts` — legacy config → graph.

**Smoke-verified round-trip** (compiled dsp to CJS, ran under node): robot →
`pitchFormant→eq→compressor` with byte-identical legacy EQ (`g=3`/`g=-2`); intensity
scales `-5→-2`; whisper normalize→compressor; voice-off → `none`; unimplemented kind
skips to `none` (no crash). `tsc --noEmit`: zero new errors (only pre-existing
background.ts / background-loader.ts / voice-recorder.ts / segment-cue-player.ts).

### Sub-Phase 1.2a — DONE
`CANONICAL_CHAIN_ORDER` confirmed by user (clean → shape → character → space → safety).
Linear-`-af` stylized emitters added (15/21 kinds now emit): flanger, chorus, aphaser,
tremolo, vibrato; saturation (`asoftclip`), harmonicExciter (`aexciter`), presenceAir
(`equalizer`+`treble`); deEsser (`deesser`), deClick (`adeclick`). Strength scales with
intensity, LFO rate stays raw. Smoke-verified syntax + scaling; tsc clean.

### Sub-Phase 1.2b-i — DONE
`-filter_complex` assembler + parallel-node model (`ParallelSpec`: lavfi `sources`,
`auxInputs` for extra `-i` files, dry/wet `amix`, mono normalization at graph head)
in `ffmpeg-renderer.ts`; `ringMod` implemented (sine × signal via `amultiply`).
16/21 kinds emit. Smoke-verified graph threading for linear+parallel chains; tsc clean.
**IR decision (user):** procedural/synthesized JS IRs for convReverb (no sampled assets).

### Sub-Phase 1.2b — DONE (all 21 kinds emit)
New `ir-generator.ts` (procedural reverb IR + WAV encoder; reused by Branch 3 preview
ConvolverNode). Emitters added: convReverb (IR→WAV aux→`afir`, mixDuration longest to
keep tail), hybridLayer (parallel synth layer *derived from voice* → finite, no
infinite source), granular (linear `aecho` multi-tap smear — approximation; true
per-grain = future WASM), spectralCarve (resonant EQ peaks vocal→metallic). Added
per-`ParallelSpec` `mixDuration`. Kitchen-sink graph (pitch→sat→carve→ringMod→
granular→convReverb) smoke-verified; tsc clean. **Sub-Phase 1.2 COMPLETE.**

### Sub-Phase 1.3 — step 1 DONE (graph runs in ffmpeg.wasm)
`process-audio.ts`: `processAudioBytesWithGraph()` / `processAudioWithGraph()` execute
a `StylizedGraph` through ffmpeg.wasm — linear `-af` AND complex `-filter_complex`
(writes aux IR WAVs as extra `-i`, `-map`s output pad, 120s timeout for convolution).
Additive — legacy `processAudioBytes(config)` path untouched; tsc clean (only the 4
pre-existing error files remain). Harness-testable now.

### Harness OOB fix + graph-mode QA (2026-06-24)
**Symptom:** voice-harness crashed `RuntimeError: memory access out of bounds` on every
`processAudioBytes` run (process-audio.ts catch). **Root cause:** the isolated processor
encoded `-c:a libopus`, but libopus is absent/broken in the shipped `@ffmpeg/core ^0.12.10`
— a missing encoder crashes ffmpeg.wasm as a generic OOB. (No-op runs skip `exec` → didn't
crash; the shipped transcode uses `-c:a aac` → always worked.) **Fix:** encode AAC/M4A in
`process-audio.ts` (both legacy + graph paths; OUTPUT_PATH `.m4a`, mimeType `audio/mp4`).
Also: export+attach `attachLogCollector` in `execWithTimeout` so ffmpeg stderr (the real
filter/encoder error) shows in console; **voice-harness rewired** with a Pipeline toggle
(Graph v5 / Legacy) + per-fragment checkboxes (from `FRAGMENT_DEFS`) so the new stylized
graph is actually testable. tsc clean; build passes. **Re-test needed:** confirm AAC fixes
the OOB and which stylized filters run in the core (watch `[ffmpeg]` console lines).

### Foundation user-confirmed + reverb fix + intensity curve (2026-06-24)
**User QA via harness (all 21 fragments):** Legacy great (formant shift a noticeable
win); Dynamics, Modulation, Color all work; **Granular + Hybrid praised ("PERFECT");**
convReverb works. **Only bug:** `algoReverb` (Echo/Reverb) threw `aecho` "Number of
delays 2 differs from number of decays 1". **Fixed** in `ffmpeg-renderer.ts emitAlgoReverb`
+ legacy `filter-graphs.ts buildReverbFilter` (matching delay/decay counts; synced BUG FIX
comments). Core config dump confirms all used filters present (afir/aexciter/asoftclip/
deesser/adeclick/amultiply/sine) — no fallback approximations needed; libopus is a
decoder but not usable as `-c:a` encoder (AAC swap was correct).
**Non-linear intensity curve (1.3):** `RenderContext.intensityFactor = (intensity/10)**1.3`
— f(0)=0, **f(10)=1.0 (nominal unchanged → preserves confirmed behavior)**, f(12)≈1.27.
pitch/EQ emitters now use `ctx.intensityFactor`. Harness gained intensity slider + Turbo.
Smoke-verified; build passes. **Merged dulcet-ii/dsp-foundation → dulcet-ii/integration.**

### Native presets + combination coverage + ephemeral-error hardening (2026-06-24)
- **Character presets** (`src/voice/dsp/preset-graphs.ts`): Cyber Oracle, Glitch Beast,
  Ethereal Singer, Radio Demon, Helium Sprite, Abyssal Titan — authored natively as
  StylizedGraphs (each a curated, known-good fragment combination). Wired into the
  voice-harness as a "Character preset" dropdown (overrides manual toggles).
- **Ephemeral error** (hybrid voice + pitch slider ≠ 0 → intermittent exit-1, not
  reproducible after restart): that combo is the only graph stacking TWO full
  asetrate→aresample→atempo resample chains (pitch + hybrid octave-down) → heaviest
  graph, ffmpeg.wasm ~32MB heap pressure. **Determined NOT a construction bug** — a
  68-combination structural validator (singles, all pitch×other pairs, all 4
  pitch+hybrid carriers, ALL-on, turbo, every preset) passed 0 failures (label
  consistency + aecho/chorus arg counts). **Mitigation:** `processAudioBytesWithGraph`
  now disposes + reloads ffmpeg for `mode==='complex'` graphs → fresh heap per heavy
  run. If it recurs, the `[ffmpeg]` log now shows the real cause.
- tsc clean; build passes. Pending: user re-test + merge to integration.

### Preset tuning + README + NerdRage (2026-06-24) — user-confirmed, merged
User auditioned all 6 presets: all stable, no edge cases; fresh-heap fix held under
repeated pitch+hybrid hammering. Tunings applied:
- **NerdRage 🧪** — new preset cloning the ORIGINAL Cyber Oracle voicing as-is (homage
  to NurdRage YT channel). 🧪 emoji in label for final build.
- **Cyber Oracle** — retuned much more metallic: ringMod freq 80→320 + mix 16→42,
  spectralCarve 45/75→58/90, added flanger comb sweep (layering), pitch char 40→55.
- **Glitch Beast / Radio Demon** — "loud" fix is **makeup-gain only** (pure post-comp
  level): Glitch makeup 35→15, Radio 45→20. Saturation pre-gain (the grit) + EQ
  (broadcast tone) are load-bearing and **left intact** per user (volume-only, no
  effect sacrifice). Confirmed makeup is not necessary for the effect before reducing.
- **Abyssal Titan** — added subtle granular (mix 20) for edge.
- **README** — new "Character voice presets (Dulcet II / v5)" section (flagship framing,
  preset table, "roll your own" from 21 fragments / 7 categories, points to design doc).
All 7 presets structurally validated; build passes. **Merged to dulcet-ii/integration.**

### Live-export wiring — step 1 DONE (user-confirmed live)
`ffmpeg-runner.ts:462` now sources the export `-af` from
`buildStylizedGraph(migrateVoiceEffectToGraph(normalizedVoice))` (linear mode), replacing
`buildFfmpegAudioFilter` + `voiceEffectIsActive`. Existing raw-audio fallback retained.
**User-verified live:** presets bake unchanged, carries into bake, toggle-off defeats
effects, zero console errors (offscreen/SW/tabs). Complex graphs not yet wired (→ step 2).
**Slight-mask "sounds deep" investigated:** legacy-vs-graph `-af` diff shows slight-mask
byte-identical @10 (pitch identical at all intensities; EQ ≤0.3 dB) — NOT a regression.
It's the preset's design (−3 downshift + high cut). Migration does change Robot (stronger
compressor+makeup) and Whisper (loudnorm→compressor) — fine, replaced when basics authored
natively. Non-linear curve makes higher/whisper gentler at non-10 intensities (expected).

### Live-export step 2a DONE — character preset storage + export resolution
Chosen direction (user): expose character presets in Studio via lightweight `characterPresetId`
(no full StylizedGraph storage swap yet). Step 2a (smoke-verified, not yet live):
- `types.ts`: `characterPresetId?: string` on VoiceEffectConfig + normalize pass-through (drops empty).
- `ffmpeg-runner.ts`: if `characterPresetId` resolves to a character preset → `characterPresetGraph`
  (intensity/turbo from config) → `buildStylizedGraph`; else legacy `migrateVoiceEffectToGraph`.
  Linear character presets (Helium Sprite) → `-af` bakes; complex ones → null → raw fallback until
  complex-export step. Unknown id / no id → legacy unchanged (zero regression).
- **Next 2b:** Studio voice picker → set `characterPresetId` (makes it live-testable). Preview stays
  legacy-only for character presets until Branch 3 (bake-to-hear; show a note). voice-controls.ts is
  the race-prone file — read fully + show exact diff before editing.

### Live-export step 2b DONE — Studio character-voice picker (user-confirmed live, 2026-06-24)
`src/ui/design-studio/voice-controls.ts`: added a separate **"Character voice (v5)"** `<select>`
(below the legacy preset picker) populated from `CHARACTER_PRESETS`. On change it sets
`draftConfig.characterPresetId` (forces `enabled` when set), persists, and shows a note
("overrides on bake; Play uses the preset above"). `syncControlsFromDraft` sets the select +
note from `draftConfig`. Separate dropdown chosen to NOT disturb the race-prone legacy
picker/custom/sync logic. **User-verified live:** Helium Sprite (linear) bakes into the
character voice & sounds great; complex presets (Cyber Oracle etc.) fall back to raw audio
gracefully (no crash); legacy presets unchanged; zero console errors. Commit pending in this
sprint (voice-controls.ts + this handoff).

---

## ⭐ RESUME HERE — Dulcet II v5, 2026-06-25

**Status:** **Branches 1 (`dsp-foundation`), 3 (`preview-pipeline`), and 2
(`pitch-formant`) COMPLETE and MERGED** to `dulcet-ii/integration` (done in that order;
Branch 2 merged last). All 7 character presets bake live AND audition in the Studio
identically to the bake. Helium Sprite via `-af` (linear); the other six via
`-filter_complex` (parallel/convolution).

**Branch 2 (pitch-formant) — DONE & user-confirmed (two audition rounds):** `formantShift`
+ `character` are now audible (movable F1–F3 peaking EQs + throat tilt + resonance; EQ
approximation — no librubberband in the core). Studio has a **Formant knob + Character
slider** (Custom voice; `forkPitchFormant` patches one field at a time). `PitchShiftConfig`
carries formantShift/character → `migrateVoiceEffectToGraph` → fragment; `voiceEffectIsActive`
counts formant-only voices. Presets re-tuned twice: Cyber Oracle = metallic-shimmer cousin
(no longer clones NerdRage), Abyssal Titan redesigned (deeper/longer/cleaner), loudness
balanced. Stop button uses charcoal+red-glow `--delete` style. Harness has formant/character
sliders. **Deterministic** (seeded LCG IRs). Doc: design-doc "Pitch & Formant" section.

**Branches:** `dulcet-ii/integration` is the current stable line. Old `dsp-foundation` +
`preview-pipeline` can be left as history. Namespace: `dulcet-ii/*` (git ref D/F conflict
prevents `dulcet-ii` itself being a branch). **Roadmap order skipped Branch 2** (pitch-
formant) to do Branch 3 first — Branch 2 + Branch 4 + storage swap remain.

**Branch 3 (preview-pipeline) — DONE & user-confirmed (preview == bake across all preset
kinds; intensity modulation correct; stop/spin-up/UX fine):**
- `resolveVoiceGraph(config)` (`dsp/resolve-graph.ts`) = single source of truth for
  config→graph, used by BOTH export (`ffmpeg-runner`) and preview → guaranteed parity.
- Studio "Test character voice" button: one-shot offline render via `processAudioWithGraph`
  (ffmpeg.wasm in the Studio page, lazy `import()` chunk) → `preview.playProcessed(blob)`
  plays the rendered audio DRY. Authoritative for ALL graphs.
- Instant "Play preview" (legacy Web Audio) is the lightweight tier; **disabled when a v5
  character preset is active** (real-time chain ignores `characterPresetId`).
- `PREVIEW_MAX_SECONDS = 30` caps preview render for long clips (opt-in
  `GraphProcessOptions.maxDurationSeconds` → `-t`); export never sets it → bakes full-length.
- Doc: `dsp-foundation-design.md` § "Preview pipeline".

**What's live & user-confirmed (all of sub-phase 1.3):**
- Real MP4 bake routes audio through the graph renderer (`ffmpeg-runner.ts` ~line 465):
  resolves `characterPresetId → characterPresetGraph` else `migrateVoiceEffectToGraph`.
  `VoiceFilterPlan` discriminated union: `af` → linear `-af` splice; `complex` → aux IR WAVs
  written to WASM FS, full `-filter_complex … -map 0:v:0 -map [outputLabel]`, 120s timeout.
- Design Studio Character-voice picker wired (`voice-controls.ts`); all 7 presets selectable.
- Timeout: `COMPLEX_STRATEGY_EXEC_TIMEOUT_MS = 120_000` (matches audio-only path; fixes
  timeout on recordings >~60s with `afir` convolution).
- Legacy presets, voice-off toggle, Slight-mask: all confirmed unchanged.

**dsp module map (`src/voice/dsp/`, all WASM-free → popup-safe barrel):**
- `fragment-types.ts` — `StylizedGraph`, 21 `FragmentKind`s/7 categories, `FRAGMENT_DEFS`
  registry, `createFragment`, `normalizeStylizedGraph`. Pure-data leaf.
- `renderer.ts` — `FragmentRenderer` interface, `RenderContext`, `intensityToFactor` =
  `(intensity/10)**1.3` (f(10)=1.0 exactly, f(12)≈1.27); `createRenderContext`.
- `ffmpeg-renderer.ts` — per-kind emitters; `ffmpegRenderer.assemble` builds either linear
  `-af` or `-filter_complex` (mono-normalized head, `asplit`→wet→`amix` per `ParallelSpec`
  with per-spec `mixDuration`; parallel kinds: ringMod/convReverb/hybridLayer; granular &
  spectralCarve are linear). `FfmpegGraphResult { mode, af, filterComplex, outputLabel,
  auxInputs, stages }`.
- `build-stylized-graph.ts` — `buildStylizedGraph(graph, renderer=ffmpegRenderer)`,
  `CANONICAL_CHAIN_ORDER` (confirmed), `orderFragmentsCanonically`, `stylizedGraphIsActive`.
- `migrate-v1.ts` — `migrateVoiceEffectToGraph(VoiceEffectConfig)` (resolve preset → fragments).
- `ir-generator.ts` — `generateImpulseResponse` (procedural reverb IR) + `encodeWavMono16` +
  `IR_SPACES`. Used by convReverb (`afir`) and (future) Branch-3 ConvolverNode.
- `preset-graphs.ts` — `CHARACTER_PRESETS` (7: cyber-oracle, nerdrage, glitch-beast,
  ethereal-singer, radio-demon, helium-sprite, abyssal-titan), `characterPresetGraph`,
  `getCharacterPreset`.
- `process-audio.ts` (NOT in dsp/) — `processAudioBytesWithGraph`/`processAudioWithGraph` run a
  graph in ffmpeg.wasm (linear + complex, writes aux WAVs, `-map`s output, AAC/M4A encoder,
  disposes+reloads ffmpeg for `complex` graphs = fresh heap). This is the HARNESS path
  (voice-harness.html), separate from the live transcode.

**Critical runtime facts (do NOT relearn the hard way):**
- `@ffmpeg/core@0.12` (ffmpeg 5.1.4) has every filter used (afir/aexciter/asoftclip/deesser/
  adeclick/amultiply/sine). **libopus is decode-only here → encode with AAC, not `-c:a libopus`**
  (a missing encoder crashes as generic "memory access out of bounds").
- `aecho`/`chorus`: number of delays MUST equal number of decays (the v5 reverb bug).
- `intensityFactor` f(10)=1.0 preserves the user-confirmed sound; only non-10 changes.
- `hybridLayer` carrier is DERIVED from the voice (finite) — never an infinite `sine`/noise src.
- Heavy graph = pitch + hybrid (two stacked resample chains) → intermittent OOM; mitigated by
  fresh-heap-per-complex in process-audio. Live transcode disposes ffmpeg on failure already.
- `dsp` barrel is WASM-free; safe to import from popup/Studio (unlike `@/src/voice`).

### NEXT PHASES (remaining Branches)
- **⭐ Branch 4 (`dulcet-ii/character-system`)** — NEXT. User-facing Custom mode: compose the
  21 raw fragments mix-and-match, high-level expressive macros ("Character/Edge/Air"),
  save-as-character flow, voice-summary. The "user-facing power" layer (supplement §"UI
  approach"). Builds on everything: the fragment registry (`FRAGMENT_DEFS`), resolveVoiceGraph,
  the one-shot preview, and the formant/character controls already in the Studio.
- **Storage swap** `VoiceEffectConfig → StylizedGraph` across prefs/profiles/Studio (~24 files;
  highest-risk, race-prone — do last, very carefully). Branch 4 may force part of this since
  composing raw fragments wants graph-native storage; scope it carefully when starting B4.
- Per-primitive (non-global) intensity curves; `resolve-config` cleanup.

**Interactive protocol:** Pause only for human-in-the-loop QA (things that need live audio
verification) or genuinely ambiguous decisions. Push ahead autonomously on non-risky changes;
ask once before each test gate.

**Future idea (non-urgent):** "Chronos indicator" — live FFmpeg time progress (`HH:MM:SS` /
duration) read from the `progress` event `time` field in the offscreen worker, relayed
background → content → recording panel DOM. Medium effort (message-relay plumbing exists;
UI slot doesn't). Flagged as a background task chip.

### Restore / test
```bash
git checkout dulcet-ii/integration && npm install && npm run dev
```
- Harness: `voice-harness.html` — Pipeline=Graph, Character preset dropdown or per-fragment toggles.
- Live: Design Studio → Voice → Character voice (v5) → record on Reddit → bake.
- Build gate: `npm run build` (~1s) and `npx tsc --noEmit` (only 4 pre-existing error files:
  background.ts, background-loader.ts, voice-recorder.ts, segment-cue-player.ts).
- Throwaway smoke pattern: write `_dsp-smoke.ts`, `npx tsc _dsp-smoke.ts --outDir _smoke-out
  --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck`,
  drop `_smoke-out/package.json {"type":"commonjs"}`, `node _smoke-out/_dsp-smoke.js`, then delete both.

---

## Animated GIF backgrounds — `animated` branch (off `main`/v5 line, 2026-06-26)

**Plan (source of truth):** `docs/gif-animation-design-implementation.md` · **Memory:** `project_animated_gif_backgrounds.md`

Looping animated-GIF personal backgrounds. The original draft proposed an FFmpeg
`stream_loop` composite; that premise was **wrong** — backgrounds are not composited in
FFmpeg. This is a single-canvas WYSIWYG pipeline (`drawThemeBackground` paints the bg every
frame → `captureStream(24)` → WebM; `ffmpeg-runner.ts` only does audio `-af` + subtitle
burn-in). So the loop is **canvas-native**: advance GIF frames in the draw loop, same pattern
as the existing time-driven bokeh/sparkle overlays. Preserves preview = recorder = MP4; zero
FFmpeg/relay/storage changes. (User chose canvas-native over FFmpeg composite, 2026-06-26.)

| Phase | Status | Commit |
|-------|--------|--------|
| 1 — enable import + schema polish | DONE | `26db0d1` |
| 2 — canvas-native loop engine | DONE, user-QA'd | `f521bb8` |
| 3 — docs polish + stable tag | in progress | — |

- **Phase 1:** `'animated'` added to `BACKGROUND_IMPORT_ENABLED_KINDS` (video still gated);
  `· Animated` library label. GIFs import as `mediaKind:'animated'`; quota/probe/reconcile
  all kind-agnostic (no logic change). GIF draws as static first frame via the existing path.
- **Phase 2:** `src/storage/animated-background.ts` = `AnimatedBackground` (WebCodecs
  `ImageDecoder` → `ImageBitmap` frames; `frameAt(timeMs)` seamless modulo loop; GIF delay
  clamp sub-20ms→100ms; caps ≤120 frames / ≤128 MB / downscale ≤640px; `dispose`). Wired via
  `loadAnimatedBackground` + `isAnimatedBackgroundCached` (`background-loader.ts`, single active
  controller, grace-delayed disposal, transient-relay-miss retryable / non-GIF+corrupt+1-frame
  sticky-static), `resolveClipBackgrounds` (`backgrounds.ts`), `waveform.ts` (`drawFrame` +
  `renderThemePreview`), `mount-clip-studio.ts` (`shouldAnimate` + reduce-motion freeze).
- **User QA (2026-06-26, all pass):** import / preview / recorder / switching / export — no
  regressions; reduce-motion freezes to frame 0 and recovers; edge cases fine; a 4.5 MB GIF clip
  at the 2:00 cap → 13 MB MP4, nominal transcode/scribe time.

**Design knob (the one real choice):** frame-timing clamp in `animated-background.ts`
(`GIF_MIN_FRAME_DELAY_MS = 20`, `GIF_DEFAULT_FRAME_DELAY_MS = 100`) — mirrors classic browser
GIF playback. Plus memory caps (`MAX_ANIMATED_FRAMES`, `MAX_TOTAL_FRAME_BYTES`, `MAX_FRAME_DIMENSION`).

### Restore / test
```bash
git checkout animated && npm install && npm run dev
```
- Import an animated GIF in Clip appearance → Design Studio preview loops → record on Reddit →
  exported MP4 loops the background. Build gate: `npm run build` + `npm run compile` (clean).

---

## v5.2.0 — Voice Panel QoL: Character Lock + Clipboard Backup (2026-06-26)

**Branch:** `feature/voice-qol-lock-clipboard` (off `main` @ v5.1.0) · **Doc:** `docs/v5.2.0-voice-qol-lock-clipboard.md`
**Specs:** `docs/v5.1.2-QOL-characterlockout.md` + `docs/v5.1.1-QOL-charactercopypaste.md`

Two paired minimal QoL MVPs on the Design Studio Voice sub-panel, built together (shared surface). Icon cluster `[🔒][copy][paste]` on the custom-voice pill row.

- **Voice Character Lock** — transient padlock guard; renders only for a custom voice
  (`characterPresetId` undefined); blocked preset-chip switches show a polite toast, no draft change.
- **Clipboard Voice Character Backup** — copy/paste live voice as `rvn-voice-character-v1` versioned
  JSON (graph-native); paste applies like a manual edit so Update/Save lights up; never auto-saves.

| Phase | Status | Commit |
|-------|--------|--------|
| 0 — assets, branch, scope, future-note | DONE | `fd5d2f7` |
| 1 — pure-logic modules (guard predicate + clipboard schema) | DONE (6/6 predicate cases) | `ee47fdb` |
| 2 — UI wiring (cluster + guard + copy/paste) | DONE, user-QA'd | `f90a38c` |
| Polish — SVG render fix (xmlns) + padlock left-align | DONE | `78663b0` |
| 6 — docs + v5.2.0 bump | DONE | (this) |

**User QA (2026-06-26):** all functionality verified — lock/toast/highlight, copy/paste, dirty state.
Found two visual bugs (now fixed): the four new SVGs lacked the `xmlns` namespace so they rendered
blank via `<img>`; and the padlock was appended on the right, shoving copy/paste over (now leftmost).

**Decision:** clipboard scope = **voice character only** (not full profile); schema must stay parity/
migratable with the future static companion page (`docs/future-ideas.md`).

**Modules (pure, leaf-safe):** `src/ui/design-studio/voice-character-lock.ts`,
`src/settings/clipboard-backup.ts`. Guard choke point: the delegated chip handler in
`voice-controls.ts`. tsc + wxt build clean.

### Restore / test
```bash
git checkout feature/voice-qol-lock-clipboard && npm install && npm run dev
```
Record on Reddit → Design Studio → Voice → tune a custom voice → padlock appears → lock → preset
click is blocked (toast) → copy/paste round-trips and lights up Update profile.
