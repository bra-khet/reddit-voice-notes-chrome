# Design Studio — semantic framework & architecture reference

**Status:** Canonical source of truth for Design Studio behavior (v3.6.0 / `eloquent`, 2026-06-22).  
**Audience:** UI refresh, new features within existing sections, and onboarding.  
**Stable tag:** `v3.6.0` · **Restore:** `git checkout v3.6.0 && npm install && npm run dev`

---

## 1. Product framing

Design Studio is the **primary product surface** of Reddit Voice Notes. The Reddit recorder is the capture and delivery shell; Studio is where users personalize clips, preview output, edit transcripts, and bake captions.

Treat Design Studio as a **self-contained suite** (extension-origin app) that:

- Owns all clip-appearance state and preview fidelity.
- Persists named profiles and custom styles.
- Orchestrates voice-effect preview and subtitle edit→bake workflows.
- Pushes live prefs to the recorder via `chrome.storage.local` — no separate “apply” step.

Future UI refreshes must preserve the **semantic contracts** in this document even when layout, components, or styling change.

### 1.1 Entry points

| Entry | Mechanism | File |
|-------|-----------|------|
| Extension popup | Link / summary → opens tab | `entrypoints/popup/` |
| Recorder panel | **Open Design Studio** CTA (subtitles on) | `src/ui/design-studio/open-design-studio.ts` |
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

### 2.1 Vertical stack (top → bottom)

```
┌─────────────────────────────────────────────┐
│ Header — title, subtitle, [Done]            │
├─────────────────────────────────────────────┤
│ Profile bar — select, Save/Update, Clone,   │
│               Delete                         │
├─────────────────────────────────────────────┤
│ Live preview — single canvas (WYSIWYG)      │
├─────────────────────────────────────────────┤
│ ▼ Bar style    — collapsed summary chip     │
│ ▼ Background   — collapsed summary chip     │
│ ▼ Voice        — collapsed summary chip     │
│ ▼ Subtitles    — collapsed summary chip     │
├─────────────────────────────────────────────┤
│ Footer note — Clone / Save to new / Update   │
└─────────────────────────────────────────────┘
```

**Panel order is semantic:** bottom → top compositing in the final MP4 is **background → bars → subtitles**. Voice is audio-only (no canvas layer). Subtitles panel is last in the stack because it is the topmost visual layer.

### 2.2 Collapsible panels

Each section is a `<details class="studio__panel">` with:

- **Title** — human name (`Bar style`, `Background`, `Voice`, `Subtitles`).
- **Summary chip** — live one-line state (`data-summary-*`), updated by `studio-section-summaries.ts`.
- **Body** — section-specific controls; mounted by dedicated `mount*Controls` modules.

Collapsed summaries must remain accurate while the panel is closed — they are the primary scan affordance until a UI refresh replaces them.

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
- **Personal background** — blob in `rvnImageDb`; prefs hold id only.
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

**Position dropdown order:** **top → center → bottom** (matches on-screen vertical order). This has regressed before — keep `POSITION_OPTIONS` in that sequence in `subtitle-controls.ts`, not lexical/reverse order.
| Bake subtitles into MP4 | — | `rvnLastBakedMp4` IDB |
| Clear transcript | — | Clears session IDB |

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

**Rainbow pulse (`specialHueRainbow`):** Rotates special-hue text/glow through the hue wheel over time. **Preview** uses `previewTimeMs` from the Live preview RAF. **Bake** cannot animate `fontcolor` in FFmpeg drawtext — rainbow is quantized into **0.25 s static-color slices** per cue (max 24). Stepped, not per-frame; ~0.35 hue cycles/s. Filter graph grows with slice count.

**Rainbow pulse (`specialHueRainbow`):** Rotates special-hue text/glow through the hue wheel over time. **Preview** uses `previewTimeMs` from the Live preview RAF (same clock as bokeh). **Bake** cannot use expressive `fontcolor` in FFmpeg drawtext — rainbow is **quantized into 0.25 s static-color slices** per cue (max 24 slices). Not true per-frame hue; stepped but WYSIWYG-close at medium-fast speed (~0.35 cycles/s). Filter graph grows with slice count — very long clips with many cues may need coarser slices later.

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

## 11. Open work (within sections, non-blocking)

| Item | Section | Notes |
|------|---------|-------|
| Segment-aware canvas preview | Subtitles | `previewText()` flat today |
| Font picker | Subtitles | Deferred |
| Chunked base-MP4 relay | Subtitles | If large-clip bake fails |
| Legacy `transcriptConfig` on profiles | Subtitles / Profile | Update profile once embeds style |
| Section tabs vs `<details>` | Shell | Layout only — semantics unchanged |

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
| `eloquent-branch.md` | v4 subtitle phase plan (historical milestones + open work) |
| `dulcet-branch.md` | v3 voice-effects phase plan (Voice section origin) |
| `pretty-branch.md` | v2 personalization phase plan (Bar style / Background origin) |
| `claude-progress.md` | Session timeline and release tags |
| `docs/eloquent-profile-checkpoint.md` | **Historical** profile bug cluster audit (superseded for semantics) |
| `docs/eloquent-profile-checkpoint-hydrated.md` | **Historical** BUG-023 checkpoint |

---

## 13. Source file index

```
entrypoints/design-studio/
  main.ts              Boot
  style.css            Studio-specific styles

src/ui/design-studio/
  mount-clip-studio.ts     Shell, profile bar, preview, panel wiring
  studio-section-summaries.ts  Collapsed chips
  studio-exit.ts           Done / exit modal logic
  studio-save-pathways.ts  Clone / fork prompts
  open-design-studio.ts    tabs.create relay
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

**Supersedes (semantics only, not history):** scattered Studio layout/behavior notes in branch plans, handoffs, and checkpoints. Those docs remain authoritative for bug timelines, commit chains, and sprint QA. When a older doc disagrees with this file on *current* Studio behavior, **this file wins**.