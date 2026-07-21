> **ARCHIVED SNAPSHOT — do not edit.**
> Captured **2026-07-20**, after all three **v6.0 Polish & Visual Maturity** tracks merged to `main`, by the fourth `/docs-archiving` **Refresh**.
> This is the complete, immutable session log through Track A audio-reactive visuals, Track C popup refresh, and Track B direct-manipulation background layout with operator QA PASS.
> Earlier snapshots remain under this directory. The slim living progress file is at [claude-progress.md](../../claude-progress.md); the milestone index is [docs/HISTORY.md](../../docs/HISTORY.md).

---

# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on work **after v5.10.0 (Raw Trim Apply)**. Completed sprint-by-sprint history is preserved verbatim:

- v5.9.0 → v5.10.0 raw-trim-apply arc (incl. real-browser QA): [`archive/progress/claude-progress-through-v5.10.0.md`](archive/progress/claude-progress-through-v5.10.0.md)
- v5.8.0 → v5.9.0 timeline-and-trim arc: [`archive/progress/claude-progress-through-v5.9.0.md`](archive/progress/claude-progress-through-v5.9.0.md)
- v5.4.0 → v5.7.0 editing-suite arc: [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- v1.0.0 → v5.3.10 history: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)

The full prior content is intact so this file can stay small and actionable. Add new session entries below the current-work section; run `/docs-archiving` (Refresh) after the next tagged milestone or major feature.

## Baseline — v5.10.0 Raw Trim Apply (**SHIPPED · QA PASS · tagged**)

**Stable:** `v5.10.0` · **Tag:** `v5.10.0` · **Code:** 2026-07-11 · **Real-browser QA:** **PASS 2026-07-12** · **Push:** deferred (user pushes)

**Apply trim** now cuts the raw capture WebM with the base MP4: pure `planRawTrimLeg` gate → `applyTrimToWebM` (mediabunny, **audio-only** Opus) → fresh `baseRecording` stamp in the same atomic write. **Post-trim voice re-apply / Change Voice work again.** Raw-leg failure demotes honestly to the v5.9 stamp-drop lock and never fails the MP4 trim. `rawAudio: 'trimmed' | 'dropped' | 'none'`. Zero Voice-panel code — unlock is emergent (H6 stamp + `savedAt` poll).

Authoritative references:

- As-built design: [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) §10
- Release notes: [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)
- Prior leg (atomic MP4 apply): [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md); notes *(archived)* [`archive/docs/release-notes-v5.9.0.md`](archive/docs/release-notes-v5.9.0.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map **v2.8**, extension-points **v1.10**, backlog **v2.6**, ADRs 0001–0005
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

**Verify (at ship):** timeline **22** · take-manager **34** · Node sweep green · `npm run build` PASS @ 5.10.0 · `tsc` = 3 documented pre-existing. **No post-QA code fixes.**

**QA note (accepted, not a defect):** manual DevTools delete of `rvnLastRecording` can leave the open path stale until a full extension reload — normal users never nuke IDB by hand.

## v5.11.0 preferences storage refactor — **SHIPPED · browser QA PASS (2026-07-13) · merged to `main` + tagged `v5.11.0` (push deferred)**

**Branch:** `feature/v5.11.0-prefs-storage-refactor` from H8 commit `ad534df` · QA build `ebca7cb` · **Package:** `5.11.0` · **Decision:** ADR-0006
**Source of truth:** [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md) · **Release notes:** [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md) · checklist `.ignore/QA-5.11.0/qa-checklist.md`

The public `UserPreferencesV1`/`USER_PREFS_VERSION` contract stays v1. Durable truth now lives in extension-origin `rvnUserPrefs` IndexedDB: one `global` row plus per-entity `profiles` and `customStyles` rows, replaced in one transaction under the existing `enqueuePrefsOp` choke point. `rvnUserPrefs.v2` local is a schema/migration marker + monotonic revision signal only, published after IDB commits. Profiles retain normalized `voiceEffectConfig` + profile-safe `transcriptConfig`; session transcript result text is stripped at the split boundary.

Reddit content scripts cannot access extension IDB, so the thin wrapper transparently uses two bounded background request/response operations for load/replace; background handlers call explicit direct helpers. Popup/Studio/background use IDB directly. No caller changed and no work/progress pipeline was added.

Migration is one-time and safe: valid v1 blob → normalize → IDB transaction → coordinator/theme publish → remove v1. An injected IDB failure returns and retains v1; the next load retries. Studio profile management now includes versioned JSON Export/Import with validation/normalization, replacement confirmation, and subtitle-flag rollback on failed import. Every save logs UTF-8 row sizes; dev warns above 256 KiB total / 64 KiB record.

**Automated:** `test-user-prefs-storage.mjs` **12/12** · `npm run build` **PASS** · `npm run compile` only 2 pre-existing subtitle diagnostics.

**Real-browser QA (2026-07-13, Chrome, `.output/chrome-mv3-dev/`):** **PASS · blockers none.** Fresh install, real + planted v1 upgrade, profile/style CRUD, cross-context hot-swap, Reddit cold-load relay + capture smoke, Export/Import happy + reject, DevTools per-entity rows, size telemetry, product smoke all ■. §3 migration force-fail ▲ PARTIAL accepted (fallback path + Node inject; full browser force-fail impractical). §14 skipped (H8 already closed). Evidence under `.ignore/QA-5.11.0/`. **No post-QA code fixes.**

**Accepted follow-ups (not merge gates):** optional Import merge/union mode → [`docs/future-ideas.md`](docs/future-ideas.md).

**Architecture:** map **v3.1** · extension-points **v1.15** · backlog **v2.13** · ADRs 0001–0006.

**Shipped 2026-07-13:** merged to `main` (`--no-ff` merge `853d3d8`) + annotated tag **v5.11.0**; release notes [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md). Push of `main` + tag user-owned (deferred). **Next:** scope **v6.0**; optional `/docs-archiving` Refresh #4 once `claude-progress.md` grows.

## H13 + H14/BUG-038 hardening — **MERGED to main (2026-07-12) · no version bump**

**Branch:** `feature/h13-persist-before-stamp` (from tagged `v5.10.0`) → **`main`**.
**Scope:** architecture hardening only — **not a release**; package remains **5.10.0**.

### H13 — persist-before-stamp (**RESOLVED · browser QA PASS**)

`saveLastBaseMp4` / `saveLastBakedMp4` / `saveLastRecording` **throw** on unpersistable size (bounds exported: `LAST_BASE_MP4_*`, `LAST_BAKED_MP4_*`, `LAST_RECORDING_*`) and **propagate IDB failures**, and return **authoritative persisted meta** (`savedAt`/`byteLength`/`mimeType`/`durationSeconds`; non-finite duration → 0). Four mutation choke points stamp/signal **only** from that meta:

- `background.ts` — both save handlers (failed save → honest `ok:false`, no stamp, no `LAST_RECORDING_READY`) + `persistOrphanStudioTranscodeResult`
- `subtitle-bake.ts` — `BAKED_MP4_READY_KEY` + take promotion from returned meta (`TakeBakeResult.savedAt` → `updateFromBake`)
- `voice-reapply.ts` — both commit stamps from returned metas
- `trim-apply.ts` — base stamp from meta; raw-leg **save** failure demotes to honest v5.9 stamp-drop (I19 IDB half) and never fails the trim

H6 reads untouched. Bonus: fixed pre-existing `background.ts` TS2345 on orphan path (`tsc` 3 → 2).

**Node:** `test-artifact-store-writes.mjs` **28/28**.

### H14 / BUG-038 — tab-close transcript (**RESOLVED · browser QA PASS**)

Exposed by H13 QA item 7: Vosk/`Transcribe job finished` succeeded, but the initiating page owned COMPLETE → IDB save + timeout, so closing the tab dropped both the real transcript and the scaffold. Fix:

- Background retains accepted-job terminal context (duration/language) + **125 s** watchdog
- `prepareTranscribeCompletionForPersistence` normalizes success / timeout / inference scaffolds off the page
- Persist to `rvnSessionTranscript` **before** `SESSION_TRANSCRIPT_READY_KEY`; cancelled/superseded/late jobs cannot publish
- Studio pagehide **detaches** while STT pending (no accidental CANCEL); page-local guard 135 s so it cannot race the background owner
- `saveSessionTranscript` rethrows IDB failures (no ready after failed write)
- **No Retry UI** — Vosk was healthy; retry would mask the missing terminal owner

**Node:** `test-transcribe-failure.mjs` **12/12**. **Real-browser:** user confirmed transcript survives tab close mid-processing (cases that previously failed).

### Docs at merge

Map **v2.11** · extension-points **v1.12** · backlog **v2.9** · bug-archive BUG-038 verification closed · design-studio / transcription-architecture carry-forwards refreshed.

### Other open work

1. **✅ Done: v5.11.0 merged to `main` + tagged** (`feature/v5.11.0-prefs-storage-refactor` → merge `853d3d8`, annotated tag `v5.11.0`, 2026-07-13) — release notes [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md); push deferred (item 3).
2. Then scope **v6.0 “Polish & Visual Maturity”** ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9).
3. Optional: user **push** of `main` (and any remote tags still deferred from v5.10 / v5.11).

## H8 recovery voice provenance — **RESOLVED + browser QA PASS · no version bump**

**Branch:** landed on `feature/v5.11.0-prefs-storage-refactor` (from `ad534df` / H8 work). Product package stayed **5.10.0** until the prefs bump to **5.11.0**.

### Consultation / repro notes (user QA)

- **Normal Stop → finish / tab-close while job lives:** voice is bound at **Stop**; orphan persist finishes that job. Switching profiles mid-flight does **not** retarget it. **Not H8.**
- **H8 path (pre-fix defect):** first job **dies incomplete** (hard extension reload / crash) → draft + `baseRecording`, no `baseMp4`, `inflight === false` → recovery started a **new** transcode with **`prefs.voiceEffect` at resume**.
- **Pre-fix user repro:** hard-reload mid-transcode → edit `rvnUserPrefs` / `voiceEffect` in DevTools → reopen Design Studio → recovered MP4 used the **new** (wrong) voice.
- **Post-fix browser QA PASS (user):** same A→B hard-reload path after the fix → recovered MP4 keeps **capture-time** voice even when resume-time prefs were edited or **completely nuked**. **Fully closed — no re-run for v5.11** (prefs IDB migration is orthogonal to take-owned `captureVoiceIntent`).

### Implementation

`CurrentTake.captureVoiceIntent` is an optional, JSON-safe additive field with normalized voice config + `voiceEffectUserIntentKey`; TakeManager parses it as an opaque object and remains dependency-free. Recorder writes it in the initial `beginTake`, then refreshes it in an **awaited atomic processing patch before transcode** and passes that exact config to the first job. Recovery prefers the take-owned config, promotes capture-origin `TakeVoiceStamp` (including FFmpeg fallback) with `ready`, and loads current prefs only for legacy drafts. The ready deck now surfaces the legacy fallback note.

No Retry UI, multi-take history, rendered-audio blob, new store/key/message/context, H10 work, or v6 polish.

### Verification / carry-forward

- `node scripts/test-take-manager.mjs`: **37/37** (capture intent parse/malformed/merge)
- `node scripts/test-take-deck.mjs`: **13/13** (legacy ready note visible)
- `npm run build`: **PASS**
- `npx tsc --noEmit`: only **2 pre-existing** subtitle errors; no H8 error
- **Browser QA PASS (user):** capture A → hard reload mid-transcode → set/nuke prefs B → reopen → recovered MP4 sounds like A
- Architecture: map **v3.0** · extension points **v1.14** · backlog **v2.12**

### Architecture hardening — v5.9→v5.10 incremental refresh (2026-07-12) — **DONE** (superseded by H13/H14 merge above)

Use [`TODO.md`](TODO.md) as the compact task ledger. H8 fully closed; v5.11 prefs shipped (tagged `v5.11.0`, push deferred) — next, scope v6.0.

## v6.0 "Polish & Visual Maturity" — **Track B OPEN · A + C merged**

Active branch: `feature/v6.0.0-background-panel-refactor` (fast-forwarded to `main@2b42db5`, 2026-07-20). Roadmaps + ADRs from `.ignore/prep-v6.0.0/` via `/architecture-hardening`.

- **Roadmap A — audio-reactive visuals:** [`docs/v6.0.0-custom-styles-refactor.md`](docs/v6.0.0-custom-styles-refactor.md) · 6 spectra · 7 atmospheres · 7 stackables · Style Control Center · governor · **live confidence QA PASS** (Pass E) · **merged**.
- **Roadmap C — popup UI refresh:** [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md) · Cividis popup skin + elevated restart caution · **agent QA gate PASS · merged**.
- **Roadmap B — background layout:** [`docs/v6.0.0-background-panel-refactor.md`](docs/v6.0.0-background-panel-refactor.md) · ADR-0008 **Accepted** · **OPEN** · **Phase 0–7 DONE · operator Phase 1–6 + real size/parity/a11y baseline PASS** · final presentation/product closeout.

**QA workspace:** [`qa/QA-6.0.0/`](qa/QA-6.0.0/) · ledger [`TODO-6.0.0.md`](qa/QA-6.0.0/TODO-6.0.0.md) · [`progress-QA-6.0.0.md`](qa/QA-6.0.0/progress-QA-6.0.0.md) · Track B [`track-b/`](qa/QA-6.0.0/track-b/).

**Pivotal:** bars/background/effects paint at **record time**; bake only burns subtitles (I3). Track B is Design-phase layout for the *next* recording (I1) — not post-capture re-composite. Package remains **5.11.0** until an explicit v6 ship. **Accepted residual (A):** Conway long-horizon corner parking (documented in `conway.ts`; not a merge blocker).

### Track B Phase 0 + Phase 1 — layout core + hero direct drag (**DONE · operator Phase 1 QA PASS 2026-07-20**)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **HEAD commits:** Phase 0 `08a2de5` · Phase 1 `1e3118f`

- **Phase 0 (`layout-core`):** extended `UserBackgroundLayout` (`customPosition`, `manualScale`, field `dim`, blur/blend/GIF hooks); full `normalizeUserBackgroundLayout` guards; nested prefs + discrete migration; `computeImageDrawOffset` custom path; draw path uses layout fields; `test-background-layout.mjs` **10/10**. Acceptance: zero intentional panel redesign.
- **Phase 1 (`direct-drag`):** hero live-preview pan/focal drag via `background-direct-manipulation.ts`; RAF + debounced persist; overlay affordances; `test-background-direct-manipulation.mjs` **6/6**. **Side background submenu still legacy 9-grid** — by design until Phase 2+.
- **Operator QA:** Phase 1 confirmed — drag works on the Design Studio main live preview only; panel not remodeled yet.
- **Automated re-check (docs sprint):** layout **10/10** · direct-manip **6/6** · `npm run build` **PASS**.

**Prior init (same day):** branch FF `98c37ab` → `main@2b42db5`; track-b QA scaffold; ADR-0008 Accepted.

**Next:** superseded by the Phase 2 entry below.

### Track B Phase 2 — precision widget + bidirectional sync (**DONE · operator behavior PASS 2026-07-20**)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `b129713`

- Reused the Background subpanel's existing compact `renderThemePreview` frame as the precision widget, adding a DOM-only focal overlay that never enters captured/exported pixels.
- Generalized the Phase 1 direct-manipulation controller by selector/options so hero and mini frame share crop-aware drag math, RAF coalescing, ImageDB dimensions, and debounced persistence.
- Added live X/Y readouts and explicit ±0.01 / ±0.05 controls. Nudges clamp through `normalizeUserBackgroundLayout`; hero drag updates widget values, while mini drag/nudges update hero, active audition, and prefs.
- Studio saves now flush both positioning surfaces before profile/style snapshots. No new context, message, store, signal, dependency, compositing layer, or `USER_PREFS_VERSION` bump; I1/I3 remain unchanged.
- **Automated:** layout **10/10** · direct-manip **6/6** · precision **5/5** · prefs storage **12/12** · production build **PASS** · compile only the same two pre-existing subtitle diagnostics.

**Operator:** user confirmed the Fine position UI and its behavior work correctly. Phase 3 subsequently reorganized those controls, so the new spatial console presentation remains an operator smoke item.

**Next:** superseded by the Phase 3 entry below.

### Track B Phase 3 — spatial positioning console + zoom/snap/safe/history (**DONE · operator QA PASS 2026-07-20**)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `844a81f`

- Reorganized Fine position around the embedded mini-preview: X below, Y at right, single directional chevrons for ±0.01, new doubled chevrons for ±0.05, and horizontal/vertical physical sliders using the existing track/tab design.
- Added domain-neutral logarithmic scale, sticky hysteresis, per-axis snap, clamp, and caption-band constraint math in `interaction-utils.ts`; Ctrl/Cmd+wheel zoom remains cursor-anchored and uses the same mapping as the visible zoom slider.
- Added DOM-only center/thirds/edge guides, active snap lines, Shift bypass, Snap/Guides toggles, and exact preview-caption safe-band avoidance. These overlays never enter record/capture pixels.
- Added a host-owned bounded 20-snapshot background layout undo/redo stack, isolated from subtitle history and snapshotting gestures instead of RAF frames.
- No new context, message, store, signal, dependency, compositing layer, preference version, or bake renderer. Existing ADR-0008 owns the seam; map/extension-point MINOR bumps remain deferred to Track B merge.
- **Automated:** focused layout/interaction/UI set **54/54** · production build **PASS** · compile only the same two pre-existing subtitle diagnostics · `git diff --check` PASS.

**Operator:** user confirmed the redesigned console and Phase 3 behaviors pass; final upward Y-button order is `.01` then `.05` and is regression-tested. Superseded by Phase 4 below.

### Track B Phase 4 — bundled presets + non-destructive live audition (**DONE · operator QA PASS 2026-07-20**)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `1166d51`

- Four Aurora/Warm Glow image-layout recipes render as a Cividis contact sheet. Hover/focus auditions the real hero, mini frame, and open recorder without saving; leaving restores the committed image/layout; explicit Apply persists once.
- Included `bg-…` references resolve directly from packaged SVGs, appear in the existing background selector, and are protected from ImageDB deletion/quota reconciliation. Presets preserve blur/blend/GIF/safe-text fields for Phase 5.
- Existing ADR-0008 and the Design-phase preview→recorder→draw seam remain authoritative; no version/store/message/signal/dependency/compositing change. Map/seam bumps remain deferred to Track B merge.
- **Automated:** focused Track B set **62/62** · production build PASS with both assets · compile only the same two pre-existing subtitle diagnostics.

**Operator:** Phase 4 passed with one recording-time accessibility caveat; Phase 5 commit `16e3dd0` restores and locks transient preset auditions before actual capture.

### Track B Phase 5 — properties/effects + eye-dropper (**IMPLEMENTED · original §6 operator PASS; follow-up recheck 2026-07-20**)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `16e3dd0`

- Added a compact dim/blur/blend treatment bay, collapsible 0.5–2× GIF speed + voice-energy response, and a permission-free preview-canvas eye-dropper that hands color to the existing Style bar/glow path.
- GIF capture uses a continuous rate-modulated clock; default 1× retains legacy phase and reduced motion freezes frame zero.
- Actual capture publishes a recording boundary before `MediaRecorder` starts. Any hover/focus recipe is restored, the preset contact sheet is disabled/marked `REC SAFE`, and audition returns only after recording ends.
- Follow-up: spatial Y keys now match their arrows; the recorder pins Studio's synchronous image/layout over delayed prefs to prevent one-frame position snap-back; the eye-dropper owns the hero surface and announces repeated unavailable samples; burn/dodge/difference and opt-in Canvas 2D Holo drift were added inside the same personal-image slot.
- **Automated:** focused Track B set **76/76** (prior 69 + holo 4 + recorder authority 3) · UI tokens PASS · visual-size gate **5/5** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- No new preference version, dependency, store, signal, message, compositing layer, or architecture seam; ADR-0008 remains authoritative and map/seam bumps stay deferred to merge.

**Eye-dropper recheck (2026-07-20):** operator passed hero + precision-mini sampling/cancellation, paired-canvas ownership, miss guidance, and drag lockout. Full write-up: [`qa/QA-6.0.0/progress-QA-6.0.0.md`](qa/QA-6.0.0/progress-QA-6.0.0.md).

**Blend plate (2026-07-20, operator PASS):** operator proved the old `theme.colors.bg` destination (~0–8% value) made blend math vision-dead. Additive normalized `blendPlateSource`/`blendPlateColor` now offer legacy void, theme tint, bar-linked, mid-gray, soft white, and full-range custom HSV/HEX. One solid paints beneath the personal image; Fit retains theme letterbox; dim stays after image/Holo. Legacy is default, so old profiles stay pixel-stable. Final visual/reload recheck passed.

**Next:** superseded by the Phase 6 entry below. Package stays 5.11.0.

### Track B Phase 6 — multi-aspect framing aids + compare (**DONE · operator PASS 2026-07-20**)

- Final Phase 5 operator residuals passed: visible plate makes all blends useful; custom plate/Holo/dim and precision-mini eye-dropper behavior work. Required blur/GIF size case is **23 MiB base / 29 MiB baked — PASS**; upper-end non-blur 28/35 MiB retained as informational.
- Added a distinctive but compact Framing aids crop lab: Native 16:9, centered 1:1, centered 9:16, independent thirds, and explicit export-stays-16:9 language. All guide/mask pixels are DOM-only over the hero canvas hole.
- Added transient Theme-only comparison through the existing image hot-swap. It does not persist or create another renderer, pauses preset audition, and restores on toggle/profile sync/recording entry.
- Recording entry now awaits the restored image/GIF decode before `MediaRecorder.start()`, closing a potential first-frame theme-only/unloaded flash.
- Follow-up: null-image comparison keeps the current resolved theme/style RAF alive; preset pointer/focus/click/Apply are hard-mutually-exclusive; defensive restore re-asserts no image; every exit uses `finishCompare` to restore exact committed media/layout. Copy now names the current look explicitly.
- **Automated:** focused Track B **84/84** · UI tokens PASS · visual-size harness **5/5** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** Accepted ADR-0008 amended; no new context/message/store/signal/preference field or version/dependency/compositing layer. Map/seam MINOR bumps remain deferred to Track B merge.
- **Deferred observation:** subtitle browser-composite/burn-in reportedly runs ~5–6× faster while Studio is minimized; non-breaking, investigate focused-window render/scheduling contention later.

**Operator:** crop geometry, thirds, Theme-only live motion/preset mutex/exact restore, and recording-safe entry PASS.

### Track B Phase 7 — responsive precision frame + keyboard/ARIA/A-B (**IMPLEMENTED · presentation recheck 2026-07-20**)

- The Fine position frame now escapes the generic 280 px thumbnail cap and resolves a bounded 16:9 width from both panel space and viewport height (820 px ceiling), with a container-aware narrow layout and modest responsive padding.
- Both focusable preview frames expose .05 arrows, Shift+.01 arrows, bounded +/- zoom, and Esc center; the focused GIF checkbox keeps native Space. Position/zoom sliders publish `aria-valuetext`, and a polite atomic status announces X/Y/zoom after committed interactions.
- One page-local **Next-take A/B** slot saves/swaps exact normalized layouts for the current personal background, clears on identity change, and pauses during recording/compare/preset audition. It adds no preference/profile/take field; captured pixels remain per-take truth under I1/I3.
- Operator carry-forward closes Theme-only, preview→record→bake parity, keyboard/scaling/reset, High Contrast, and reduced motion. **Automated:** focused Track B **88/88** · UI tokens PASS · visual-size harness 5/5 · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Next:** operator-check resized frame + Save/change/Swap + optional screen-reader listen, then checklist §12 saved-profile/identity/Classic/popup closeout. Package remains 5.11.0; map/seam bumps remain deferred to Track B merge.

### Track A Phase 0 — shared visual tokens + audio-reactive carrier (**DONE 2026-07-14; automated gate**)

- Added one seven-stop Cividis contract in `src/ui/tokens.ts` + `studio-palette.css`, guarded by `test-ui-tokens.mjs` so Track B cannot drift.
- Added `src/theme/audio-reactive/`: normalized `AudioVizFrame`, layout/parameter vocabulary, and a `kind:id` factory registry that creates stateful visuals per canvas.
- Live `WaveformRenderer` now sends clamped energy + all 32 normalized bands + its animation clock through `drawThemeBackground`; Studio preview sends the same shape from `PREVIEW_BAND_LEVELS` + existing representative energy `0.32`.
- At the Phase 0 checkpoint Bokeh/Sparkle still used unchanged formulas and the 32-bar renderer remained direct. Phase 1 below deliberately supersedes that temporary compatibility posture per user direction/ADR-0009.
- **Automated:** `test-audio-frame.mjs` **8/8** · `test-ui-tokens.mjs` **7/7** · `npm run build` **PASS** · `npm run compile` only the same 2 pre-existing subtitle diagnostics.
- **Architecture:** map **v3.2** + I22 · extension-points **v1.16** · ADR-0007 **Accepted**. No new context/message/store/signal/dependency/compositing layer.

### Track A Phase 1 — registry-native Sparkle/Bubbles + guarded settings (**DONE 2026-07-14; user browser QA PASS**)

- Added a stable visual catalog and a WeakMap-backed registry runtime that creates one isolated instance per canvas/effect, clamps long `dt`, and merges definition defaults with normalized overrides.
- Deleted the placeholder `src/theme/sparkle.ts` / `bokeh.ts` implementations. New Sparkle is an 18–64 deterministic, band-driven twinkle/mote field; public **Bubbles** is a 5–14 deterministic depth/parallax orb field plus bounded two-pass backdrop. `bokeh` remains only the serialized stability key; appearance compatibility is deliberately rejected by ADR-0009/0010.
- Extended `DesignOverrides` / `ThemeDesignEffects` with allowlisted `spectrumPreset`, `overlayPreset`, normalized `visualizerParams`, and deduplicated ≤3 `stackables`. Current Background flair UI bridges explicitly to the new ID until the Style panel lands. No new prefs version, store, message, signal, dependency, or compositing layer.
- Midnight Bubbles uses a legible ice/cyan/purple palette. Spatial partition waits for the first neighbor-querying Phase 3 preset; non-linear layout mappers wait for their Phase 2 spectrum consumer.
- **Automated:** `test-audio-frame` **9/9** · `test-design-overrides-v6` **8/8** · `test-overlay-visuals` **6/6** · `test-ui-tokens` **7/7** · production build **PASS** · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.3** / I22 · extension-points **v1.17** · ADR-0009 **Accepted**. User reports browser appearance/FPS QA PASS; real per-heavy-preset size reports remain required.

### Track A Phase 2 entry — Classic (Neon Glow) + real-artifact size gate (**DONE 2026-07-14; automated gate**)

- Removed both direct 32-bar paint loops from `waveform.ts`. Capture and Studio preview now resolve the spectrum slot through the per-canvas registry, with Classic-Neon as the default/no-change definition and safe fallback when an additive preset ID has not landed yet.
- Classic owns the v5 transfer curve, geometry, alpha, glow, alignment, live peak normalization, preview levels, and reduced-motion silhouette. Neutral controls reproduce the prior Canvas-2D operation stream; sensitivity/intensity/density/smoothing can now tune it without a parallel renderer.
- Added `npm run qa:visual-size -- --preset <id> --base <base.mp4> --baked <baked.mp4> [--json]`. It reads actual MP4 metadata through mediabunny, rejects short smoke clips, enforces base ≤25 MiB / baked ≤30 MiB, and caps duration drift at 0.1 s. Tests synchronize those numbers to the enforced stores and 120 s recording cap.
- Centralized `BUBBLES_OVERLAY_LABEL`; dropdown, summary, Midnight theme name, and registry picker metadata now say Bubbles while IDs remain stable (ADR-0010). No migration/alias renderer was added.
- **Automated:** audio-frame **9/9** · design overrides **8/8** · overlay label/caps **6/6** · Classic parity **5/5** · size contract **5/5** · Cividis **7/7** · production build **PASS** · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.4** / I22 · extension-points **v1.18** · ADR-0010 **Accepted**. No new context/message/store/signal/dependency/compositing layer.

### Track A Phase 2 — Minimal spectrum (**DONE 2026-07-14; automated gate**)

- Added registry-native `minimal`: a low-density **8–16** mark signal meter that groups the shared 32-band carrier into broad shapes, gates live peak normalization with the smoothed energy envelope so analyser noise settles, and uses one quiet anchor rail with no glow/afterimage pass.
- Default slow easing is frame-rate-aware and per-canvas; band weighting is honored. High Contrast validates the solid tip pair to at least **3:1** against the primary mark, while relaxed mode preserves the supplied pair.
- Reduced motion ignores FFT rearrangement and uses a fixed, energy-scaled silhouette. Capture and synthetic preview share the same definition; Classic remains the default/fallback. Non-linear coordinate helpers remain deferred until Radial/Central actually consumes them.
- **Automated:** Minimal **7/7** · Classic **5/5** · audio-frame/runtime **9/9** · design overrides **8/8**. Build PASS; compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.5** / I22 · extension-points **v1.19**. ADR-0007 already owns this integration; no new ADR/context/message/store/signal/dependency/compositing layer.

### Track A Phase 2 — Phosphor spectrum (**DONE 2026-07-14; automated gate**)

- Added registry-native `phosphor`: an opinionated segmented CRT meter whose density resolves to **12–24 columns × 6–10 rows**, capped at **240 physical cells**. A stable unlit matrix, lit tint blocks, fake highlight/shadow bevels, bounded RGB offsets, and one scanline per row create the analog instrument identity without random pixel noise.
- Per-canvas state uses a fast attack and slower user-tunable decay. Live peak normalization is multiplied by the smoothed energy envelope so analyser-floor noise does not keep cells lit; band weighting and top/center/bottom alignment use the shared spectrum environment.
- High Contrast removes RGB/scanline haze and doubles the bevel edge. Reduced motion also suppresses chromatic movement and replaces FFT rearrangement with a fixed energy-scaled silhouette. Preview and capture share the same renderer; all work stays in the record-time Canvas-2D path.
- **Automated:** Phosphor **7/7** · focused v6 regression set **54/54**. Build PASS; compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.6** / I22 · extension-points **v1.20**. ADR-0007 already owns the spectrum seam; no new ADR/context/message/store/signal/dependency/compositing layer or speculative non-linear helper.

### Track A Phase 2 — Radial Spectrum + consumed polar helpers (**DONE 2026-07-14; automated gate**)

- Added registry-native `radial-spectrum`: density resolves to an even **24–64 segments**, mapping a full 32-band semicircle into an exact mirrored ring. Palette-cycled spokes, endpoint beads, a stable inner rail, and one bounded outer contour make it read as a circular spectrum rather than a generic sunburst.
- `layout.ts` now owns the first actually consumed non-linear primitives: guarded polar→Cartesian conversion and wrapped, evenly spaced ring-segment mapping. Radial uses the helpers for inner, outer, and trail geometry; centered/flow-field helpers remain deferred to Central Pulse.
- Live peak normalization is energy-gated; band weighting is prominent; smoothing is frame-rate-aware. Optional afterimage uses a deterministic second envelope with bounded decay instead of retained canvas pixels. High Contrast removes soft glow/trails and thickens structure. Reduced motion ignores FFT rearrangement and suppresses glow/trails with a fixed energy-scaled silhouette.
- **Automated:** Radial/helpers **8/8** · focused v6 regression set **62/62** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.7** / I22 · extension-points **v1.21**. ADR-0007 already owns the spectrum seam; no new ADR/context/message/store/signal/dependency/compositing layer.

### Track A Phase 2 — Central Pulse + consumed centered/flow-field helpers (**DONE 2026-07-14; automated gate**)

- Added registry-native `central-pulse`: a continuous organic orb rather than a radial-bar variant. Density resolves to an even **36–72 point** contour; optional afterimage uses at most **three stateful echo envelopes**, hard-capping total contour work at **288 elements** without retaining canvas pixels.
- `layout.ts` now owns guarded alignment-aware centered origins and contour-point mapping. New `simulation/flow-field.ts` owns the deterministic, allocation-free layered 2D sampler Central consumes; spatial partition, reactive agents, and neighbor-query abstractions remain deferred until Phase 3 needs them.
- Weighted whole-spectrum energy drives body scale while energy-gated spectral detail suppresses analyser-floor shimmer. The contextual smoothing control becomes **Pulse Speed**; frame-rate-aware attack/release, a palette radial body, and a stable core give the effect its pulse identity. High Contrast removes gradient/glow/echo passes and strengthens the outline. Reduced motion fixes time/field complexity and ignores FFT rearrangement.
- **Automated:** Central/helpers **9/9** · focused v6 regression set **71/71** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.8** / I22 · extension-points **v1.22**. ADR-0007 already owns the spectrum seam; no new ADR/context/message/store/signal/dependency/compositing layer.

### Track A Phase 2 — Oscilloscope + waveform-on-demand (**DONE 2026-07-14; automated gate**)

- Added registry-native `oscilloscope`, completing the six core spectra. Static `AudioVisualDefinition.wants` metadata is now the single source of optional input demand: only Oscilloscope declares waveform, so live capture calls `getByteTimeDomainData` and synthetic preview generates a representative time-domain signal only for that definition.
- Each analyser snapshot is rising-zero-crossing triggered and downsampled to an even **96–160 points**. Afterimage uses a preallocated **six-slot ring** capped at **960 path elements**; it stores neither canvas pixels nor full analyser buffers, and clears across long render gaps so a hot-swap cannot replay stale voice traces.
- Linear and circular layouts share a scope graticule, palette trail/glow, top/center/bottom alignment, Gain/Smoothing/Persistence/timebase behavior, and stable capture↔preview paths. High Contrast removes glow/history and strengthens the line. Reduced motion ignores waveform order/time and renders a fixed energy-scaled standing wave.
- **Automated:** Oscilloscope/lazy waveform **10/10** · focused v6 regression set **81/81** · production build PASS · built recorder + Studio shared chunks contain Oscilloscope. Compile reports only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.9** / I22 · extension-points **v1.23**. ADR-0007 already owns the lazy optional-input seam; no new ADR/context/message/store/signal/dependency/compositing layer.

### Track A Phase 3 — simulation backbone + Forest Spirits (**DONE 2026-07-14; automated gate**)

- Added only the simulation primitives the first agent overlay consumes: exact-radius `SpatialPartition<T>` with the roadmap's 48 px default and caller-reused result buffers; a maximum-preallocated active-prefix `ReactiveAgentPool`; a thin `AudioReactiveSimulation` owner for pool/grid lifecycle; and a normalized curl-vector sampler extending Central's deterministic scalar field. No stackable, scene-graph, emitter, or governor abstraction landed early.
- Added registry-native `forest-spirits`: three balanced 6–16-node will-o'-wisp chains (**18–48 pooled agents**) whose leaders ride coherent vector flow while followers use spring/lag, local grid separation, and audio-weighted undulation. Audio onsets fracture selected filaments; a bounded decay knits them back together. The normal renderer uses curved palette filaments, restrained additive light, seeded spirit motes, and crowned leaders; High Contrast removes the soft pass and reduced motion freezes both agents and filament phase.
- Overlay render environments now carry only capture-vs-synthetic-preview and reduced-motion state. Forest's Studio-only tide is explicitly representative; capture remains band/energy driven. The Studio reduced-motion gate now redraws every animated overlay at time zero, fixing the prior GIF-only freeze branch. Work remains record-time Canvas 2D; no bake re-render, retained pixels, new input, message, store, signal, dependency, or compositing layer.
- Hard ceiling: **≤48 live agents / ≤192 render elements**. Forest state is fixed-size, spatial queries avoid all-pairs scans, long registry deltas remain clamped, and the built recorder + Studio bundles both contain the preset.
- **Automated:** Forest/backbone **11/11** · focused v6 regression set **92/92** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.10** / I22 · extension-points **v1.24** (audio-reactive v9). ADR-0007 already owns the simulation layer and the cost model stayed non-structural, so no new ADR/context/message/store/signal/dependency/compositing layer.

### Track A Phase 3 — Digital Rain + consumed activation grid (**DONE 2026-07-14; automated gate**)

- Added only the lattice primitive Digital Rain consumes: `BoundedActivationGrid` preallocates two typed-array buffers, hard-clamps generic capacity to **64×64 / 4,096 cells**, changes active topology without reallocating, max-blends bounded activations, and advances local directional generations through retain/forward/diagonal-spread/threshold rules. It is not a general Conway/scene-graph/emitter API.
- Added registry-native `digital-rain`: density resolves to **14×9–32×18**, hard-capping the overlay at **576 glyphs + one axis accent (577 elements)**. One logical grid becomes vertical codefall (`linear`), horizontal streams (`centered`), or outward radial spokes (`radial`), with a diverse deterministic numeral/Latin/Katakana/symbol alphabet, palette heads/trails, audio-weighted source gates, and immediate transient-only interior forks.
- Studio preview adds a deterministic tide over the same grid; capture silence remains quiet and live bands/energy drive the source edge. High Contrast removes glow and strengthens the axis; reduced motion renders a fixed audio-scaled glyph field independent of time. State remains per-canvas, fixed-allocation, Canvas 2D, and capture-time only.
- Two transient defects found by the focused gate were fixed in-sprint: forks now seed deterministic interior cells instead of collapsing onto an occupied edge, and one-frame onset hints inject immediately rather than waiting for the next fixed grid step.
- **Automated:** Digital Rain/grid **12/12** · focused v6 regression set **104/104** · production build PASS · compile only the same two pre-existing subtitle diagnostics. Built recorder + Studio bundles contain Digital Rain.
- **Architecture:** map **v3.11** / I22 · extension-points **v1.25** (audio-reactive v10). ADR-0007 already owns the simulation/overlay seam; no new ADR/context/message/store/signal/dependency/compositing layer.

### Track A Phase 3 — Inferno / Void Inferno + consumed bounded emitter (**DONE 2026-07-14; automated gate**)

- Added only the lifetime primitive Inferno consumes: `BoundedParticleEmitter<T>` preallocates a fixed object set, hard-clamps generic capacity at **256**, supports a smaller live slot limit, expires lifetimes, and deterministically reuses slots. It owns no physics, drawing, stackable, scene-graph, or governor policy.
- Added registry-native `inferno`: density resolves to **28–72 particles**, hard-capping output at **219 paint elements**. Linear is a floor-wide hearth, centered is a bonfire, and radial is a corona. Bass/energy shape heat and emission; mids feed the existing caller-buffered curl field and layered smoke; treble/transients throw immediate bounded sparks. Stretched Bézier tongues cool through the supplied palette instead of reading as circles.
- The shared High Contrast control is intentionally the named **Void Inferno** variant: near-black negative-space flame bodies with hard violet/cyan/white edges and no blur. Reduced motion replaces simulation with one fixed audio-scaled flame sculpture. Capture silence stays empty; Studio preview is deterministic and gently alive.
- State is per-canvas, fixed-allocation, Canvas 2D, and record-time only. The production recorder and Studio both consume the shared bundle containing Inferno. No new input, preference field, message, store, signal, dependency, compositing layer, or bake renderer.
- **Automated:** Inferno/emitter **11/11** · focused v6 regression set **115/115** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.12** / I22 · extension-points **v1.26** (audio-reactive v11). ADR-0007 already owns the simulation/overlay seam and the lifetime pool stayed non-structural, so no new ADR.

**Immediate next actions:** continue Phase 3 with Aurora; reuse the existing flow field and bounded emitter, adding only ribbon state/geometry Aurora immediately consumes.

### Track A Phase 3 — Aurora flow-field ribbons (**DONE 2026-07-14; automated gate**)

- Added registry-native `aurora` without another shared framework: the existing `BoundedParticleEmitter` owns lifetimes/slot reuse, the existing caller-buffered flow field owns coherent motion, and Aurora keeps its immediately consumed ribbon state/geometry local to the preset.
- Density resolves to **100–200 preallocated ribbon shards**, hard-capping output at **403 paint elements**. Linear emits from 32 audio-shaped bar tops, centered emits from opposing side spectra, and radial emits from a circular spectrum rim. Bass gives the curtain body/lift, mids steer flow, and treble/transients sharpen luminous folds.
- Each particle paints a tapered Bézier veil plus a bright fold filament, building layered curtains rather than dots. Band weights alter source height/radius and trajectory, capture silence stays empty, and Studio preview uses a deterministic slow tide. High Contrast removes blur and switches to crisp cyan/green/white structure; reduced motion is a fixed audio-scaled curtain sculpture.
- State remains per-canvas, fixed-allocation, Canvas 2D, and record-time only. No new preference field, message, store, signal, dependency, compositing layer, bake renderer, scene graph, stackable interface, or generalized ribbon API.
- **Automated:** Aurora **10/10** · focused v6 regression set **125/125** · production build PASS · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.13** / I22 · extension-points **v1.27** (audio-reactive v12). ADR-0007 already owns the simulation/overlay seam; no new ADR.

**Immediate next actions:** continue Phase 3 with Glitch; add only the bounded transient-responsive scanline, RGB-split, and chunk-tear state it directly consumes.

### Track A Phase 3 — Glitch signal corruption (**DONE 2026-07-14; automated gate**)

- Added registry-native `glitch` with no new shared simulation framework. Density resolves to **12–36 stable scanlines** and burst state is a fixed **10-slot tear pool**, hard-capping the complete overlay at **81 paint/copy elements**.
- Voice energy sustains restrained chromatic ghosting; explicit `AudioVizFrame.transient` hints and preset-local positive spectral flux trigger short-lived chunk displacement. Each active tear copies one bounded source rectangle and adds magenta/cyan registration fringes plus a palette seam. Band weighting changes displacement strength, not only color.
- Linear mode is horizontal VHS-like tearing, centered mode corrupts opposing half-frame slabs, and radial mode scatters tangential blocks through concentric interference rings. Capture silence retains only a stable low-entropy scan texture; Studio preview demonstrates deterministic bursts on a bounded cadence.
- High Contrast removes filtered RGB ghosts and uses hard source-over fringes. Reduced motion performs no canvas self-copy and paints a fixed audio-scaled scan/sync sculpture; the focused gate caught and fixed synthetic preview tide leaking into that time-independent mode.
- State remains per-canvas, fixed-size, Canvas 2D, and record-time only. No new preference field, optional input, message, store, signal, dependency, compositing layer, bake renderer, scene graph, generalized glitch framework, or ADR.
- **Automated:** Glitch **12/12** · focused v6 regression set **137/137** · production build PASS · recorder + Studio bundles contain Glitch · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.14** / I22 · extension-points **v1.28** (audio-reactive v13). ADR-0007 already owns the overlay seam; no new ADR.

**Immediate next actions:** continue Phase 3 with Rising Ember, adding only the minimal ordered stackable contract and bounded ember state its first consumer requires.

### Track A Phase 3 — Rising Ember + first ordered stackable (**DONE 2026-07-14; automated gate**)

- Added the minimal `StackableEffect` contract and definition registry: saved IDs render after the primary overlay and before the spectrum in normalized preference order, deduplicate defensively, stop at three, retain isolated per-canvas state, and sum each instance's bounded `getPerformanceCost()`. No scene graph, arbitrary chain, auto-governor, or new visual layer.
- Added Rising Ember as the only registered stackable. Density resolves to **16–44 fixed-pool lifetime particles**, each capped at a trail, halo, and hot-core pass (**≤132 elements**). Linear rises from a wide hearth, centered forms a narrow plume, and radial emits an outward cinder corona.
- Energy and weighted bass/mids/treble shape ignition, weave, lift, and flight; explicit transients immediately add a bounded cinder fan. Capture silence stays empty, synthetic preview remains gently deterministic, High Contrast removes additive glow, and reduced motion paints a time-independent low-cost constellation.
- Reused the existing lifetime-only `BoundedParticleEmitter`; all Ember physics, spawn geometry, and drawing remain consumer-local. The existing `DesignOverrides.stackables` contract needed no migration, preference version, message, store, signal, dependency, bake renderer, or UI expansion.
- **Automated:** Rising Ember/stackable **12/12** · focused v6 regression set **149/149** · production build PASS · recorder + Studio shared bundles contain Rising Ember · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.15** / I22 · extension-points **v1.29** (audio-reactive v14). ADR-0007 already owns ordered stackables in the record-time overlay slot; no new ADR.

### Track A Phase 3 — Electric Arc corona + sustained Lightning (**DONE 2026-07-14; automated gate**)

- Split the roadmap's electricity concept into two independently selectable stackables. **Electric Arc** (`electric-arc`) is a corona-discharge family: density resolves to **6–18 preallocated streamers** rooted on **3–6 visible conductors**, with short ionization paths and at most eight bounded forks (**≤300 logical segment/contact passes**). **Lightning** retains the existing `lightning` ID and sustains one **14–30-point connected plasma channel between two contacts**, slowly reroutes the live channel, and caps secondary branching at five (**≤158 elements**).
- Linear, centered, and radial layouts produce floor-electrode/facing-contact/ring-corona arrangements for Electric Arc and diagonal/horizontal/center-to-rim contact strikes for Lightning. Mids shape channel instability, treble controls forks/branches, bass/energy shape current and halo, and explicit transients immediately lengthen corona streamers or surge/rebranch the conducting channel.
- Capture silence stays empty; synthetic preview demonstrates both families deterministically. High Contrast removes additive blur, and reduced motion replaces temporal rerouting with fixed electrical sculptures. All path/contact/branch buffers are maximum-preallocated and local to `stackables/electricity.ts`; no generalized arc graph/path solver landed.
- The existing ordered runtime composes Rising Ember + Electric Arc + Lightning as a real capped three-stack. `electric-arc` is an additive normalized catalog key; no migration, preference version, UI field, message, store, signal, dependency, compositing layer, bake renderer, or scene graph was added.
- **Automated:** Electric Arc/Lightning **13/13** · focused v6 regression set **162/162** · production build PASS · recorder + Studio shared bundles contain both labels · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.16** / I22 · extension-points **v1.30** (audio-reactive v15). ADR-0007 already owns ordered record-time stackables; the two local consumers create no new structural decision or ADR.

### Track A Phase 3 — Conway Life + bounded binary lattice (**DONE 2026-07-14; automated gate**)

- Added only the cellular primitive Conway consumes: `BoundedLifeGrid` is a fixed-allocation, double-buffered binary lattice capped at **64×64 / 4,096 cells**, with immutable topology, dead edges, direct cell reads/writes, neighbor counts, and exactly one B3/S23 generation step. It does not add resizing, toroidal topology, arbitrary rules, multistate cells, events, or a general CA framework; Digital Rain keeps its separate directional activation contract.
- Added `Conway Life` (`conway`) as a registered ordered stackable on a fixed **48×16** logical field. Audio deterministically stamps gliders, R-pentominoes, acorns, and oscillators; generations advance on a smoothing-controlled **80–220 ms** cadence with at most two steps per render, while explicit transients stamp organisms immediately. Density controls seeding richness rather than reallocating topology.
- Linear paints a full living circuit tapestry, centered creates an inset terrarium, and radial projects the same dead-edge colony into rings. Each live cell is one glowing rectangle plus one shared boundary accent, hard-capping paint at **769 elements**. Capture silence starts empty; synthetic preview is deterministic; weighted frequency families affect seed selection/population.
- High Contrast removes additive blur and strengthens hard structure. Reduced motion bypasses temporal generations and paints a fixed, time-independent audio constellation. State stays per-canvas, typed-array-backed, Canvas 2D, and record-time only.
- The existing ordered runtime composes Conway in a real Ember + Electric Arc + Conway three-stack. No new preference field/version, UI, message, store, signal, dependency, compositing layer, bake renderer, scene graph, auto-governor, migration, or ADR.
- **Automated:** Conway/grid **15/15** · Rising Ember **12/12** · electricity **13/13** · Digital Rain **12/12** · focused v6 regression set **177/177** · production build PASS · recorder + Studio shared bundles contain Conway Life · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.17** / I22 · extension-points **v1.31** (audio-reactive v16). ADR-0007 already owns ordered record-time stackables; the consumed lattice does not create a new structural decision.

**Immediate next actions:** continue Phase 3 with Layered Smoke, adding only the bounded plume contract that consumer requires.

### Track A Phase 3 — Layered Smoke + bounded plume history (**DONE 2026-07-14; automated gate**)

- Added only the plume history primitive the effect consumes: `BoundedPlumeField<T>` preallocates fixed per-plume rings, hard-clamps the generic shape at **16×16 / 256 nodes**, varies a live plume ceiling, appends/recycles within one plume, reads newest-first, expires by age, and clears without reallocating. It owns no airflow, pressure, fluid cells, solver, geometry, renderer, or stackable policy.
- Added `Layered Smoke` (`smoke`) as a registered ordered stackable using **4–10 plumes × 9 fixed nodes**. Each node paints three translucent strata and each plume at most one connective spine, hard-capping work at **280 paint elements**. The result is rolling volume and coherent wisps rather than recolored point particles.
- Bass/energy shape buoyancy and volume, mids drive curl/shear, treble influences diffusion/lifetime, and explicit transients immediately shed alternating bounded wisps. Linear is a floor-wide smoke bank, centered a chimney column, and radial an outward mist wreath.
- Capture silence stays empty and synthetic preview is deterministic. High Contrast removes blur for crisp source-over layers; reduced motion paints a fixed time-independent audio sculpture. The runtime composes Ember + Conway + Smoke as a real ordered three-stack.
- No new preference field/version, UI, message, store, signal, dependency, compositing layer, bake renderer, scene graph, auto-governor, general fluid solver, migration, or ADR. ADR-0007 continues to own the record-time stackable seam.
- **Automated:** Layered Smoke/plume **15/15** · focused v6 regression set **192/192** · production build PASS · recorder + Studio shared bundles contain Layered Smoke · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.18** / I22 · extension-points **v1.32** (audio-reactive v17).

### Track A Phase 3 — Neon Glow bounded sign-tube atmosphere (**DONE 2026-07-14; automated gate**)

- Added `Neon Glow` (`neon-glow`) as a registered ordered stackable with no shared geometry framework. Density resolves to **3–7 continuous tubes**, each backed by exactly **18 preallocated points**; two fixed charge-knot phases per tube keep all live state in typed arrays local to the canvas instance (**≤126 geometry points / ≤49 paint passes**).
- The effect is deliberately not a second spectrum renderer: linear mode flows parallel neon rails through the frame, centered mode builds nested rounded sign contours, and radial mode builds organic orbit rings. Broad weighted bands reshape the continuous contours; energy controls glow, treble drives charge travel, and transients surge existing cores/knots without spawning geometry.
- Each tube receives an atmospheric bloom, saturated body, and white-hot core plus two halo/core charge pairs. Capture silence stays empty; synthetic preview is deterministic. High Contrast removes additive blur and retains hard outlined tube structure; reduced motion paints a fixed time-independent neon sculpture.
- The existing ordered runtime composes Ember + Smoke + Neon as a real bounded three-stack. No Classic dependency, spectrum bars, shared glow primitive, new preference field/version, UI, message, store, signal, dependency, compositing layer, bake renderer, scene graph, auto-governor, migration, or ADR. ADR-0007 continues to own the record-time seam.
- **Automated:** Neon Glow **13/13** · focused v6 regression set **205/205** · production build PASS · recorder + Studio shared bundles contain Neon Glow · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.19** / I22 · extension-points **v1.33** (audio-reactive v18).

### Track A Phase 3 — Particle Burst bounded one-shot punctuation (**DONE 2026-07-14; automated gate**)

- Added `Particle Burst` (`particle-burst`) as the final registered ordered stackable. Density resolves to **14–28 shards per bloom**; the existing lifetime emitter caps three overlapping bloom loads at **42–84 particles**, while three fixed consumer-local shock shells keep the complete effect at **≤261 paint elements**.
- The effect is onset-only rather than a second continuous ember field. Explicit `AudioVizFrame.transient` hints trigger immediately, and a preset-local positive spectral-flux fallback makes real capture react to speech attacks even though the live carrier does not yet publish onset hints. Falling/steady spectra do not false-trigger; a smoothing-scaled cooldown bounds repeated attacks.
- Linear mode throws an upward fan from the dominant-band horizon, centered mode creates a full nova, and radial mode launches an outward cone from a spectrum-selected rim contact. Every shard owns a comet trail, rotating diamond body, and hot tip; each bloom owns two expanding shock rings plus one core flash. Capture silence is empty, preview demonstrates deterministic punctuated blooms, High Contrast removes additive blur, and reduced motion is a fixed time-independent burst sculpture.
- All trigger history, shell state, origins, physics, and geometry remain consumer-local; only the existing lifetime/slot-reuse emitter is shared. No generalized event/onset/burst framework, new preference field/version, UI, message, store, signal, dependency, compositing layer, bake renderer, scene graph, auto-governor, migration, or ADR. ADR-0007 continues to own the record-time seam.
- **Automated:** Particle Burst **15/15** · Rising Ember fixture **12/12** · focused v6 regression set **220/220** · production build PASS · recorder + Studio shared bundles contain Particle Burst · compile only the same two pre-existing subtitle diagnostics.
- **Architecture:** map **v3.20** / I22 · extension-points **v1.34** (audio-reactive v19). Phase 3's complete curated visual catalog remains Medium confidence until browser visual/FPS and real heavy three-stack artifact gates land.

**Immediate next actions:** begin Phase 4 with the integrated Style Control Center and performance governor, then run the documented browser visual/size/a11y matrix.

### Track A Phase 4 — Style Control Center + shared performance governor (**IMPLEMENTED 2026-07-14; focused browser QA PASS**)

- Renamed the live `bar-style` panel/summary/guard contract to `style` and removed the dead legacy effect-control bridge. The new audio-instrument rack exposes every production spectrum, atmosphere, and accent from the same registries capture uses; CSS-native thumbnails reuse the v4 waveform icon, physical sliders, 9-slice/Cividis/indigo/amber language, and add no image payload.
- Added shared tuning, palettes, 0–2× band response, contextual geometry/afterimage, High Contrast, Classic halo, caption-safe dim, and Detail. Existing `DesignOverrides`, `applyLocalDesignOverrides`, `saveCustomStyleColors`, and normalization remain the only persistence path; no preference version/store/message/signal/dependency/compositing layer.
- Added a pure registry `maxElements` governor (Comfortable ≤560, Elevated ≤980, Guarded above). Guarded scenes suspend the most expensive selected accent in both preview/capture while retaining the saved ordered list; lowering Detail restores it. Identity hot-swaps reset per-canvas spectrum/overlay/stackable state without resetting tuning-only smoothing.
- Caption-safe dim is one bounded lower-center ellipse after record-time visuals and below post-base captions. ADR-0007 already owns the governor direction and composition, so no new ADR.
- **Automated:** new Style/governor/dim **6/6**; focused v6 total **226/226**; production MV3 build PASS; compile only the same two pre-existing subtitle diagnostics.
- **Browser fixture QA:** desktop + narrow responsive containment PASS; intended Spectrum/Atmosphere local rails scroll; signal chain stacks on mobile; max-three unlock, paused label, semantic warning transition, and keyboard Detail restoration PASS. QA found and fixed CSS Grid min-content page overflow. Browser console had no fixture-origin errors (unrelated installed-extension warnings only).
- **Architecture:** map **v3.21** / I22 · extension-points **v1.35** (audio-reactive v20). Complete live capture/FPS/a11y and 120-second heavy preset/three-stack artifact evidence before raising confidence/release readiness.

**Track A confidence close (2026-07-19/20):** Pass E full PASS — see short verdict at top of this section and [`qa/QA-6.0.0/progress-QA-6.0.0.md`](qa/QA-6.0.0/progress-QA-6.0.0.md).

### Track C — popup UI refresh (**AGENT GATE PASS · MERGED to main 2026-07-19**)

**Branch:** `feature/v6.0.0-popup-ui-refresh` (from post-Track-A `main` merge `f1653c4`) → **`main`** · **Roadmap:** [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md) · **QA:** [`qa/QA-6.0.0/track-c/`](qa/QA-6.0.0/track-c/)

- **Load-bearing discovery:** `design-studio/main.ts` imports `entrypoints/popup/style.css` as the Studio's shared control-primitive base → Track C ships a popup-only overlay (`entrypoints/popup/popup-palette.css`, `@import`s `studio-palette.css`, `.popup`-prefixed rules) with **zero edits** to the shared base; Studio isolation git-verified (empty diff vs `f1653c4` for style.css + all Studio CSS). Shared-primitives extraction deferred as a hardening candidate.
- Popup now lives on the Cividis axis: deep-indigo shell/cards/hairlines, amber-action CTA (`#d4a020` + `#1a1000` text; amber=action, violet=confirm per Studio semantics), Studio-parity toggles (amber fill + dark knob), amber focus rings, quiet charcoal bottom Reload, inline currentColor `mic.svg` brand mark, first popup-side rules for the previously unstyled `popup__summary-line*` / `popup__button--studio`. Light mode remapped to a desaturated indigo/amber family.
- **Elevated restart caution:** now a bar directly under the header (was text-only above the bottom button) with inline amber "Reload now" (`browser.runtime.reload()`); `role=status`/`aria-live=polite`; `mountRestartCaution`/`showRestartCaution` API + all four call sites unchanged.
- **Guard:** `test-ui-tokens.mjs` extended — palette `@import` + popup adoption + 7-hex banned off-axis scan. **Fixture:** `scripts/fixtures/popup-visual/` + `npm run qa:popup-visual` (port 4175).
- **Drive-by BUG FIX:** `APP_VERSION` was stale at `5.10.0` on a `5.11.0` package — bumped per the file's own contract.
- **Automated (pre-merge recheck):** tokens guard PASS · `compile` = same 2 pre-existing subtitle diagnostics · production build PASS. **Agent browser QA (fixture):** dark/light computed-style parity, caution behavior/placement, real keyboard Tab focus-ring pass — evidence `qa/QA-6.0.0/track-c/logs/computed-style-qa-2026-07-19.json`.
- **Merge gate:** checklist §1–§7 PASS · blockers none · clean ancestry off `main@f1653c4` · Studio isolation empty-diff. §8 real-extension eyeball residual **deferred** (optional post-merge; not a code/state risk). Package stays **5.11.0** until an explicit v6 ship.
- **Architecture:** extension-points **v1.36** (no new seam; base-layer constraint documented). No ADR — presentational under ADR-0007 tokens.

### 2026-07-15 — Track A QA workspace scaffold

- Nested QA project established under `qa/QA-6.0.0/` (out of `.ignore/` for lasting scope).
- Scoped ledger + progress: `TODO-6.0.0.md`, `progress-QA-6.0.0.md`; Track A checklist + `logs/` / `screenshot/` / `artifacts/`; Track B placeholder only.
- Early dumps already present under `track-a/logs/` (notes-before-bed voice re-apply note; offscreen fail/success pair) — triage inside the scoped workspace.
- Root `TODO.md` + this file now **point** at the workspace by path/name; do not append long QA session churn here.
