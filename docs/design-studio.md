# Design Studio — semantic framework & architecture reference

**Status:** Canonical source of truth for Design Studio behavior (v3.7.0 / `eloquent`, 2026-06-23).  
**Audience:** UI refresh, new features within existing sections, and onboarding.  
**Stable tag:** `v3.7.0` · **Restore:** `git checkout v3.7.0 && npm install && npm run dev`  
**Prior stable:** `v3.6.0` (subtitle pipeline; pre–v4 UI shell)

---

## 1. Product framing

Design Studio is the **primary product surface** of Reddit Voice Notes. The Reddit recorder is the capture and delivery shell; Studio is where users personalize clips, preview output, edit transcripts, and bake captions.

Treat Design Studio as a **self-contained suite** (extension-origin app) that:

- Owns all clip-appearance state and preview fidelity.
- Persists named profiles and custom styles.
- Orchestrates voice-effect preview and subtitle edit→bake workflows.
- Pushes live prefs to the recorder via `chrome.storage.local` — no separate “apply” step.

Future UI refreshes must preserve the **semantic contracts** in this document even when layout, components, or styling change.

### 1.0 3-Phase Creative Workflow (canonical mental model)

The extension's UX is framed as a deliberate 3-phase creative workflow. Use this exact terminology everywhere — in UI copy, documentation, and commit messages.

| Phase | Tab | Description |
|-------|-----|-------------|
| **Phase 1: Design** | Design Studio | Choose clip style, voice effects, background, subtitle style. |
| **Phase 2: Capture** | Reddit tab | Record voice inside the comment composer. |
| **Phase 3: Polish & Bake** | Design Studio | Review/edit subtitles, bake captions into MP4, finalize. |

**Shared state key:** `rvn.workflow.phase` in `chrome.storage.local` (`'design' | 'capture' | 'polish'`). This carries the user's *intent* phase cross-tab. Authoritative recording/transcript state remains in IDB and subtitle controls as before.

**Phase transitions (automatic):**
- Design Studio "Switch to Reddit" CTA → sets `'capture'`
- Recorder panel recording stops → sets `'polish'`
- Banner auto-promotes to Phase 3 UI when `hasSessionRecording()` is true, regardless of stored phase

**Helpful one-liner for UI copy:** "Recording happens inside Reddit for a native feel. Design and post-production happen here in the Studio for full controls and real-time preview."

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
| WASM in Studio | **None** — FFmpeg/Vosk run in offscreen doc only |
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

**Preview count:** One **Live preview** canvas since v3.1.0 (secondary/tertiary previews removed — see `docs/release-notes-v3.1.0.md`). Older branch docs may still mention dual preview; current code mounts `renderPreviewBlock('primary')` only.

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
| IndexedDB | `rvnImageDb` | Personal background blobs | Direct (extension origin) | Upload/delete UI |
| IndexedDB | `rvnLastRecording` | Last WebM for voice preview | Voice controls | — (recorder relay) |
| IndexedDB | `rvnSessionTranscript` | Vosk + edited transcript | Subtitle controls | Confirm & save |
| IndexedDB | `rvnLastBaseMp4` | Transcoded base for bake | Bake | — (recorder relay) |
| IndexedDB | `rvnLastBakedMp4` | Burned MP4 output | — | Bake |

**Never** put image blobs or transcript cue text in `rvnUserPrefs`.

### 3.3 Preview = output guarantee

The **single** Live preview canvas uses `renderThemePreview()` with the same inputs the recorder canvas uses for video pixels:

- Resolved theme + `designOverrides`
- `barAlignment`
- Personal background id + layout (Studio reads ImageDB directly)
- Subtitle overlay options from `subtitleControls.getPreviewOptions()`

Animated preview (bokeh, sparkle) runs at 12 fps RAF unless `shouldReduceMotion(prefs)`.

**Invariant:** If it appears in Live preview, the export path must be able to reproduce it — either in the canvas transcode (`base.mp4`) or the subtitle burn-in pass (`final.mp4`).

### 3.4 Compositing layers (final MP4)

Bottom → top:

1. **Background** — theme gradient/SVG/bokeh + optional personal image.
2. **Bars** — waveform + glow/effects (canvas capture at 24 fps on Reddit).
3. **Subtitles** — FFmpeg drawtext burn-in on `base.mp4` (never in canvas RAF).

Voice effects apply to the **audio track** in the transcode pass (`-af`), not as a visual layer.

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
**Summary:** `formatVoiceEffectSummary` — e.g. `Voice: Robot · 7/10` or `Voice: Off`.

### 6.1 Controls inventory

| Control | Data field | Persist path |
|---------|------------|--------------|
| Enable toggle | `voiceEffect.enabled` | Debounced `saveVoiceEffectPreferences` (250 ms) |
| Preset select | `voiceEffect.presetId` |同上 |
| Intensity slider | `voiceEffect.intensity` |同上 (does not force Custom — BUG-009) |
| Turbo toggle | maps intensity to 12 |同上 |
| Pitch radial knob | `semitoneOffset` → switches to Custom when moved |同上 |
| Play preview / Stop | — (no persist) | — |

### 6.2 Semantic model

- **Preview path:** `rvnLastRecording` WebM → Web Audio chain (`preview-chain.ts`) — post-capture, no transcode.
- **Export path:** Same prefs → FFmpeg `-af` on WebM→MP4 in offscreen — failure falls back to raw audio + toast on recorder.
- **STT input:** Transcription uses **raw** WebM clone (pre-voice-effect) for recognition quality; burn-in timing still aligns on final MP4.

Preview reload: `LAST_RECORDING_READY_KEY` storage signal + 2 s IDB poll while Studio stays open.

### 6.3 Web Audio rule

AudioParam properties use `.value` assignment — never assign to the property itself (BUG-008).

### 6.4 Module map

| File | Role |
|------|------|
| `voice-controls.ts` | UI + preview player |
| `src/voice/preview-chain.ts` | Web Audio graph |
| `src/voice/resolve-config.ts` | Intensity scaling, preset resolution |
| `src/storage/last-recording-db.ts` | Preview source blob |

---

## 7. Section — Subtitles

**Panel id:** `data-studio-panel="subtitles"`  
**Summary:** `formatSubtitleSummary` — e.g. `On · bottom · 22px` or `Off`.

This section is the largest integrated subsystem: prefs + session IDB + offscreen Vosk + FFmpeg burn-in + recorder relay.

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
| Rainbow pulse | `subtitleStyle.specialHueRainbow` — time-varying hue on special layers | prefs |
| Theme glow | `subtitleStyle.glow` | prefs |
| Glow mode / color / strength | `glow.mode` (`halo` \| `border`), `colorSource`, `opacity` (halo only) | prefs |

| Bake subtitles into MP4 | — | `rvnLastBakedMp4` IDB |
| Clear transcript | — | Clears session IDB |

**Position dropdown order:** **top → center → bottom** (matches on-screen vertical order). This has regressed before — keep `POSITION_OPTIONS` in that sequence in `subtitle-controls.ts`, not lexical/reverse order.

### 7.2 End-to-end pipeline

```
stopRecording() [Reddit]
  ├─ transcode → base.mp4 → mp4Blob + relay to rvnLastBaseMp4
  └─ fork transcribe (if subtitles on) → Vosk → relay to rvnSessionTranscript

Design Studio
  ├─ Poll/load session transcript (Pending → Ready / Timed out badges)
  ├─ Edit cues in modal → Apply to preview → Confirm & save (IDB)
  ├─ Style controls → prefs (live preview overlay)
  └─ Bake → MSG_BURNIN_* → offscreen FFmpeg drawtext → rvnLastBakedMp4
       └─ BAKED_MP4_READY_KEY → recorder applyBakedMp4()
```

Recorder reaches **stopped** after transcode only (BUG-026); transcribe does not block the progress bar.

### 7.3 Segment editor (YouTube-style)

| State | Location | Meaning |
|-------|----------|---------|
| `originalResult` | Session IDB | Immutable Vosk baseline |
| `edited` | In-memory + IDB | Working copy |
| `savedBaseline` | In-memory | Last **Confirm & save** — panel dirty compares here |
| `modalOpenBaseline` | In-memory | Snapshot at modal open — modal dirty compares here |

**Modal close guard (v3.6.0):** Closing via ×, Cancel, backdrop, or Escape with unsaved modal edits shows inline prompt: **Apply to preview** / **Discard** / **Keep editing**.

**Panel-level:** **Confirm & save** persists to IDB; **Discard edits** reverts to `originalResult`.

**Bake guard:** If panel dirty, bake shows unsaved dialog — Save & bake / Edit transcript / Cancel.

### 7.4 Preview vs bake fidelity

| Aspect | Preview | Bake |
|--------|---------|------|
| Text | `getPreviewOptions()` — flat `previewText()` today* | Per-segment `textfile=` drawtext |
| Style | `subtitle-effects.ts` layering | `subtitle-burnin.ts` same layer order |
| Glow/border/backdrop | Canvas overlay | FFmpeg drawtext duplicates |

**Subtitle effects (v3.6.1+):** Drop shadow removed (theme glow covers contrast). Glow modes: **halo** (soft, opacity slider) or **border** (solid 1 px ring, no alpha). **Special hue** is one shared `specialHue` field for both text and glow when either selects `special`.

**Rainbow pulse (`specialHueRainbow`):** Rotates special-hue text/glow through the hue wheel (~**3 s** per cycle at `RAINBOW_CYCLES_PER_SECOND = 0.35`). **Preview** uses `previewTimeMs` from the Live preview RAF (~12 fps). **Bake** cannot animate `fontcolor` in FFmpeg drawtext — rainbow is **quantized into 0.25 s static-color slices** per cue (max 24).

**Why faster rotation looked *choppier* (counterintuitive):** The **step rate is fixed** by `RAINBOW_BAKE_SLICE_SECONDS` (0.25 s), not by cycle speed. Each slice holds one static `fontcolor` for ¼ s. Cycle speed only changes **how many degrees of hue advance between slices** (`Δhue ≈ sliceSeconds × cyclesPerSecond × 360°`). Faster rotation → larger color jumps per step → more visible stepping. Slower rotation → smaller jumps → smaller appearance change but **same step cadence**. To change step *frequency*, adjust slice duration (costs more drawtext filters). UI hint: **Bake: stepped** on the Rainbow pulse toggle. See **pipeline-native solutions** in `docs/engineering-principles.md`.

\*Segment-aware timed preview on canvas is **open** (eloquent-4b) — preview may lag bake until implemented.

### 7.5 Offscreen relay (BUG-032)

Progress/failure from offscreen must reach Reddit tab via `relay-registry.ts` session `jobId→tabId`. Studio extension tab does not use tab relay for burn-in (listeners on `runtime.sendMessage`).

### 7.6 Module map

| File | Role |
|------|------|
| `subtitle-controls.ts` | Panel orchestration, bake, prefs debounce |
| `subtitle-segment-editor.ts` | Cue list, modal, pending badges |
| `subtitle-bake.ts` | Load base MP4, call burn-in client |
| `src/ffmpeg/burnin-client.ts` | MSG_BURNIN_* client |
| `src/ffmpeg/subtitle-burnin.ts` | drawtext strategies |
| `src/storage/session-transcript-db.ts` | Transcript persistence |

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
| `MSG_BURNIN_*` | Studio → offscreen | Subtitle bake |
| `MSG_TRANSCRIBE_*` | Recorder → offscreen | Parallel STT (not Studio-initiated) |
| `LAST_RECORDING_READY_KEY` | Recorder → storage | Voice preview refresh |
| `SESSION_TRANSCRIPT_READY_KEY` | Background → storage | Transcript poll |
| `BAKED_MP4_READY_KEY` | Studio → storage | Recorder apply captioned MP4 |

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
| 3-phase workflow banner | Shell | `workflow-phase-banner.ts` wired; `rvn.workflow.phase` key live |
| Segment-aware canvas preview | Subtitles | `previewText()` flat today |
| Rainbow speed / slice fineness | Subtitles | Tunable `RAINBOW_CYCLES_PER_SECOND` + `RAINBOW_BAKE_SLICE_SECONDS`; user slider optional |
| In-Studio recording (optional) | Shell / Voice | Extension page mic + unified canvas; Reddit tab keeps attach-only — see §13 |
| Font picker | Subtitles | Deferred |
| Slider drops pointer on vertical drag-off | Shell / Sliders | `physical-slider.ts` loses tracking when the cursor is pulled below the row (mouse + touch); thumb stops following. Confirmed polish-v5, deferred. Likely a `setPointerCapture` / `pointermove` host-scope issue |
| Card icons fixed-amber (not accent-tinted) | Shell | Cividis ramp rides title/divider/chip/halo; full icon tint needs `<img>`→CSS-mask in `studio-v4-shell.ts`. Deferred (polish-v5) |
| Chunked base-MP4 relay | Subtitles | If large-clip bake fails |
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
| `docs/eloquent-4-handoff.md` | Subtitle bake QA, BUG-025…032 |
| `docs/eloquent-profile-handoff.md` | Prefs race rules, BUG-021…024 |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack (Studio §7 integration) |
| `docs/bug-archive.md` | Full bug write-ups |
| `docs/release-notes-v3.1.0.md` | v3.1 collapsible panels + single-preview UX change |
| `docs/release-notes-v3.7.0.md` | v3.7 v4 UI shell (hero, cards, sub-panels, preview bezel) |
| `eloquent-branch.md` | v4 subtitle phase plan (historical milestones + open work) |
| `dulcet-branch.md` | v3 voice-effects phase plan (Voice section origin) |
| `pretty-branch.md` | v2 personalization phase plan (Bar style / Background origin) |
| `claude-progress.md` | Session timeline and release tags |
| `docs/eloquent-profile-checkpoint.md` | **Historical** profile bug cluster audit (superseded for semantics) |
| `docs/eloquent-profile-checkpoint-hydrated.md` | **Historical** BUG-023 checkpoint |
| `docs/architecture/` | Architecture map, extension-points registry, hardening backlog — cross-cutting view (`/architecture-hardening`) |

---

## 13. Future: temporal effects & optional in-Studio recording

### 13.1 Temporal subtitle effects (tack-ons)

| Direction | Bake fidelity | Cost |
|-----------|---------------|------|
| User-adjustable rainbow speed | Changes Δhue per slice, not slice rate | Prefs field only |
| Finer slices (e.g. 0.15 s) | More steps per second — actually smoother | More drawtext filters per cue |
| Coarser slices / max-slice cap | Choppier but safer on long clips | Fewer filters |
| ASS/libass with `\t()` color tags | Smooth per-frame hue possible | New burn path + wasm libass risk (BUG-025 removed this) |
| Canvas subtitle pass in `base.mp4` | Matches preview exactly | Subtitles in capture layer — breaks “subs are post-transcode burn-in” invariant unless architecture shifts |
| Segment-aware preview timing | Preview matches cue windows | `previewText()` + segment clock (eloquent-4b) |

**Hard limit today:** expressive `fontcolor` in **drawtext** on the **ffmpeg.wasm** burn path. Not a hard limit on the **product** — alternate burn strategies can exist — but any new path must pass BUG-025/028/031-style validation.

### 13.2 Optional recording inside Design Studio

Feasible as a **mode**, not a replacement for Reddit attach:

- **Studio wins:** extension-origin page — direct ImageDB, no personal-bg relay, same canvas as Live preview, prefs already hydrated, mic via `getUserMedia` (extension pages allow it).
- **Reddit tab stays:** composer injection, attach MP4/WebM to post, content-script Shadow DOM.
- **Pipeline unchanged at stop:** `webmBlob` → parallel transcode + transcribe → same IDB/storage signals Studio already polls.
- **UX win:** record → edit → bake without tab hopping; preview WYSIWYG is literally the capture canvas.
- **Work:** relocate or duplicate `VoiceRecorder` shell into Studio; keep one transcode queue; Reddit panel becomes optional “quick record” entry.

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
  subtitle-bake.ts
  radial-knob.ts
```

```
src/workflow/
  workflow-state.ts        WorkflowPhase type; rvn.workflow.phase CRUD; activateRedditTab()
```

**Supersedes (semantics only, not history):** scattered Studio layout/behavior notes in branch plans, handoffs, and checkpoints. Those docs remain authoritative for bug timelines, commit chains, and sprint QA. When a older doc disagrees with this file on *current* Studio behavior, **this file wins**.