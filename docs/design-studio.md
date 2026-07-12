# Design Studio — semantic framework & architecture reference

**Status:** Canonical source of truth for Design Studio behavior, refreshed through **v5.10.0** (2026-07-12 QA PASS). The v3.7 shell history remains below; current capture/edit/bake/trim + post-trim voice semantics win.
**Audience:** UI refresh, new features within existing sections, and onboarding.  
**Stable tag:** `v5.10.0` · **Restore:** `git checkout v5.10.0 && npm install && npm run dev`
**Architecture:** [`docs/architecture/README.md`](architecture/README.md) — map v2.8, seams v1.10, backlog v2.6.

---

## 1. Product framing

Design Studio is the **primary product surface** of Reddit Voice Notes: native capture, personalization, preview, transcript/timeline editing, voice re-apply, subtitle bake, trim apply, and download. The Reddit recorder remains a quick capture surface and the native composer attach target.

Treat Design Studio as a **self-contained suite** (extension-origin app) that:

- Owns all clip-appearance state and preview fidelity.
- Persists named profiles and custom styles.
- Orchestrates capture, voice-effect preview/re-apply, subtitle edit→bake, partial re-bake, and atomic trim workflows.
- Pushes live prefs to the recorder via `chrome.storage.local` — no separate “apply” step.

Future UI refreshes must preserve the **semantic contracts** in this document even when layout, components, or styling change.

### 1.0 3-Phase Creative Workflow (canonical mental model)

The extension's UX is framed as a deliberate 3-phase creative workflow. Use this exact terminology everywhere — in UI copy, documentation, and commit messages.

| Phase | Tab | Description |
|-------|-----|-------------|
| **Phase 1: Design** | Design Studio | Choose clip style, voice effects, background, subtitle style. |
| **Phase 2: Capture** | Design Studio or Reddit tab | Record natively in Studio (primary) or inside the composer (quick path). |
| **Phase 3: Polish & Bake** | Design Studio | Review/edit subtitles, bake captions into MP4, finalize. |

**Shared state key:** `rvn.workflow.phase` in `chrome.storage.local` (`'design' | 'capture' | 'polish'`). This carries the user's *intent* phase cross-tab. Authoritative recording/transcript state remains in IDB and subtitle controls as before.

**Phase transitions (automatic):**
- Studio/Reddit Record entry → sets `'capture'`
- Either recorder surface stopping → sets `'polish'`
- Banner auto-promotes to Phase 3 UI when `hasSessionRecording()` is true, regardless of stored phase

**Helpful one-liner for UI copy:** "Design, record, edit, and finish in Studio—or use Reddit for quick capture and final attachment."

### 1.1 Entry points

| Entry | Mechanism | File |
|-------|-----------|------|
| Extension popup | Link / summary → opens tab | `entrypoints/popup/` |
| Recorder panel | **Go here first** + **Open Design Studio** (always visible) | `src/ui/recorder-panel.ts`, `open-design-studio.ts` |
| Direct URL | `chrome-extension://<id>/design-studio.html` | `entrypoints/design-studio/main.ts` |

Opening from Reddit uses `MSG_OPEN_DESIGN_STUDIO` → background `tabs.create` (existing `tabs` permission; no new grants).

### 1.2 Runtime context

| Property | Value |
|----------|-------|
| Origin | `chrome-extension://<id>` (extension page) |
| CSP | `extension_pages` — `script-src 'self' 'wasm-unsafe-eval'`; **no** `unsafe-eval` |
| Heavy media in Studio | Browser composite / splice / remux use mediabunny + WebCodecs in page; voice audition/re-apply lazy-loads ffmpeg.wasm. Capture transcode and Vosk remain background→offscreen/sandbox pipelines |
| IndexedDB | Extension-origin stores (`rvnImageDb`, `rvnLastRecording`, `rvnSessionTranscript`, etc.) |
| Reddit page | Content script cannot read extension IDB; relays via background |

---

## 2. Shell layout & information architecture

### 2.1 Shell layout (v3.7+ — shipped on `eloquent`)

Runtime root: `.studio-v4` (`mount-clip-studio.ts`). **§10.2 hero + 1×4 strip** is live.

**Wide (≥900px):**

```
┌ Header — title, subtitle, [Done] ─────────────────────────┐
├──────────────────────────────┬──────────────────────────┤
│ LIVE PREVIEW (hero, WYSIWYG) │ PROFILE + STATUS strip   │
│ canvas + mask-cutout bezel   │ (Subtitles? / Ready?)    │
├──────────┬──────────┬──────────┬──────────┤
│ Bar style│Background│  Voice   │ Subtitles│  ← status cards
│ summary  │ summary  │ summary  │ summary  │  → tap opens sub-panel
└──────────┴──────────┴──────────┴──────────┘
```

**Narrow:** profile + status **above** preview; four cards stack in one column (`flex` default + `@media (min-width: 900px)` grid).

**Hero preview layering (verified):** one shared **628×348** artboard; canvas fills box + `clip-path` viewport hole; bezel SVG (`preview-window-frame.svg`) mask overlay at `z-index: 3`. See `claude-progress.md` § v4 UI refresh — hero live preview.

### 2.1.1 Legacy stack (v3.1–v3.6, superseded in DOM)

Pre-v4 used vertical `<details>` panels (profile bar → preview → four collapsible sections). Behavior preserved inside sub-panel bodies; card faces replace collapsed `<details>` summaries.

### 2.2 Section panels (cards + sub-panels)

Each section is a **status card** (`.studio__panel`, `data-studio-panel`) with:

- **Face** — icon, title, `data-summary-*` one-liner, centered nav chip (enter ↓).
- **Body** — existing `render*Fields()` markup; shown in **sub-panel shell** (`studio-v4-subpanel-shell.ts`) on card tap.

Summaries must stay accurate on the card face while the sub-panel is closed (`studio-section-summaries.ts`).

**Sub-panel chrome:** nested header (negate back chip, section title, **Done**); **exit guard** (`studio-subpanel-guard.ts`) — cancel left, discard middle, confirm right (v4 button palette).

**Preview count:** One **Live preview** canvas since v3.1.0 (secondary/tertiary previews removed — see `archive/docs/release-notes-v3.1.0.md`). Older branch docs may still mention dual preview; current code mounts `renderPreviewBlock('primary')` only.

### 2.3 Global chrome

| Control | Behavior |
|---------|----------|
| **Done** | Flush pending color + subtitle debounced writes → check `hasStudioUnsavedChanges` → exit modal or `window.close()` |
| **Exit modal** | Profile/style dirty only; **not** session transcript text (see §3.4) |
| **Profile bar** | Cross-section entity; snapshots appearance + voice + subtitle **style/toggle** |

---

## 3. Cross-cutting architecture

### 3.1 Boot & lifecycle (non-negotiable)

```
design-studio.html load
  → loadUserPreferences()
  → reconcileBackgroundPreferences(prefs)   // strip invalid bg- ids
  → mountClipStudio(app, { initialPrefs })  // single hydration
  → prefsHydrated = true                    // storage listener gate

pagehide
  → unmount() → subtitleControls.flushPersist()
```

**Rules (BUG-023 cluster):**

1. Never mount before reconciled `initialPrefs` are ready.
2. All `rvnUserPrefs` writes go through `enqueuePrefsOp` in `user-preferences.ts`.
3. Storage listener ignores events until `prefsHydrated` and while `ignoreStoragePrefs` (in-flight save).
4. Teardown uses `pagehide`, not `unload` (async storage flush — BUG-017).
5. **Never** call `subtitleControls.flushPersist()` before profile save/update (BUG-021) — see `docs/eloquent-profile-handoff.md`.

### 3.2 Storage map

| Store | Key / DB | Holds | Studio reads | Studio writes |
|-------|----------|-------|--------------|---------------|
| `chrome.storage.local` | `rvnUserPrefs` | Profiles, styles, appearance, voice, `transcriptConfig` (style/toggle) | Boot + listener | Debounced section saves, profile actions |
| `chrome.storage.local` | `rvn.subtitles.enabled` | Atomic subtitle on/off | `readSubtitlesEnabledLocal` | `setSubtitlesEnabled` (before prefs merge — BUG-019) |
| `chrome.storage.local` | `rvn.lastRecording.ready` | Signal new WebM for voice preview poll | Voice + subtitle polls | — (recorder writes) |
| `chrome.storage.local` | `rvn.sessionTranscript.ready` | Signal new transcript IDB row | Subtitle poll | — (background writes) |
| `chrome.storage.local` | `rvn.bakedMp4.ready` | Signal baked MP4 for recorder | — | Bake completion |
| `chrome.storage.local` | `rvn.workflow.phase` | 3-phase intent: `'design' \| 'capture' \| 'polish'` | Workflow banner (boot + listener) | Banner CTA, recorder stop |
| `chrome.storage.local` | `rvn.take.current` | v5.4.0 current-take snapshot: status/source/meta + artifact stamps — **never blobs** | Current Take deck + recovery (boot + `storage.onChanged` via TakeManager subscription) | TakeManager only (`src/session/take-manager.ts`): recorder-session transitions, background artifact stamps, bake promotion |
| IndexedDB | `rvnImageDb` | Personal background blobs | Direct (extension origin) | Upload/delete UI |
| IndexedDB | `rvnLastRecording` | Last raw capture WebM (`baseRecording`) | Voice controls, recovery, timeline audio source | — (capture relay/background) |
| IndexedDB | `rvnSessionTranscript` | Vosk + edited transcript | Subtitle controls | Confirm & save |
| IndexedDB | `rvnLastBaseMp4` | Clean/current base MP4 for bake | Bake, trim apply, voice re-apply | Capture relay/background; trim and voice mutation orchestrators |
| IndexedDB | `rvnLastBakedMp4` | Burned/composited MP4 output | Partial splice, voice re-apply, Download | Bake / re-apply |

**Never** put image blobs or transcript cue text in `rvnUserPrefs`.

**Take lifecycle (v5.4→v5.10):** `rvn.take.current` is a snapshot only — blobs stay in the single-slot IDB stores above, referenced by H6-verified `TakeArtifactStamp`s. Additive `voice` provenance and `edits.trim` intent also live in the snapshot. Trim apply replaces the base stamp, drops `bakedMp4`, and either re-stamps `baseRecording` (raw WebM cut succeeded) or deletes it (honest v5.9 lock) in one TakeManager patch; no `MSG_TAKE_*` family exists (ADR-0002). Artifact stores must persist successfully before callers publish stamps/signals (architecture backlog H13; v5.10 adds a bounds pre-check on the trim raw leg only).

### 3.3 Preview = output guarantee

The **single** Live preview canvas uses `renderThemePreview()` with the same inputs the recorder canvas uses for capture pixels. During Studio-native recording, the hero receives the actual `WaveformRenderer` canvas that `captureStream()` encodes—zero-copy WYSIWYG.

- Resolved theme + `designOverrides`
- `barAlignment`
- Personal background id + layout (Studio reads ImageDB directly)
- Subtitle overlay options from `subtitleControls.getPreviewOptions()`; offline bake reuses `createOverlayFramePainter`

Animated preview (bokeh, sparkle) runs at 12 fps RAF unless `shouldReduceMotion(prefs)`.

**Invariant:** If it appears in Live preview, the export path must reproduce it—either in the captured base canvas or the post-base subtitle painter/fallback. Timeline cue edits snap to the painter frame grid (I17). Trim ghosts and destructive apply share the same cue projection, so trim preview = applied result (I18).

### 3.4 Compositing layers (final MP4)

Bottom → top:

1. **Background** — theme gradient/SVG/bokeh + optional personal image.
2. **Bars** — waveform + glow/effects (canvas capture at 24 fps on Reddit).
3. **Subtitles** — post-`base.mp4` composite, never in the live capture RAF. Default: in-page VideoDecoder → shared painter blend → VideoEncoder+mux. Permanent fallbacks: dual-IVF+FFmpeg, MediaRecorder+FFmpeg, then drawtext.

Voice effects apply to the **audio track**, not as a visual layer. Re-apply renders from H6-verified raw WebM and stream-copy remuxes audio under existing video. Atomic trim shortens the base and, when possible, trims the raw WebM too (audio-only) so voice re-apply stays available; if the raw leg cannot run, the stamp drops and voice locks honestly (v5.9 fallback).

### 3.5 Dirty-state taxonomy

Studio has **four independent dirty layers**. A UI refresh must not collapse these into one boolean.

| Layer | Compared | UI signal | Persist target | Blocks Done? | Blocks bake? |
|-------|----------|-----------|----------------|--------------|--------------|
| **Profile** | Live prefs vs selected `ClipProfile` | Update profile / Sure? | `savedProfiles[]` | Yes (exit modal) | No |
| **Custom style** | `designOverrides` vs saved style | Update style / Sure? | `savedStyles[]` | Yes (exit modal) | No |
| **Transcript panel** | `edited` vs `savedBaseline` | Unsaved badge, Confirm & save | `rvnSessionTranscript` IDB | No | Yes (bake unsaved dialog) |
| **Segment modal** | DOM draft vs `modalOpenBaseline` | Inline prompt on close | Apply → panel dirty | No | No |

**Profile dirty includes:** appearance, `voiceEffect`, and `transcriptConfig` **style fields only** (`transcriptConfigForProfileStorage` strips `result`). Transcript **text/timing** is session IDB — intentionally excluded from profile dirty and exit modal (BUG-017, eloquent-4a).

**Subtitle toggle** is global (`rvn.subtitles.enabled` + prefs); flipping it does not require Confirm & save on transcript text.

### 3.6 Branching save pathways

All named entities use the same four paths (see `docs/engineering-principles.md` § Branching save):

| Path | Label | When |
|------|-------|------|
| First save | Save as profile / Save as style | No saved entity selected |
| Update | Update profile / Update style → **Sure?** | Saved entity + dirty |
| Clone | Green **Clone** | Saved entity + clean |
| Fork | **Save to new** (same button, dirty label) | Saved entity + dirty |

**Style roll-up:** Updating a profile while custom style is also dirty prompts to save style first (`shouldPromptStyleSaveWithProfileUpdate`).

Implement new Studio surfaces via `studio-save-pathways.ts` and `studio-exit.ts` — not ad-hoc `window.confirm` patterns.

### 3.7 Security & policy

| Concern | Studio behavior |
|---------|-----------------|
| CSP eval | Studio JS is bundled WXT output only; no `new Function` |
| Vosk / FFmpeg | Messages to offscreen; Studio never imports transcription/voice barrels that pull WASM |
| Personal images | Extension-origin IDB; recorder uses chunked base64 relay (Reddit CSP blocks extension URLs on canvas) |
| postMessage | N/A in Studio (sandbox is offscreen/transcribe path) |
| Permissions | `storage`, `tabs` (open studio), `offscreen` (indirect via messaging) |

**Import rule:** Popup and Studio import **direct files** — not `@/src/voice` or `@/src/transcription` barrels (they pull ffmpeg/vosk).

---

## 4. Section — Bar style

**Panel id:** `data-studio-panel="bar-style"`  
**Summary:** `renderBarStyleSummaryHtml` — style name, color swatch, S/V, alignment badge, effects chip.

### 4.1 Controls inventory

| Control | Data field | Persist path |
|---------|------------|--------------|
| Clip style select | `activeThemeId`, `activeCustomStyleId`, preset virtual ids | `applyPresetClipStyle` / `applyCustomClipStyle` / `enterCustomStyleMode` |
| Color picker (HSV/HEX) | `designOverrides.barColor`, `glowColor` | Debounced `saveCustomStyleColors` (200 ms) |
| Bar alignment | `appearance.barAlignment` | `saveAppearancePreferences` |
| Boosted bar glow | `designOverrides.barGlow` | Debounced style colors |
| Background flair | `designOverrides.backgroundEffect` | Debounced style colors |

Custom style sub-panel (`data-custom-style-panel`) visible when user picks **Custom** or a saved style — hosts color picker + style Save/Update/Clone/Delete.

### 4.2 Semantic model

- **Theme preset** — bundled SVG/gradient in `src/theme/`; selectable without creating a saved style.
- **Custom style** — named `savedStyles[]` entry holding `designOverrides`.
- **Design overrides** — merge onto resolved theme for preview and canvas; drive bar color, glow, flair.

Selecting a bundled preset in Studio clears `activeProfileId` (manual/custom mode) unless user later saves as profile.

### 4.3 Preview coupling

Color/effect changes call `applyLocalDesignOverrides` → immediate preview refresh. Debounced persist avoids storage RMW storms during HSV drag.

### 4.4 Extension to recorder

`saveAppearancePreferences` → `chrome.storage.local` → content script `onUserPreferencesChanged` → `waveform.setTheme()` / alignment hot-swap mid-recording (QA-verified).

### 4.5 Module map

| File | Role |
|------|------|
| `color-picker.ts` | HSV/HEX radial controls |
| `effect-controls.ts` | Bar glow + background flair |
| `radial-knob.ts` | Shared dial widget |
| `mount-clip-studio.ts` | Select handlers, style buttons, preview loop |

---

## 5. Section — Background

**Panel id:** `data-studio-panel="background"`  
**Summary:** `Theme background` or `Personal · Fit/Fill · TL…BR`.

### 5.1 Controls inventory

| Control | Data field | Persist path |
|---------|------------|--------------|
| Upload / pick / delete personal image | `appearance.customBackgroundId` (`bg-…`) | `saveAppearancePreferences` + ImageDB |
| Scale mode | `backgroundScaleMode` (`fit` / `fill`) | `saveAppearancePreferences` |
| Position grid (3×3) | `backgroundPosition` | `saveAppearancePreferences` |

### 5.2 Semantic model

- **Theme background** — from active clip style; no `customBackgroundId`.
- **Personal background** — blob in `rvnImageDb`; prefs hold id only. Images (JPEG/PNG/WebP) and **animated GIFs** share the same id/storage/relay; an animated GIF loops on the canvas (decoded to frames via WebCodecs `ImageDecoder`).
- **Animated GIF = canvas-native, no fidelity gap** — frames advance in the same RAF that feeds `captureStream`, so preview = recorder = exported MP4. No FFmpeg/bake path. Reduced motion freezes to the first frame everywhere. See `docs/gif-animation-design-implementation.md`.
- **Reconcile** — `reconcileBackgroundPreferences` strips missing ids on boot.

### 5.3 WYSIWYG relay (recorder)

Studio reads ImageDB directly. Reddit content script cannot:

```
Studio (extension) ──read──► rvnImageDb
Recorder (reddit.com) ──MSG_GET_BACKGROUND_BLOB_*──► background ──chunked base64──► content script ──decode──► canvas
```

Missing blob → theme fallback; never blocks recording.

### 5.4 Module map

| File | Role |
|------|------|
| `background-layout-controls.ts` | Fit/fill + position grid |
| `src/ui/popup/personal-background.ts` | Shared upload UI (mounted in Studio) |
| `src/storage/image-db.ts` | Blob CRUD |
| `src/storage/animated-background.ts` | GIF frame decode + `frameAt` loop timing |
| `src/storage/background-refs.ts` | Reconcile + prune |

---

## 6. Section — Voice

**Panel id:** `data-studio-panel="voice"`  
**Summary:** `formatVoiceEffectSummary` (graph-world) — e.g. `Incognito · 7/10`, `Custom · 9/10`, or `Off`.

> **Canonical DSP reference:** the voice **model** — the `StylizedGraph`, its 21
> fragment kinds / 7 categories, the FFmpeg renderer, the `-af` vs `-filter_complex`
> split, and the two-tier preview design — lives in **`docs/dsp-foundation-design.md`**,
> the source of truth. This section documents only the **Design Studio panel** that
> authors and auditions a graph; it links out rather than restating DSP internals.

### 6.1 Controls inventory

A voice is **one `StylizedGraph` per profile**. The panel authors it via a **character
chip picker** plus a **composer**, with global Intensity/Turbo layered on top. The
*audition* controls (Last Voice Note / One-Time Test / shared Stop / mic meter) are
documented in **§6.5** — this table is the persisted authoring surface.

| Control | `data-*` | Data field | Persist path |
|---------|----------|------------|--------------|
| Enable toggle | `data-voice-enabled` | `voiceEffect.enabled` | Debounced `saveVoiceEffectPreferences` (`VOICE_SAVE_DEBOUNCE_MS` = 250 ms) |
| Character chips | `data-char-chips` (one per `CHARACTER_PRESETS`) | `voiceEffect.characterPresetId` (clears `graph`) | 〃 |
| Intensity slider (physical) | `data-voice-intensity` | `voiceEffect.intensity` | 〃 — never forces Custom; intensity only modulates the active voice |
| Turbo toggle | `data-voice-turbo` | `voiceEffect.turbo` (maps to magic intensity `VOICE_INTENSITY_TURBO`) | 〃 |
| Custom composer | `data-voice-composer` (mounts `voice-composer.ts`) | `voiceEffect.graph` | 〃 — first edit **forks to Custom**: materializes `graph`, clears `characterPresetId` |
| Copy / Paste character | `data-voice-copy` / `data-voice-paste` | clipboard JSON (`rvn-voice-character-v1`) | None — Paste applies to the draft like a manual edit (lights profile dirty), never auto-saves |
| Lock | `data-voice-lock` | transient module guard (custom voice only) | None — reset per Studio open, not persisted |

The composer (`voice-composer.ts`) is a **controlled** `StylizedGraph` editor: the seven
fragment categories as accordions, a curated **core** of high-impact effects with
**Show advanced effects** + **Fine-tune** (per-effect strength dials) reveals, each
fragment a toggle + 1–3 high-level sliders + a tooltip, plus **Blank slate** (clear) and
**Reset order** (canonical re-sort). It is graph-in / graph-out only — every edit calls
back with a normalized clone; the panel owns persistence and the seed-then-tweak wiring.

### 6.2 Semantic model

- **One voice = one `StylizedGraph`.** There is no flat `presetId` / `pitchShift` / `eq`
  / `dynamics` / `reverb` and no pitch-radial knob — those were removed in Branch 4.
  `VoiceEffectConfig` now carries `graph`, `characterPresetId`, and the global
  `enabled` / `intensity` / `turbo`.
- **Two entry points, one editor (seed-then-tweak).** Picking a character chip seeds the
  composer with that preset's graph **for display** and stores only `characterPresetId`;
  the **first composer edit** materializes `voiceEffect.graph` and clears the character,
  forking the voice to Custom.
- **Resolution is centralized.** `resolveVoiceGraph(config)` (`dsp/resolve-graph.ts`) is
  the single source of truth: a composed `graph` wins; else the selected character builds
  its native graph (`characterPresetGraph`); else the voice is off. Global Intensity/Turbo
  override the graph's stored baseline at resolve time, so the panel sliders keep
  modulating a custom voice.
- **Preview = bake, by construction.** Both the audition (§6.5) and the live export
  (`ffmpeg-runner.ts`) resolve through the *same* `resolveVoiceGraph` and render the *same*
  graph (`buildStylizedGraph` → ffmpeg.wasm). The audition renders the active graph
  **once** via `processAudioWithGraph` and plays the finished clip dry — what you hear is
  what bakes. See `docs/dsp-foundation-design.md` § "Preview pipeline".
- **What the effect touches.** Voice processing is an audio-track pass at transcode (`-af`
  for linear graphs, `-filter_complex` + aux IR `-i` for parallel ones — §3.4).
  Transcription recognizes the **raw**, pre-effect audio for recognition quality (see §7 /
  `docs/transcription-architecture.md`).

**Preview reload:** the `LAST_RECORDING_READY_KEY` storage signal + a 2 s IDB poll
(`RECORDING_POLL_MS`) refresh the *Last Voice Note* source while the Studio stays open.

### 6.3 Invariants — preview fidelity & import safety

- **Never re-process a rendered clip.** `preview-chain.ts` is a **dry** player
  (`playProcessed` → a plain `<audio>` element); there is no Web-Audio effect chain. The
  blob it plays already went through the full graph in ffmpeg.wasm and is authoritative.
- **Single master playback.** One `VoicePreviewHandle`; `playProcessed` calls `stop()`
  first, so only one rendered clip plays at a time and the shared Stop button governs it.
- **Non-destructive.** A disabled / no-op graph (`mode: 'none'`) or any ffmpeg failure
  returns the input unchanged — the audition falls back to the original audio (and the
  live export to raw audio + a recorder toast).
- **WASM stays out of the panel's initial load.** The `@/src/voice/dsp` barrel is
  **WASM-free** (pure data + string emitters), so the Studio imports it directly;
  `processAudioWithGraph` is **lazy-imported** (`await import('@/src/voice/process-audio')`)
  only when an audition runs. Do **not** import the `@/src/voice` barrel from the panel —
  it pulls ffmpeg via `process-audio`.

### 6.4 Module map

| File | Role |
|------|------|
| `voice-controls.ts` | Voice panel: enable / intensity / turbo, character chips, composer host, audition buttons, prefs debounce + `flushPersist` |
| `voice-composer.ts` | Controlled `StylizedGraph` editor (categories, core / advanced / fine-tune, per-fragment toggles + sliders, Blank slate / Reset order) |
| `src/voice/dsp/` (barrel) | **WASM-free** fragment model, renderer, `buildStylizedGraph`, `resolveVoiceGraph`, `CHARACTER_PRESETS` — canonical: `docs/dsp-foundation-design.md` |
| `src/voice/dsp/resolve-graph.ts` | `resolveVoiceGraph` — config → graph (one source of truth for preview + export) |
| `src/voice/dsp/preset-graphs.ts` | `CHARACTER_PRESETS` + `characterPresetGraph` (native graphs behind the chips) |
| `src/voice/process-audio.ts` | `processAudioWithGraph` — one-shot render of a graph through ffmpeg.wasm (`-af` / `-filter_complex`); lazy-loaded |
| `src/voice/preview-chain.ts` | **Dry** rendered-clip player (`playProcessed`) — no Web Audio |
| `src/voice/voice-summary.ts` | `formatVoiceEffectSummary` (graph-world card summary) |
| `src/voice/resolve-config.ts` | `voiceEffectUserIntentKey` / `voiceEffectConfigsEqual` — stable, id-independent voice-intent key for profile dirty-checks (no longer "preset resolution") |
| `src/voice/mic-test-capture.ts` | One-Time Test live-mic capture — imports no storage (see §6.5) |
| `src/storage/last-recording-db.ts` | Preview source blob (Last Voice Note) |

### 6.5 Voice audition controls — current (v5.3.1)

Two buttons audition the **active** voice graph, both routing through the *same*
authoritative path (`resolveVoiceGraph` → `processAudioWithGraph` → one shared
`VoicePreviewHandle.playProcessed`), so what you hear equals the bake:

| Control | Input source | Stores anything? |
|---------|--------------|------------------|
| **Last Voice Note** | `rvnLastRecording` (last Reddit WebM) | No (reads IDB) |
| **One-Time Test** | a fresh, transient live-mic capture | **No — never persisted** |

- **One shared Stop button** governs both ("Stop & render" while capturing → "Stop" while
  playing). Only one audition runs at a time.
- **Storage-safety invariant:** the One-Time Test capture is in-memory only —
  `src/voice/mic-test-capture.ts` imports no storage module, so it cannot overwrite
  `rvnLastRecording`. With no saved recording, the UI de-emphasizes *Last Voice Note* and
  steers the user to *One-Time Test*.
- **Canonical design + plan:** `docs/v5.3.1-voice-live-mic-preview-design-document.md`.
  Extension seam: `docs/architecture/extension-points.md` → "Voice live-mic preview — v1".

---

## 7. Section — Subtitles

**Panel id:** `data-studio-panel="subtitles"`  
**Summary:** `formatSubtitleSummary` — e.g. `On · bottom · 22px` or `Off`.

This section is the largest integrated subsystem: prefs + dual-copy session IDB + offscreen Vosk + List/Timeline editor + browser/FFmpeg bake ladder + partial splice + atomic trim.

### 7.1 Controls inventory

| Control | Data field | Persist target |
|---------|------------|----------------|
| Enable toggle | `transcriptConfig.enabled` + atomic local flag | `setSubtitlesEnabled` + debounced `saveTranscriptPreferences` |
| Transcript source line | — (read-only status) | — |
| Segment editor | see §7.3 | Session IDB on Confirm & save |
| Position / font size | `subtitleStyle` | `transcriptConfig` in prefs |
| Backdrop + opacity | `subtitleStyle` | prefs |
| Text color | `subtitleStyle.textColor` — `theme` \| `white` \| `black` \| `special` | prefs |
| Special hue (shared) | `subtitleStyle.specialHue` — HSV/HEX picker when text or glow uses `special` | prefs |
| Theme glow | `subtitleStyle.glow` | prefs |
| Glow mode / color / strength | `glow.mode` (`halo` \| `border`), `colorSource`, `opacity` (halo only) | prefs |
| Generate scaffold | editor action (§7.3) — evenly-timed empty slots spanning the clip | Session IDB on Confirm & save |
| Smart Split / delete cue | editor cue actions (§7.3) | Session IDB on Confirm & save |
| Bake subtitles into MP4 | — | `rvnLastBakedMp4` IDB |
| Clear transcript | — | Clears session IDB |

> **Rainbow pulse removed (v5.3):** the `specialHueRainbow` time-varying hue was dropped — low value and the worst FFmpeg-drawtext multiplier (see §7.4 / BUG-035). `specialHue` (static) remains.

**Position dropdown order:** **top → center → bottom** (matches on-screen vertical order). This has regressed before — keep `POSITION_OPTIONS` in that sequence in `subtitle-controls.ts`, not lexical/reverse order.

### 7.2 End-to-end pipeline

```
stopRecording() [Studio or Reddit]
  ├─ transcode → base.mp4 → mp4Blob + relay to rvnLastBaseMp4
  └─ fork transcribe (if subtitles on) → Vosk → relay to rvnSessionTranscript

Design Studio
  ├─ Poll/load session transcript (Pending → Ready / Timed out / No speech / Failed / Scaffolded)
  ├─ Edit cues in shared List/Timeline draft → Confirm & save (IDB)
  ├─ Style controls → prefs (live preview overlay)
  ├─ Optional Apply trim → shorter base + both cue copies shift + baked stamp clear
  │    └─ raw WebM cut when H6-matched (else drop baseRecording → voice lock)
  └─ Bake/re-bake
       ├─ eligible edit → verified partial GOP splice
       └─ full: browser composite (default) → dual-IVF/MediaRecorder FFmpeg fallbacks → drawtext
            └─ rvnLastBakedMp4 + BAKED_MP4_READY_KEY + take='baked'
```

Recorder reaches **stopped** after transcode only (BUG-026); transcribe does not block the progress bar.

**Graceful failure → scaffold (v5.3):** Vosk no-speech / empty / inference-error / timeout no longer hang on amber "Pending". The content script classifies the outcome (`transcribe-failure.ts` → `no-speech` \| `inference-error` \| `empty-result` \| `timeout`), builds an evenly-timed **scaffold** (`buildScaffoldTranscriptResult`, soft-hyphen `­` slots), and persists it with `{ error, isScaffolded }`. The Studio resolves a terminal **delivery status** (`deliveryStatusForSnapshot`) and the segment editor opens in scaffolding mode (red status + timed empty slots ready to type). See `docs/transcription-architecture.md` § failure emission.

**Delivery status taxonomy** (`TranscriptDeliveryStatus` in `subtitle-segment-editor.ts`): `idle · pending · ready · timeout · failed · no-speech · scaffolded`. The last three short-circuit the 120 s pending timer.

### 7.3 Segment editor (YouTube-style)

The modal has two lossless views over the same host-owned `modalDraft`: **Timeline** (default professional surface) and **List** (legacy precise form). `captureActiveDraft()` reads List DOM only while List is active; Timeline writes directly to the draft. This is the source-of-truth invariant behind multi-select, undo/redo, waveform, smart suggestions, and trim.

| State | Location | Meaning |
|-------|----------|---------|
| `originalResult` | Session IDB | Immutable Vosk baseline |
| `edited` | In-memory + IDB | Working copy |
| `savedBaseline` | In-memory | Last **Confirm & save** — panel dirty compares here |
| `modalOpenBaseline` | In-memory | Snapshot at modal open — modal dirty compares here |

**Modal close guard (v3.6.0):** Closing via ×, Cancel, backdrop, or Escape with unsaved modal edits shows inline prompt: **Apply to preview** / **Discard** / **Keep editing**.

**Panel-level:** **Confirm & save** persists to IDB; **Discard edits** reverts to `originalResult`.

**Bake guard:** If panel dirty, bake shows unsaved dialog — Save & bake / Edit transcript / Cancel.

**Timeline + trim (v5.8→v5.10):** cue drags/resizes/nudges frame-snap through `timeline.ts`; the waveform uses the same decoded buffer as cue playback. Trim mode previews the kept window with markers/veils/ghost bars. Save stores non-destructive `edits.trim`; two-click **Apply trim** consumes the live draft, cuts the base (and the raw WebM when H6-matched), shifts both transcript copies, clears undo, forces the next subtitle bake to be full, and keeps post-trim voice re-apply available when the raw leg succeeds.

**Scaffolding mode (v5.3):** when delivery status ∈ {`no-speech`, `failed`, `scaffolded`} the editor shows a magenta "Scaffolding mode" banner + **Scaffold** badge and preserves empty timed slots through edits (`normalizeEditedTranscriptResult(..., { keepEmptyTimedSegments })`) — empty slots bake to nothing (skipped by `usableSegments`). Filling a slot and saving clears the red state (delivery re-resolves to `ready`). Empty slots use a soft hyphen (`­`, U+00AD) so they survive `.trim()`-based emptiness filters; everything blank-aware uses `cueTextIsBlank` / `stripScaffoldPlaceholder`.

**Cue actions (v5.3):**
- **Generate scaffold** (panel button) — replaces cues with evenly-timed empty slots spanning the clip (`buildScaffoldTranscriptResult`, default 3 s/slot, runt-tail merge). Confirms before discarding real text.
- **Smart Split** (per-cue ✂, v5.3.6 relaxed) — splits a long cue into shorter timed cues that each fit one caption line. Measures cue text with the live subtitle font (`text-metrics.ts` canvas measurer) against a **relaxed width budget** (`smartSplitCaptionMaxWidth`, ~1.5× the preview caption line — canvas burn-in removed the old drawtext layer ceiling that originally drove conservative splitting). Divides the time span proportionally to each chunk's character length (`splitSegmentIntoChunks`). Enabled only when the cue breaks into >1 chunk at that budget; a **⚠ LONG** overflow badge flags the same condition. Manual ✂ Split unchanged.
- **Delete cue** (per-cue X — nav-chip + chevron-X asset `cue-delete-x-16.svg`) — removes the cue from the working draft; reverted by the modal's Cancel/Discard (not committed until Apply to preview).

### 7.4 Preview vs bake fidelity

| Aspect | Preview | Bake |
|--------|---------|------|
| Text/timing | Segment player + Timeline use the current cue draft | Shared painter evaluates the same cues at decoded frame PTS; drawtext uses per-cue `textfile=` only as last fallback |
| Style | `subtitle-effects.ts` + preview canvas | Primary browser composite uses `createOverlayFramePainter`; fallback tiers declare reduced parity |
| Glow/border/backdrop | Canvas painter | Same painter on primary path; bounded drawtext duplicates on final fallback |

**Subtitle effects (v3.6.1+):** Drop shadow removed (theme glow covers contrast). Glow modes: **halo** (soft, opacity slider) or **border** (solid 1 px ring, no alpha). **Special hue** is one shared `specialHue` field for both text and glow when either selects `special`.

**Glow layer cost & `GlowRingMode` (v5.3):** Each glow is rendered as offset drawtext/`fillText` duplicates. The soft halo used to stack concentric rings (`blurRadius` = ring *count* → up to ~17 layers/cue), which overran ffmpeg.wasm on multi-cue clips and got demoted to no-glow. Now `blurRadius` sets ring **spread** (offset distance) at a **flat** layer cost via `buildGlowLayerSpecs(glow, fontSize, ringMode)`:
- `single` (preview **and** the bake's richest tier) — centre + one 8-neighbour ring (~9 glow layers/cue).
- `min` (bake degrade) — one 4-neighbour ring (~4/cue).
- `full` (lush multi-ring) — retained but currently unused; preview switched to `single` for redraw perf while dragging.

Border mode ignores ring density (fixed 8-neighbour ring).

**Drawtext fallback budget (BUG-035):** `buildBurnInStrategies` builds tiers `drawtext-glow` → `drawtext-glow-min` → `drawtext-plain`, dedupes, and keeps those within `MAX_BURNIN_DRAWTEXT_LAYERS = 64`. This is fallback behavior; rich default bakes use the shared canvas painter and do not build a per-cue drawtext graph.

**Rainbow removed (v5.3):** the former `specialHueRainbow` animated hue (and its bake-time 0.25 s `fontcolor` slicing) is gone — low value and the dominant drawtext multiplier. Bake colors are static per cue.

### 7.5 Offscreen relay (BUG-032)

Progress/failure from offscreen must reach Reddit tab via `relay-registry.ts` session `jobId→tabId`. Studio extension tab does not use tab relay for burn-in (listeners on `runtime.sendMessage`).

### 7.6 Module map

| File | Role |
|------|------|
| `subtitle-controls.ts` | Panel orchestration, bake, prefs debounce, delivery-status resolve |
| `subtitle-segment-editor.ts` | Host-owned draft, List/Timeline switch, undo, suggestions, trim apply orchestration |
| `subtitle-timeline-editor.ts` / `timeline-geometry.ts` / `waveform-peaks.ts` | Visual timeline UI + pure frame/snap/trim/waveform math |
| `src/transcription/transcript-editing.ts` | Pure cue helpers: scaffold, `splitSegmentIntoChunks`, blank/soft-hyphen |
| `src/transcription/transcribe-failure.ts` | Classify Vosk outcome → failure type (graceful failure) |
| `src/utils/text-metrics.ts` | Canvas width measurer + greedy word grouping (Smart Split / overflow badge) |
| `subtitle-bake.ts` / `subtitle-canvas-bake.ts` | Splice gate + full browser/FFmpeg fallback ladder |
| `src/composite/browser-composite.ts` / `composite-splice.ts` | Default full composite + verified partial re-bake |
| `src/editing/trim-apply.ts` / `trim.ts` | H6 base + raw WebM mutation + preview-identical cue shift |
| `src/ffmpeg/burnin-client.ts` / `subtitle-burnin.ts` | Offscreen FFmpeg composite/drawtext fallbacks |
| `src/storage/session-transcript-db.ts` | Dual-copy transcript persistence + destructive re-base on trim |

---

## 8. UI vocabulary (refresh-safe syntax)

### 8.1 CSS namespaces

| Prefix | Scope |
|--------|-------|
| `studio__*` | Design Studio layout and panels |
| `popup__*` | Shared form controls (also used in main popup) |

Styles live in `entrypoints/design-studio/style.css` (+ shared `entrypoints/popup/style.css`).

### 8.2 `data-*` contract (do not rename without migration)

| Attribute | Owner |
|-----------|-------|
| `data-studio-panel` | Panel identity: `bar-style`, `background`, `voice`, `subtitles` |
| `data-summary-*` | Collapsed chip targets |
| `data-preview-canvas` | Live preview canvas |
| `data-profile-select`, `data-save-profile`, … | Profile bar |
| `data-transcript-*` | Segment editor + modal |
| `data-subtitle-*` | Subtitle style + bake |
| `data-voice-*` | Voice section |

### 8.3 Button semantics

| Class / state | Meaning |
|---------------|---------|
| `popup__profile-btn--muted` | Saved entity selected, not dirty — Update disabled |
| `popup__profile-btn--confirm` | Second step — **Sure?** |
| `popup__profile-btn--save-new` | Green fork — Clone or Save to new |
| `popup__profile-btn--delete` | Destructive — Delete profile/style |

### 8.4 Summary chip grammar

Chips are HTML fragments built in `studio-section-summaries.ts` — not plain text. A refresh may change markup but must preserve **information content** (style name, swatch, alignment, voice summary, subtitle on/off + position).

---

## 9. Messaging & external integration

| Message / signal | Direction | Purpose |
|------------------|-----------|---------|
| `MSG_OPEN_DESIGN_STUDIO` | Recorder → background | Open studio tab |
| `onUserPreferencesChanged` | storage → recorder | Live theme/voice/alignment |
| `MSG_TRANSCODE_*` / `MSG_TRANSCRIBE_*` | Studio or Reddit → offscreen | Shared capture conversion + parallel raw-audio STT |
| `MSG_BURNIN_*` | Studio → offscreen | FFmpeg subtitle fallback tiers (default browser composite bypasses it) |
| `MSG_QUERY_TRANSCODE_INFLIGHT` | Studio → background | Idempotent recovery query |
| `rvn.take.current` + `storage.onChanged` | TakeManager ↔ all contexts | Lifecycle/artifact/voice/edit state; deliberately not a message family |
| `LAST_RECORDING_READY_KEY` | Recorder → storage | Voice preview refresh |
| `SESSION_TRANSCRIPT_READY_KEY` | Background → storage | Transcript poll |
| `BAKED_MP4_READY_KEY` | Studio → storage | Recorder apply captioned MP4 |

Studio pipeline clients receive offscreen progress directly on `runtime.onMessage`; background `*SkipTabRelayByJobId` maps prevent a duplicate `tabs.sendMessage` to Reddit (architecture H12, resolved).

---

## 10. UI refresh guardrails

Before shipping a visual overhaul, verify:

- [ ] Boot order unchanged: load → reconcile → mount(`initialPrefs`).
- [ ] Four sections remain the bounded feature surface (new work nests inside them).
- [ ] Live preview still single canvas; WYSIWYG invariant documented in §3.3.
- [ ] Dirty layers in §3.5 still independently handled.
- [ ] Profile save pathways in §3.6 still reachable from profile bar.
- [ ] Subtitle workflow §7.2 intact: edit → confirm → bake → attach.
- [ ] Segment modal close guard §7.3 preserved.
- [ ] No barrel imports that pull WASM into Studio bundle.
- [ ] `npm run build` + record → Studio → bake smoke pass.

**Fallback tag for Studio work:** `v3.6.0` (see `docs/code-review.md`).

---

## 10.1 UI refresh — surgery map (pre-flight, not implemented)

Target layout (your sketch):

| Breakpoint | Structure |
|------------|-----------|
| **Landscape** | Large preview (+ optional record) left; profile/status top-right of preview; four section cards in **2×2** grid below or beside preview |
| **Portrait / narrow** | Profile/status → preview (+ record) → four section cards **stacked**, each with **major controls exposed** + optional **sub-panel** for full feature set |

Replace `<details>` accordion with always-visible “dressed” cards + nested submenus. **Semantics unchanged** — same four sections, same `data-*` contracts, same mount modules.

### Tier A — Mostly CSS / markup shell (lower risk)

| Area | Files | Notes |
|------|-------|-------|
| Page grid / responsive | `entrypoints/design-studio/style.css` | New `studio__layout`, `studio__hero`, `studio__panel-grid`; media queries for 2×2 vs stack. No TS required if DOM order preserved. |
| Accordion chrome | `style.css` `.studio__panel*` | Swap `<details>/<summary>` for `<section>` + header + optional `hidden` sub-panel; **keep** `data-studio-panel` on outer wrapper. |
| Preview sizing | `preview-block.ts`, `.studio__preview-wrap` | Larger hero preview in landscape; same `[data-preview-canvas]`. |
| Header / Done | `mount-clip-studio.ts` header block | May merge into profile/status cluster; **keep** `[data-studio-done]`, exit modal markup. |
| Summary chips | `studio-section-summaries.ts` | Today: collapsed accordion scan affordance. Refresh: move chips to **card headers** or inline major controls — **do not delete** `data-summary-*` targets without updating sync call sites. |

### Tier B — Shell restructure (medium risk — where it hurts)

| Area | Files | Risk |
|------|-------|------|
| **Monolith orchestrator** | `mount-clip-studio.ts` (~950 lines) | Single `innerHTML` template + all `querySelector` roots. Any DOM move must preserve: profile buttons, theme/alignment selects, `data-custom-style-panel`, four panel bodies, preview canvas. **Split template into layout partials** before styling — reduces diff blast radius. |
| **Profile bar relocation** | `mount-clip-studio.ts`, CSS | Profile select + Save/Update/Clone/Delete beside preview. All `syncProfileButton` / `isProfileDirty` logic stays; only queries must still find `[data-profile-select]`, `[data-save-profile]`, etc. |
| **Major vs full controls** | Each `render*Fields()` module | New pattern: split each section into `render*MajorFields()` + `render*AdvancedFields()` (or sub-panel). **Highest product-design work** — define what’s “major” per section without losing features. |
| **Bar style nesting** | `color-picker.ts`, `effect-controls.ts` | Hue wheel + radial knobs need ~300px width; compact 2×2 cards may clip. Sub-panel or landscape-only full picker. `isUserAdjusting()` / `endInteraction()` must survive panel open/close. |
| **Subtitles nesting** | `subtitle-controls.ts`, `subtitle-segment-editor.ts` | Already has hidden bodies (`data-subtitle-body`, glow options, special hue, bake dialog, **modal**). Segment modal is `position: fixed` — z-index vs new grid. Bake unsaved dialog competes with exit modal (`z-index: 20`). |
| **Voice preview** | `voice-controls.ts` | Play/stop polls IDB; independent of layout if `[data-voice-*]` preserved. |

### Tier C — High risk (likely to go wrong)

| Area | Why |
|------|-----|
| **Boot / prefs hydration** | `main.ts` boot order + `applyPrefs` voice/subtitle sync **before** `syncProfileActions` (BUG-027). Re-mounting or re-ordering panel init can resurrect false “Update profile”. |
| **Four dirty layers** | Profile, style, transcript panel, segment modal — UI refresh must not merge dirty booleans. Exit modal (`studio-exit.ts`) only knows profile/style. |
| **Storage listener gate** | `prefsHydrated`, `ignoreStoragePrefs`, `invalidateInFlightSaves` — remounting sections on breakpoint change would reset drafts; **avoid re-mount on resize**. |
| **Preview RAF loop** | `syncPreviewLoop` / `previewCanvases()` — multiple canvases or resize must not duplicate RAF or starve rainbow/bokeh. |
| **Color debounce** | `COLOR_SAVE_DEBOUNCE_MS` + `colorPicker.endInteraction()` on external sync — collapsing panels must not stomp in-progress hue drags. |
| **Subtitle `flushPersist` on pagehide** | Teardown order in `unmount()` — must run before tab death (BUG-017/021). |
| **WYSIWYG copy** | Header says “preview matches recorded video” — rainbow and future effects need honest hints (see `Bake: stepped`). Refresh tagline may need qualification. |

### Tier D — Optional in-Studio recording (separate surgery)

Not required for accordion→cards refresh, but your landscape mock includes record on preview.

| Concern | Detail |
|---------|--------|
| **New surface** | `VoiceRecorder` today lives on **Reddit content script** (`recorder-panel.ts`). Studio is **extension page** — needs recorder variant or shared core with different chrome. |
| **Canvas source** | Record path uses same `waveform.ts` / `captureStream` — preview canvas could become capture target **if** dimensions and theme state match export. |
| **Pipeline unchanged** | `stopRecording` → parallel transcode + transcribe → same storage keys Studio already polls. |
| **Reddit attach** | Still needs Reddit tab for composer — Studio record → bake → user switches tab to attach. |
| **Risk** | Mic permission on extension origin; tab lifecycle (user closes Studio mid-record); progress UI duplication vs recorder panel. |

### 10.1.1 Narrow scope variant (status cards only)

If card faces expose **no interactive controls** — only read-only status/summary (today’s collapsed accordion chips, dressed up) — and **all** editing happens inside a per-section sub-panel/sub-menu, the refresh becomes substantially easier. This matches the original accordion semantics and defers “major controls on the card” to a later feature set.

| Full-scope item (§10.1) | Narrow-scope change |
|-------------------------|---------------------|
| **Major vs full control split** (`render*MajorFields` + `render*AdvancedFields`) | **Removed** — keep existing `render*Fields()` modules intact; mount entire body in sub-panel only. |
| **Bar style 2×2 clipping** (hue wheel ~300px in compact card) | **Removed** — picker runs full-width inside open sub-panel. |
| **Summary chips → card headers** | **Becomes the main card deliverable** — `studio-section-summaries.ts` + `data-summary-*` stay; add optional status cues (e.g. “Bake pending”, “Custom style”). |
| **Portrait vs landscape control density** | **One pattern** — card = status; sub-panel = full controls at both breakpoints. |
| **Tier A shell / grid / hero preview** | Unchanged |
| **Profile/status beside preview** | Unchanged |
| **Tier C** (boot order, dirty layers, no resize re-mount, RAF, debounce) | Unchanged — still the real hazard |
| **Tier D in-Studio recording** | Still separate; not required for card migration |

**New work (narrow scope only):** sub-panel **navigation chrome** — tap card → open sub-view (overlay, slide-in, or full-page push) with Back + section title; preserve `data-studio-panel` wrapper and existing panel bodies. No control duplication on the card face.

**Recommended sequence (narrow):**

1. CSS-only prototype — 2×2 / stack grid + card chrome; summaries on card faces only.
2. Extract layout template from `mount-clip-studio.ts` — hero, panel grid, profile cluster.
3. Sub-panel shell — one generic open/close pattern; wire four cards to existing panel bodies (no `render*` splits).
4. Profile/status cluster beside preview.
5. *(Later)* exposed major controls on cards, if desired.
6. *(Separate)* in-Studio recording.

### Recommended refresh sequence (full scope — minimize pain)

1. **CSS-only prototype** — grid + card chrome on current DOM; validate 2×2 and narrow stack without TS changes.
2. **Extract layout template** from `mount-clip-studio.ts` (header, hero, panel grid) — no behavior change.
3. **Per-section major/advanced split** — one section per sprint (Background simplest; Subtitles last). *Skip if using §10.1.1 narrow scope.*
4. **Profile/status cluster** beside preview.
5. **Recording** — optional phase after layout stable; harness in Studio before Reddit decoupling.

### Out of scope for UI-only refresh (do not accidentally break)

- `enqueuePrefsOp`, `transcriptConfigForProfileStorage`, bake relay, segment IDB, `chrome.storage` keys, offscreen WASM paths.
- Renaming `data-studio-panel`, `data-summary-*`, `data-subtitle-*`, `data-voice-*`, `data-preview-canvas` without migration.

### 10.2 Layout variant — hero row + four-card strip (preferred sketch)

Landscape (wide):

```
┌──────────────────────────────┬─────────────────┐
│ LIVE PREVIEW (hero canvas)   │ PROFILE         │
│                              │ + STATUS strip  │
└──────────────────────────────┴─────────────────┘
┌──────────┬──────────┬──────────┬──────────┐
│ Bar style│Background│  Voice   │ Subtitles│
│ (status) │ (status) │ (status) │ (status) │
└──────────┴──────────┴──────────┴──────────┘
```

Narrow (stack — typical breakpoint when four cards cannot hold min readable width, ~720–900px container-dependent):

```
PROFILE + STATUS
LIVE PREVIEW
Bar style   (status card)
Background  (status card)
Voice       (status card)
Subtitles   (status card)
```

**Card faces (§10.1.1 narrow scope):** read-only — section title, optional icon, `data-summary-*` one-liner, enter affordance (chevron / “Open”). **Sub-panel:** full existing `render*Fields()` body; segment editor pattern for dirty exit.

**Profile + status cluster (top-right landscape):** profile select + Save/Update/Clone/Delete; nested **status** subsection — session guidance (transcript pending/ready, unsaved profile/style, bake available, honest preview caveats). Visual guide, not a second control surface.

#### Layout comparison (pre-flight ratings)

Assumes §10.1.1 narrow scope (status cards + sub-panel only).

| Layout | Landscape | Narrow |
|--------|-----------|--------|
| **A — 2×2 grid** (§10.1 original) | Four section cards in 2×2 below/beside preview | Same cards stacked |
| **B — 1×4 strip** (§10.2) | Hero row (preview + profile/status) + **one row of four** cards | Vertical stack of four cards |

| Criterion | A — 2×2 | B — 1×4 strip | Notes |
|-----------|---------|---------------|-------|
| **UX / intuitiveness** (1–10) | **7** | **9** | B separates “watch” (hero) from “configure” (four doors); scan line matches four bounded sections; profile/status beside preview answers “what am I editing?” |
| **Ease of development** (1–10) | **7** | **9** | B is pure CSS grid (`2fr 1fr` hero + `repeat(4,1fr)` strip); one collapse rule (`4→1` columns). A fights vertical budget (preview vs 2×2 height) and uneven card aspect ratios |

**Pain vs §10.1 plan:** Switching B→vertical **reduces** overall pain vs 2×2 — not increases. Tier C unchanged. Tier B **bar-style clipping in cards** already removed by narrow scope; B’s thinner landscape cards only affect summary truncation (solved with progressive disclosure, not control layout). **New watchpoint:** subtitle summary verbosity — use card badge + hover tooltip, not full cue list on the face.

**Recommended breakpoint:** collapse the four-card strip to a single column when `min(card) < ~160px` or container width `< ~720px` (tune in CSS prototype). Aspect ratio alone is a weak signal; **container query on the strip** is more reliable than `1:1`.

### 10.3 Visual design — CVD-friendly tech accent

Studio chrome should read as **retro / punchy / tech** without relying on red-vs-green semantics.

| Principle | Guidance |
|-----------|----------|
| **Palette anchor** | Deep **indigo** surfaces + **amber** accents (warnings, active affordances, “needs attention”). Success/ready: cyan or amber outline + icon, not green alone. |
| **State encoding** | Never color-only: pair hue with **icon, label, weight, or position** (badge text, border style, `aria-live` status). |
| **Contrast** | WCAG AA for body text; punch via typography (mono status lines, bordered cards) not neon saturation. |
| **Preview honesty** | Stepped-bake and similar caveats live in status strip + sub-panel, not only tooltips. |

Vector assets for the four cards should be **recognizable silhouettes** (bars, frame, waveform/mic, caption lines) — usable at 24–32px beside titles.

### 10.4 Unified sub-panel exit guard (target contract)

Any **editing sub-panel** (four section menus; future help/settings) should share one close/back behavior, modeled on `subtitle-segment-editor.ts` modal unsaved flow:

| Action | Behavior |
|--------|----------|
| **Back / close** | If sub-panel dirty → inline prompt: **Save / Apply**, **Discard**, **Keep editing** (cancel). If clean → close immediately. |
| **Dirty scope** | Section-local draft vs open baseline — do not merge the four global dirty layers (§3.5) into one flag; **compose** prompts (e.g. profile dirty + section dirty → ordered prompts). |
| **Done (global)** | Still `hasStudioUnsavedChanges` + `studio-exit.ts` for profile/style; transcript panel + segment modal keep existing rules. |
| **Implementation** | Extract shared helper (e.g. `studio-subpanel-guard.ts`) — **one sprint**, layout-agnostic; applies equally to layout A or B. |

Card faces remain non-interactive except **enter**; all apply/discard lives inside the sub-panel or its close guard.

### 10.5 Vector assets (v4 refresh)

| Location | Contents |
|----------|----------|
| `public/assets/design-studio-v4/` | Runtime SVGs (panels, icons, status, buttons, chrome) |
| `docs/design-studio-v4/asset-inventory.md` | MVP punch list, deprecated assets, gaps |
| `docs/design-studio-v4/vector-ui-assets-spec.md` | Authoring spec + theming |
| `entrypoints/design-studio/studio-palette.css` | CVD-friendly CSS tokens (§10.3) |
| `entrypoints/design-studio/studio-v4-chrome.css` | 9-slice utility classes |
| `src/ui/design-studio/studio-v4-assets.ts` | Asset path constants + `studioV4BorderImage()` |
| `public/assets/design-studio-v4/CATALOG.md` | Full file index |

**MVP status (2026-06-23):** Asset set complete; **shell wired** in v3.7.0 — hero bezel (`preview-window-frame.svg` + `.legacy.svg`), negation nav chip, card footer rail, `studio-v4-buttons.css` (violet confirm / amber action / charcoal negation).

**Fallback tags:** `v3.7.0` (UI shell + subtitles) · `v3.6.0` (behavior-only baseline) · `v3.6.0-ui-assets-ready` (assets before layout TS).

### 10.6 v5 polish — design unification (branch `polish-v5`)

A studio-wide coherence pass on top of the v4 shell. **No structural change** — hero
+ 1×4 strip + sub-panels and every `data-*` / storage / dirty-state contract are
intact. What changed is the visual language, now enforced from one token source.

**Tokens (`studio-palette.css` — evolved, no new hues).** New semantic layer on the
existing indigo→amber axis:

| Token | Role |
|-------|------|
| `--studio-focus` | One focus ring studio-wide (retired the off-palette `#4fbcff` slider stray) |
| `--studio-control-on` | Toggle "on" fill — replaces inherited Reddit-popup blue `#0079d3` |
| `--studio-field-label` | Field labels — replaces inherited Reddit gray `#818384` |
| `--studio-surface-raised` / `--studio-hairline*` | One raised-control fill + one divider language |
| `--studio-track-glow` | Physical-slider illumination hook |
| `--studio-accent-{bars,background,voice,subtitles}` | **Cividis 4-stop section ramp** (cool→warm, monotonic luminance) |

**Form-control coherence (`studio-v4-controls.css`, new).** The Studio imports
`popup/style.css`, which is authored for the Reddit-native popup. All shared
`.popup__*` controls (toggles, selects, labels) are now overridden **scoped to
`.studio-v4`** so the popup itself is never touched. This closes the single biggest
"assembled, not designed" leak.

**Type system.** Self-hosted **Chakra Petch** (machined display face, `font-src 'self'`,
~20 KB total) for the wordmark + section/sub-panel titles; **`RVN-DejaVu-Mono`** (already
registered by `preview-font-loader.ts`, the same family the bake can render) for all
**numeric/status readouts** — values look measured, prose stays in the UI sans.

**Section ramp (§10.3 extension).** Each card carries one `--card-accent` driving its
title, head divider, enter-chip glow, and icon halo. The accent is **always** paired with
the section's icon + label, so it remains reinforcement, never color-only.

**Signature.** The hero preview reads as a **powered studio monitor**: a lit readout with
a breathing `LIVE` dot and the `PREVIEW = OUTPUT` invariant **etched into the glass**. The
**physical analog slider** is now the universal control — the last generic `<input
type=range>` (3 in Subtitles: font size, backdrop opacity, glow strength) was migrated to
the pointer-captured `physical-slider`; **zero `type=range` remain in the Studio.**

**Motion.** One orchestrated boot reveal (hero → four cards stagger) + the LIVE breath +
slider thumb glow, all gated behind `prefers-reduced-motion`.

**Recorder panel (§ cross-surface).** Pulled toward Studio chrome — nocturnal-indigo
surface, machined lit edge, amber signage, waveform reframed as a monitor, success→cyan
(no green). Stays **dark in light Reddit** (the Studio is dark by identity) and keeps the
**theme-derived Record accent**. `RVN_COLORS` is untouched, so the Reddit-native popup and
toast are unaffected. Justification: the panel is the same creative tool *docked* into
Reddit; the only retained Reddit-native trait is system-ui type (no web-font cost on
reddit.com).

**Fallback tag:** `v5.0.0` (Dulcet II baseline before this pass).

---

## 11. Open work (within sections, non-blocking)

| Item | Section | Notes |
|------|---------|-------|
| ~~Trim raw capture WebM~~ | Voice / Timeline | **Done v5.10.0** (QA PASS 2026-07-12): [`v5.10.0-raw-trim-apply-roadmap.md`](v5.10.0-raw-trim-apply-roadmap.md) — audio-only WebM cut + re-stamp; post-trim voice re-apply restored; raw-leg failure → honest v5.9 lock |
| Artifact persistence acknowledgment | Bake / State | Architecture H13: store save must return persisted meta or throw before stamp/signal |
| Recovery voice provenance | Capture / Recovery | Architecture H8: interrupted draft resumes with current prefs because completion stamp does not exist yet |
| v6 visual maturity | Shell / Background | Theme/background/elevation/reduced-motion audit after the functional editing arc |
| Font picker | Subtitles | Deferred |
| Slider drops pointer on vertical drag-off | Shell / Sliders | `physical-slider.ts` loses tracking when the cursor is pulled below the row (mouse + touch); thumb stops following. Confirmed polish-v5, deferred. Likely a `setPointerCapture` / `pointermove` host-scope issue |
| Card icons fixed-amber (not accent-tinted) | Shell | Cividis ramp rides title/divider/chip/halo; full icon tint needs `<img>`→CSS-mask in `studio-v4-shell.ts`. Deferred (polish-v5) |
| Legacy `transcriptConfig` on profiles | Subtitles / Profile | Update profile once embeds style |
| ~~Section tabs vs `<details>`~~ | Shell | **Done v3.7** — hero + 1×4 cards + sub-panels |
| ~~Unified sub-panel exit guard~~ | Shell | **Done v3.7** — `studio-subpanel-guard.ts` |
| ~~CVD-friendly chrome palette~~ | Shell | **Done v3.7** — `studio-palette.css` + `studio-v4-buttons.css`; theme-hue accents unchanged |
| Sub-panel control chrome (knobs/sliders SVG) | Shell | Assets exist; not fully wired in panel bodies |
| v4 Done / profile button assets | Shell | Sub-panel Done styled; main header Done still legacy |

---

## 12. Related documents (deep dives — not duplicated here)

**Inbound rule:** Any doc that touches Design Studio development should link here for current UI semantics. This table is the outbound index.

| Doc | Use when |
|-----|----------|
| `docs/code-review.md` | Pre-change gate; fallback tags |
| `docs/engineering-principles.md` | Semantic health, save pathways, ImageDB |
| `docs/v4-development-principles.md` | Branch model, compositing, WASM queues |
| `archive/docs/eloquent-4-handoff.md` | Subtitle bake QA, BUG-025…032 |
| `docs/eloquent-profile-handoff.md` | Prefs race rules, BUG-021…024 |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack (Studio §7 integration) |
| `docs/v5.5.0-browser-composite-migration.md` | Default in-page subtitle composite and fallbacks |
| `docs/v5.6.0-audio-decoupling.md` | Voice provenance/re-apply + edit/splice contracts |
| `docs/v5.8.0-trim-ui-visual-subtitle-editor.md` | Timeline editor as-built |
| `docs/v5.9.0-trim-apply-roadmap.md` | Atomic trim apply as-built + QA |
| `docs/v5.10.0-raw-trim-apply-roadmap.md` | Raw WebM trim + post-trim voice re-apply as-built + QA |
| `docs/release-notes-v5.10.0.md` | Latest ship notes (prior versions under `archive/docs/`) |
| `docs/bug-archive.md` | Full bug write-ups |
| `archive/docs/release-notes-v3.1.0.md` | v3.1 collapsible panels + single-preview UX change |
| `archive/docs/release-notes-v3.7.0.md` | v3.7 v4 UI shell (hero, cards, sub-panels, preview bezel) |
| `archive/progress/eloquent-branch.md` | v4 subtitle phase plan (historical milestones + open work) |
| `archive/progress/dulcet-branch.md` | v3 voice-effects phase plan (Voice section origin) |
| `archive/progress/pretty-branch.md` | v2 personalization phase plan (Bar style / Background origin) |
| `claude-progress.md` | Session timeline and release tags |
| `archive/docs/eloquent-profile-checkpoint.md` | **Historical** profile bug cluster audit (superseded for semantics) |
| `archive/docs/eloquent-profile-checkpoint-hydrated.md` | **Historical** BUG-023 checkpoint |
| `docs/architecture/` | Architecture map, extension-points registry, hardening backlog — cross-cutting view (`/architecture-hardening`) |

---

## 13. Future: temporal effects (in-Studio recording shipped v5.4.0)

### 13.1 Temporal subtitle effects (tack-ons)

> **Historical note:** rainbow pulse was removed in v5.3. Segment-aware cue preview/timeline shipped in v5.8, and the default bake now uses the shared painter. The rows below are retained only as design history for future temporal effects.

| Direction | Bake fidelity | Cost |
|-----------|---------------|------|
| User-adjustable rainbow speed | Changes Δhue per slice, not slice rate | Prefs field only |
| Finer slices (e.g. 0.15 s) | More steps per second — actually smoother | More drawtext filters per cue |
| Coarser slices / max-slice cap | Choppier but safer on long clips | Fewer filters |
| ASS/libass with `\t()` color tags | Smooth per-frame hue possible | New burn path + wasm libass risk (BUG-025 removed this) |
| Canvas subtitle pass in `base.mp4` | Matches preview exactly | Subtitles in capture layer — breaks “subs are post-transcode burn-in” invariant unless architecture shifts |
| Segment-aware preview timing | **Shipped v5.8** | Timeline/segment player over the shared cue draft |

**Hard limit today:** expressive `fontcolor` in **drawtext** on the **ffmpeg.wasm** burn path. Not a hard limit on the **product** — alternate burn strategies can exist — but any new path must pass BUG-025/028/031-style validation.

### 13.2 In-Studio recording (shipped v5.4.0 Design Studio First)

**Implemented:** Studio is now the primary capture surface with live WYSIWYG (recorder-host + live canvas handover). Reddit is the polished output/attach target. Full take lifecycle, recovery, and attach mode shipped. See:

- `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md` (Phase 2 as-built)
- `claude-progress.md` v5.4.0
- `archive/docs/release-notes-v5.4.0.md`
- `docs/architecture/architecture-map.md` (take lifecycle + studio capture)

The original "optional" vision is now the default path; Reddit tab remains for quick attach + legacy capture. Pipeline at stop is unchanged and unified.

---

## 14. Source file index (modules)

```
entrypoints/design-studio/
  main.ts              Boot
  studio-palette.css   CVD tokens (§10.3)
  studio-v4-chrome.css 9-slice utilities
  studio-v4-layout.css Hero + strip + sub-panel shell
  studio-v4-buttons.css v4 action palette
  style.css            Legacy + shared controls

src/ui/design-studio/
  mount-clip-studio.ts     Shell, hero, profile cluster, panel wiring
  studio-v4-shell.ts       CSS var injection for 9-slice / frames
  studio-v4-subpanel-shell.ts  Sub-panel chrome + guard hooks
  studio-v4-panel-summary.ts   Status card faces
  studio-status-strip.ts   Profile Subtitles? / Ready? rows
  studio-subpanel-guard.ts Unified dirty exit prompt
  studio-section-summaries.ts  Collapsed chips
  studio-exit.ts           Done / exit modal logic
  studio-save-pathways.ts  Clone / fork prompts
  open-design-studio.ts    tabs.create relay
  workflow-phase-banner.ts 3-phase stepper + CTA; reads rvn.workflow.phase + live status
  preview-block.ts         Canvas markup
  color-picker.ts          Bar style colors
  effect-controls.ts       Glow + flair
  background-layout-controls.ts
  voice-controls.ts
  subtitle-controls.ts
  subtitle-segment-editor.ts
  subtitle-timeline-editor.ts
  subtitle-bake.ts
  studio-recorder.ts
  studio-take-recovery.ts
  current-take-status.ts
  radial-knob.ts
```

```
src/workflow/
  workflow-state.ts        WorkflowPhase type; rvn.workflow.phase CRUD; activateRedditTab()
```

**Supersedes (semantics only, not history):** scattered Studio layout/behavior notes in branch plans, handoffs, and checkpoints. Those docs remain authoritative for bug timelines, commit chains, and sprint QA. When a older doc disagrees with this file on *current* Studio behavior, **this file wins**.

## Resume in a new chat (carry-forward)

```
Design Studio canonical semantics refreshed through tagged v5.10.0 (QA PASS 2026-07-12).
Primary surface: native capture + live canvas, voice audition/re-apply, List/Timeline cues,
browser-composite subtitle bake with verified partial splice, atomic trim + raw WebM cut, take deck/download.
Preview=bake: shared painter; cue timing I17. Trim preview=APPLY: dual-copy shift I18; rawAudio tri-state.
State: TakeManager owns rvn.take.current; blobs remain in H6-verified single-slot IDB stores.
Messages: capture transcode/STT and FFmpeg fallbacks use existing pipelines; Studio progress is direct runtime broadcast.
Open: H13 persisted-write acknowledgment, H8 recovery voice provenance, v6 visual maturity.
Read docs/architecture/architecture-map.md v2.8 before changing cross-context behavior.
```
