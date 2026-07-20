# Progress — v6.0.0 QA

**Living session file for this workspace only.**  
**TODO ledger:** [`TODO-6.0.0.md`](TODO-6.0.0.md) · **Active checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md)  
**Root pointers:** [`claude-progress.md`](../../claude-progress.md) · [`TODO.md`](../../TODO.md)

Do not dump long QA narrative into the global progress file — update a short verdict + path there when a gate closes.

---

## Context (read once)

| | |
|--|--|
| **Active branch** | `feature/v6.0.0-background-panel-refactor` · Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` · Phase 3 `844a81f` · Phase 4 `1166d51` · Phase 5 `16e3dd0` |
| **Stable baseline** | v5.11.0 package · Track A + Track C merged · push deferred |
| **Track B roadmap** | [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) §7 phases · §8 QA |
| **Track A** | Closed · confidence PASS · [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) |
| **Track C** | Closed · agent gate PASS · merged |
| **ADRs** | 0008 **Accepted** (Track B) · 0007 / 0009 / 0010 (Track A, landed) |
| **Architecture** | map **v3.21** / I22 · seams **v1.35** · Track A confidence **High** (B map bumps at merge) |
| **Key product fact** | Background + bars/overlays paint at **record time**. Bake only burns subtitles (I3). Track B is Design-phase layout for the *next* recording (I1). |

**Proven (closed tracks):**

- Track A: full catalog + Style Control Center + governor · Pass E live confidence · 226 focused Node / 57 full suites · build PASS
- Track C: popup-only Cividis skin + elevated restart caution · agent gate §1–§7 PASS · merged

**Track B in flight:** Phase 0–5 landed · operator Phase 1–5 core QA **PASS** · blend-plate/precision-sampler recheck and full merge gate still open.

**Next:** (1) operator-recheck visible blend plates + custom HSV/HEX · (2) operator-recheck eye-dropper precision mini · (3) 120 s blur+GIF gate · (4) Phase 6 · package stays 5.11.0.

---

## Session log

### 2026-07-20 — Phase 5 blend plate + precision-mini sampler implemented

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** this sprint<br>
**Trigger:** operator passed Y-key direction, sustained pre-record/record positioning, main-hero eye-dropper sampling/cancellation, added blend mechanics, and Holo; remaining visual defect was near-black blend destination.

- Added normalized `blendPlateSource` / `blendPlateColor` fields to `UserBackgroundLayout`. Missing/invalid values default to `legacy` + `#808080`; `legacy` takes the exact prior theme underlay, so existing profiles remain pixel-stable with no prefs-version bump.
- Treatment now offers Legacy void, a visible theme tint, bar-linked color, mid-gray, soft white, and Custom solid. Custom progressively reveals the existing HSV wheel/saturation/brightness/HEX chrome; exact HEX commits no longer drift through integer HSV conversion.
- `drawImageBackground` paints one solid plate immediately before the blended personal image. Fill plates the frame; Fit plates only the image rect and retains the theme letterbox. Blur/blend/Holo remain image-slot work and dim remains final. No second image, layer, store, message, dependency, WebGL path, or bake renderer.
- Eye-dropper ownership now registers both hero and precision manipulator surfaces, pairs each with its own rendered canvas, samples whichever surface receives the click, and extends crosshair/drag-lock chrome to the mini. Existing miss guidance and Esc/toggle-off/valid-sample exits are reused.
- Architecture-hardening feature check: this is an additive extension of Accepted ADR-0008. The ADR/roadmap were amended; architecture map/extension-point MINOR bumps remain deferred to Track B merge.

**Automated:** focused Track B set **82/82** (prior 76 + layout plate 2 + compositor plate 4) · UI tokens PASS · visual-size gate logic **5/5** · production build PASS · compile only the same 2 pre-existing subtitle diagnostics · `git diff --check` PASS.

**Operator recheck:** with dim 0, compare Normal vs multiply/overlay/difference on Theme tint, Mid gray, Soft white, and Custom; confirm exact custom black/white/HEX reload; confirm Holo reads against a plate; activate Sample for bars and click the precision mini (crosshair, no drag, correct Style color), including unavailable-pixel guidance and Esc.

**Next:** finish those two browser checks, run the real 120 s blur+GIF artifact gate, then Phase 6 framing aids.

### 2026-07-20 — Blend modes “do nothing” (operator visual verdict · plan only)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Code unchanged**  
**Operator:** bra-khet — human perception check, not Node math.

**Verdict (accepted as product gap, not “user error”):**

- Fill-mode plate under the personal image is `theme.colors.bg` (or custom-style `deriveBackgroundColor` ≈ **4–8% value** of the bar hue). Preset solids sit in the `#000`–`#1a…` band. On a normal display these are **indistinguishable from pure black** without zooming; a ~3% delta vs pure black is not a usable design surface.
- Operator difference test: **difference ≈ slightly dimmer source-over** ⇒ destination is near zero. That matches Canvas math (`|src − ~0| ≈ src`) and proves the blend allow-list is **mathematically live but visually inert** for human aesthetics.
- Historical intent (dark visualizer stage + legible bars) does **not** make this OK for photo×blend UX. Phase 5 shipped blend UI without a human-visible plate; result: blend “doesn’t do anything.”
- Dim→0 does not invent a midtone plate. Fit can use full `theme.background`, but many themes’ backdrops are still near-black solids; Fill never uses pretty art under the photo.

**How we make it “do something” (agreed direction — simple, no second image):**

Plate is already a **draw-time fill** (`letterboxColor` / fillRect before `drawImage` with `globalCompositeOperation`). Expose that as layout-owned prefs, same seam as dim/blur/blend:

1. **User-visible plate color** (hex or Style-linked default) — mid/light values allowed; default for *new* creative use should not be void-black.
2. Optional modes later: `theme-solid` (legacy) | `custom` | `full-theme` (draw `theme.background` under image).
3. Wire: `UserBackgroundLayout` + `normalize…` + `drawUserBackgroundLayer` / `drawImageBackground` only; preview = capture; no new layer pipeline, ImageDB asset, or prefs version bump if additive.
4. UI: treatment bay next to blend — color control + short copy: *“Blend multiplies your image onto this plate; dim darkens after.”*
5. Acceptance: difference / multiply / overlay produce **obvious** change vs source-over on a mid-gray or theme-tint plate with dim at 0; operator can make modes “read” without DevTools zoom.

**Out of scope for first pass:** dual-image FG/BG, Photoshop layer stack, changing global Classic-with-no-photo bar stage (keep legacy dark when no personal image / source-over Fill if needed for byte stability).

**Priority:** Phase 5 residual — **before** treating blend QA as closed. Track with eye-dropper mini fix as treatment-bay follow-ups.

### 2026-07-20 — Eye-dropper incomplete fix investigation (docs only)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Code unchanged this sprint**  
**Trigger:** operator recheck — main live preview samples correctly after follow-up; Background subpanel precision mini still cannot pick a color (drag correctly locked out).

**Root cause (incomplete ownership surface):**

| Path | What the follow-up did | Effect |
|------|------------------------|--------|
| `onColorSamplingChange` → `setInteractionBlocked` | Suspends **both** hero + precision direct-manipulation controllers | Drag/pan/zoom correctly disabled on main hero **and** small position preview |
| `getEyeDropperSurface` / `getEyeDropperCanvas` | Only the **main** `.studio__hero` manipulator + live canvas | Capture-phase `pointerdown` sample listener attaches **only** there |
| CSS `.studio__background-layout--sampling` | Crosshair + amber outline only on `.studio__hero …` | Mini frame shows no sampling chrome |

So the fix solved “drag eats the sample click” on the **hero**, but never registered the precision surface (`[data-background-precision-manipulator]` + canvas `data-preview-kind="background-precision"`). Clicks on the mini do nothing useful: no sample, no status update (unless the click somehow hit the hero listener, which it does not).

**Mirror fix (next product sprint, not done here):** attach sampling to **both** surfaces; on each `pointerdown`, resolve the canvas under the click (hero live vs precision) and run `sampleCanvasColorAtClient` against **that** bitmap (client→pixel mapping is per-canvas `getBoundingClientRect`). Extend sampling CSS to the precision manipulator. Reuse existing miss/Esc/toggle-off exit. No new prefs/store.

**What the sampled color is for (product purpose):**

- **Not** a preview-only contrast swatch and **not** a background recolor.
- Hand-off: `onSampleColor(hex)` → `DesignOverrides.barColor` + derived `glowColor` (+ string `visualizerParams.color` when that mode is active) via the same Style color path as the HSV picker.
- **Record-time impact:** audio-reactive **bars/glow** are painted into the canvas at capture (I3). The next recording therefore carries that bar color into the **base video**. Bake still only burns subtitles — the color is not a post-bake overlay.
- Layout / personal image / dim-blur-blend are **untouched** by sampling.
- UI already labels the control “Sample for bars” and status “Pick a clear background pixel to color the bars.” Optional later polish: one line that the color applies to **recorded** bars, not just the live preview (progress note only for now).

**Files of record:** `background-layout-controls.ts` (`beginColorSampling` / `onCanvasSample`), `mount-clip-studio.ts` (`getEyeDropper*` + `onSampleColor`), `background-color-sampler.ts`, `background-direct-manipulation.ts` (`setInteractionBlocked`), `studio-v4-controls.css` (sampling chrome).

**Next:** product sprint to mirror sample ownership onto the precision mini; then finish remaining Phase 5 operator recheck.

### 2026-07-20 — Track B Phase 5 operator pass + accessibility/state follow-up

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** this sprint<br>
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) §3, §6–§7, §11

**Operator evidence:** original checklist §6 passed; double-click/Escape center reset passed. The pass exposed reversed keyboard semantics on the spatial Y slider, a one-frame stale position repaint only after live audition opened, and hero drag intercepting eye-dropper sampling.

- Y slider keyboard handling is now inverted only for the spatial vertical control: ArrowUp lowers normalized Y and ArrowDown raises it. Pointer travel remains top→bottom, and other physical sliders retain their existing arrow behavior.
- The open recorder session now treats Studio's synchronous image/layout as authoritative over delayed preference notifications. Every accepted Studio prefs/profile snapshot advances that override, and unchanged personal-image IDs no longer trigger redundant decode/load work during layout-only changes.
- Eye-dropper sampling listens on the top hero manipulator surface and blocks hero/mini direct manipulation until valid sample, toggle-off, Esc, background removal, or disposal. Transparent/unavailable pixels keep sampling active and announce stronger guidance after three misses.
- Added standards-native `color-burn`, `color-dodge`, and `difference` blend choices. Canvas 2D has no portable `divide`/`subtract`; `difference` is the useful subtract-like option.
- Added opt-in **Holo drift** as a normalized boolean (default false): two low-alpha chromatic `screen` image passes plus one clipped slow `soft-light` sheen, mildly energy-modulated. It lives wholly inside the personal-image draw slot, uses the shared preview/capture clock, and freezes at time zero under reduced motion.
- No new store, preference version, message, layer, dependency, WebGL path, or bake renderer. ADR-0008 remains authoritative; architecture map/extension-point MINOR bumps stay deferred to Track B merge.

**Automated:** prior focused **69/69** + holo compositor **4/4** + recorder authority **3/3** = **76/76**. Shared UI tokens PASS; visual-size gate logic **5/5**; production build **PASS**; compile only the same two pre-existing subtitle diagnostics; `git diff --check` PASS.

**Operator recheck:** confirm no one-frame snap in pre-record/record output; eye-dropper selects and exits cleanly without panning; added blends and Holo are aesthetically useful; Y ArrowUp/ArrowDown follow spatial direction. The real ~120 s blur+GIF size artifacts remain open before the Track B merge gate.

**Next:** perform that focused recheck, then begin Phase 6 framing aids.

### 2026-07-20 — Track B Phase 5 properties/effects + recording-safe preset audition implemented

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `16e3dd0`<br>
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) §6–§7 operator smoke remains open

- Closed the Phase 4 operator caveat: immediately before `MediaRecorder` starts, any transient preset audition is restored to the committed image/layout; preset hover/focus/click/Apply stays disabled throughout actual capture and returns afterward. The contact sheet shows a restrained `REC SAFE` state and cannot introduce flash-heavy frames into the recorded canvas.
- Added a compact image-treatment bay backed by the existing normalized layout: live/persisted dim, blur toggle + amount, exact allow-listed blend select, and the existing Fit/Fill + custom manual-scale control.
- Added collapsible GIF controls. Speed drives a continuous playback clock from 0.5–2×; optional voice-energy modulation changes velocity without frame jumps; reduced motion still freezes frame zero. Default 1×/non-reactive timing retains the legacy frame phase.
- Added a permission-free in-canvas eye-dropper. It maps CSS pointer coordinates to preview bitmap pixels, reads `getImageData`, fails closed for unavailable/transparent pixels, and hands the sampled hex to the existing Style bar/glow path without mutating layout.
- Reused the ADR-0008 preference/preview/recorder/draw seam. No new store, signal, message, dependency, layer, `USER_PREFS_VERSION`, or package-version change.

**Automated:** layout **11/11** · direct-manipulation/zoom **8/8** · precision **5/5** · interaction utils **6/6** · control UI **10/10** · presets **5/5** · canvas sampler **5/5** · caption geometry **7/7** · prefs storage **12/12** = focused **69/69**. Shared UI tokens PASS; visual-size gate logic **5/5**; production build **PASS**; compile only the same 2 pre-existing subtitle diagnostics; `git diff --check` PASS.

**Residual operator gate:** exercise every treatment/blend, GIF speed/reactivity + reduced motion, eye-dropper hand-off, and start a recording while a preset is hovered to confirm the frame restores before capture. The real ~120 s blur+GIF base/baked artifacts and `qa:visual-size` report remain required.

**Architecture:** ADR-0008 already owns this Design-phase property/effect seam. Architecture map/extension-point MINOR bumps remain deferred to Track B merge per roadmap §9.

**Next:** Phase 5 operator QA, then Phase 6 multi-aspect crop guides + compare.

### 2026-07-20 — Track B Phase 4 presets + live audition implemented

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `1166d51`<br>
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) §7 operator smoke remains open

- Applied the final Phase 3 operator tweak: upward Y-axis controls now place fine `.01` before coarse `.05`; the control UI suite locks that DOM order. The user confirmed all other Phase 3 behavior/UI passed QA, so checklist §4 additions and §5 are closed.
- Added four normalized Aurora/Warm Glow image-layout recipes (`image + scaleMode + customPosition + manualScale + dim`) in a Cividis contact-sheet row using the actual packaged SVGs.
- Hover or keyboard focus auditions a complete recipe on the hero, mini frame, and any open recorder session without saving. Leaving both hover/focus states restores the exact committed image/layout; selection only arms explicit Apply, which snapshots history and persists once.
- Included backgrounds use stable `bg-…` references but resolve directly from extension assets. They appear in the existing background selector, cannot be deleted, and are excluded from ImageDB quota/reference pruning. No prefs version/store/message/signal/dependency/layer change.
- Preset resolution deliberately preserves Phase 5 effect intent (`blur`, `blendMode`, GIF controls, safe-text lock) while applying only Phase 4-owned recipe fields.

**Automated:** layout **10/10** · direct-manipulation/zoom **8/8** · precision **5/5** · interaction utils **6/6** · control UI **9/9** · presets **5/5** · caption geometry **7/7** · prefs storage **12/12** = focused **62/62**. Production build **PASS** and contains both SVG assets; compile only the same 2 pre-existing subtitle diagnostics; `git diff --check` PASS.

**Architecture:** ADR-0008 already owns the Design-phase preset/layout seam; the recipes reuse the existing preference, preview, recorder, and draw path. Architecture map/extension-point MINOR bumps remain deferred to Track B merge per roadmap §9.

**Next:** operator-check checklist §7 hover/focus restore, Apply/reload, included choices, and open-audition hot-swap; then Phase 5 properties/effects + eye-dropper.

### 2026-07-20 — Track B Phase 3 positioning console + interactions implemented

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `844a81f`<br>
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) §4 new console rows + §5 remain open for operator confirmation

**Operator carry-forward:** user confirmed the Phase 2 fine-position behavior and bidirectional sync work correctly. That closes the original §4 behavior rows; Phase 3 changed their visual arrangement, so the new layout/slider rows remain open.

**Product state:**

- Fine position is now a camera-style console around the actual mini-preview: horizontal controls below, vertical controls at right, original directional chevrons for ±0.01, new doubled variants for ±0.05, and orientation-aware physical sliders on both axes.
- `interaction-utils.ts` owns guarded clamp, logarithmic scale mapping, sticky-snap hysteresis, per-axis snapping, and caption-band constraint math. Ctrl/Cmd+wheel zoom preserves the image point under the cursor; the visible zoom slider uses the same scale mapping.
- Center/thirds/edges guides and active snap lines are DOM-only preview overlays. Snap can be disabled, Shift temporarily bypasses it, Guides can be hidden, and Clear captions uses the exact preview caption measurement to keep the focal point outside the rendered subtitle band.
- The Studio host owns a bounded 20-snapshot background-layout history. Gesture-start snapshots prevent RAF-frame spam; undo/redo is scoped away from subtitle history and flushes pending hero/mini writes before restore.
- Existing nested prefs and `setUserBackgroundLayout` remain the only state/hot-swap seam. No new context, message, store, signal, dependency, compositing layer, `USER_PREFS_VERSION`, or post-capture renderer.

**Automated:** layout **10/10** · direct-manipulation/zoom **8/8** · precision **5/5** · interaction utils **6/6** · control UI **6/6** · caption geometry **7/7** · prefs storage **12/12** = focused **54/54**. Production build **PASS**; compile only the same 2 pre-existing subtitle diagnostics; `git diff --check` PASS.

**Architecture:** ADR-0008 already owns this exact Design-phase seam. Map/extension-point MINOR bumps remain deferred to Track B merge per roadmap §9.

**Operator follow-up:** user reported the Phase 3 UI/behavior passes QA on 2026-07-20; the only requested adjustment was the upward Y-button order recorded in the Phase 4 entry above.

### 2026-07-20 — Track B Phase 2 precision widget implemented

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commit:** `b129713`<br>
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) §4 remains open for operator UI confirmation

**Product state:**

- Background subpanel's existing `renderThemePreview` frame is now the interactive precision mini-preview; no parallel renderer or capture layer.
- Hero and mini frame share `background-direct-manipulation.ts` pointer math, RAF coalescing, ImageDB dimensions, and debounced persistence.
- X/Y readouts update bidirectionally; explicit ±0.01 / ±0.05 buttons clamp through `normalizeUserBackgroundLayout` and immediately update hero + active audition.
- Other Studio saves flush both positioning surfaces before profile/style snapshots, preventing stale layout capture.

**Automated:** layout **10/10** · direct-manip **6/6** · precision **5/5** · prefs storage **12/12** · production build **PASS** · compile only the same 2 pre-existing subtitle diagnostics · `git diff --check` PASS.

**Architecture:** existing Design-phase Background Layout seam only; no context/message/store/signal/dependency/layer/version change. Map/extension-point MINOR bumps remain deferred to Track B merge per roadmap §9.

**Next:** operator §4 mini-frame/bidirectional smoke, then Phase 3 `interaction-utils.ts` (zoom / sticky snap / undo).

### 2026-07-20 — Track B living-docs catch-up (Phase 0+1 + operator Phase 1 QA PASS)

**Branch:** `feature/v6.0.0-background-panel-refactor` · **Commits:** Phase 0 `08a2de5` · Phase 1 `1e3118f`  
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) — sections **0–3** marked for Phase 0/1; full merge gate remains open

**Product state (already on branch; docs had lagged):**

- **Phase 0:** nested `UserBackgroundLayout` + normalize/clamps/migration; custom offset + field dim/manualScale/blur/blend in draw path; old panel wires nested layout; Node **10/10**.
- **Phase 1:** hero-only direct pan/focal (`background-direct-manipulation.ts`); debounced persist; overlay CSS; Node **6/6**.
- **Operator:** confirmed drag works on the Design Studio **live preview** only; background **submenu unchanged** — correct for Phase 1.

**Automated re-check this sprint:** layout 10/10 · direct-manip 6/6 · `npm run build` PASS.

**Docs updated:** root `TODO.md` / `claude-progress.md` · this file · `TODO-6.0.0.md` · workspace README · `track-b/README.md` + checklist · roadmap header/§10/carry-forward.

**Next code:** Phase 2 precision widget. Standing by for further operator QA.

### 2026-07-20 — Track B init: branch FF + QA scaffold

**Branch:** `feature/v6.0.0-background-panel-refactor` · **was HEAD:** `2b42db5` (identical to `main` after FF)  
**Checklist:** [`track-b/qa-checklist.md`](track-b/qa-checklist.md) · **README:** [`track-b/README.md`](track-b/README.md)

**Done:**

- Fast-forwarded stale feature tip `98c37ab` → current `main` (`2b42db5`, post Track A merge + Track C merge). No unique Track B commits existed on the old tip.
- Checked out the feature branch for development.
- Scaffolded `track-b/` to match track-a / track-c process: committed `README.md` + `qa-checklist.md` (roadmap §8 matrix); created gitignored `logs/` · `screenshot/` · `artifacts/`.
- Flipped workspace ledger / README / this progress file to **Track B open**; short root `TODO.md` / `claude-progress.md` pointers.
- Roadmap header + §10 updated; ADR-0008 **Proposed → Accepted** (branch open / implementation track).

**Follow-on (same day):** Phase 0 + Phase 1 product commits landed; see session entry above.

### 2026-07-19 — Track C popup refresh: implementation + agent QA gate PASS · merged

**Branch:** `feature/v6.0.0-popup-ui-refresh` · **Checklist:** [`track-c/qa-checklist.md`](track-c/qa-checklist.md) · **Evidence:** `track-c/logs/computed-style-qa-2026-07-19.json`  
**Overall:** agent gate (checklist §1–§7) **PASS**, blockers none · §8 real-extension eyeball residual **deferred** (not a merge gate — pure presentational; no state/message change) · **merged to `main`**

- Popup skinned onto the Cividis axis via popup-only `entrypoints/popup/popup-palette.css` (`@import`s the Studio palette); `entrypoints/popup/style.css` untouched — it is the **Studio's shared control-primitive base** (discovered import in `design-studio/main.ts`; isolation git-verified, empty diff vs `f1653c4`).
- Elevated restart caution: bar under the header + inline amber "Reload now"; same `restart-caution.ts` API + call sites. Verified behaviorally (reveal on toggle flip, placement geometry, aria, stubbed reload invocation).
- Guard: `test-ui-tokens.mjs` + popup adoption + banned-hex scan; fixture `scripts/fixtures/popup-visual/`.
- QA method note: Browser-pane pixel capture faulted all session (screenshot/zoom timeouts; DOM/JS/keyboard fine) → computed-style + CSSOM + real-Tab evidence instead. Light mode must be judged on a **fresh load** — flipping emulated color scheme on a live page left one stale-painted control (renderer-level, not a cascade defect; documented in the evidence JSON).
- Drive-by: `APP_VERSION` 5.10.0→5.11.0 (popup displayed a stale release string).

### 2026-07-20 — Pass E operator full PASS · Track A confidence close

**Packet:** [`track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json`](track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json)  
**Operator:** bra-khet · Win 10 / RTX 4050 Laptop · Chrome 150 · build `.output/chrome-mv3-dev/`  
**Overall:** `pass` · **blockers:** *None. Pass E is a full pass.* · fifth and final Track A QA pass.

All required sections marked pass: pre-flight · preview↔capture↔bake · 6 spectra · 7 atmospheres · accents/max-three/governor · audio axes · FPS/Detail · a11y · 120 s size gate · saved styles/hot-swap/Bubbles · product smoke · early-log triage · Classic no-regression.

**Size rows (Pass E packet):** rain ~30/25 · aurora 11/25 · glitch 10/23 · inferno 13/25 · three-stack 18/25 MiB (all under 40/40).

**Accepted residual (operator follow-up, not a fail):** Conway Life can still park in a dead-edge corner after a *long* run while other colonies keep moving — whole-grid stagnation detector does not see regional freeze. Documented in `conway.ts` KNOWN LIMIT + `TODO-6.0.0.md` accepted residual. No further code change for merge.

**Closeout:** confidence ledger closed; root `TODO.md` / `claude-progress.md` short verdict updated; feature branch eligible to merge to `main` (Track B stays deferred; package version remains 5.11.0 until an explicit v6 ship).

### 2026-07-19 (late) — Conway Life stagnation detector (agent)

Operator-reported: Conway frequently freezes into still-lifes or period-2 blinkers on the
48×16 non-wrapping grid. Fixed in `f231938` (conway.ts only — `BoundedLifeGrid` untouched,
no toroidal change).

**Root cause.** The only escape hatch was the near-extinction reseed (`alive < 5`). The two
attractors this dead-edge field actually falls into — a tapestry of stable blocks/beehives,
and blinkers — both sit at a **high and constant** population, so that guard never fired.
Ambient `seedAudioPatterns` seeding is gated by `spectral + familyDrive` and gets rejected at
conversational drive, so nothing reopened the field. Note a population check could never have
caught this: a blinker has identical alive counts in both phases. It needed a *state* compare.

**Fix.** `trackStagnation` runs once per generation after `grid.step()`, keeping two prior
post-step fingerprints; a match against the last (period-1) or the one before last (period-2)
counts as stagnant. After **3** consecutive stagnant generations with `drive > 0.02`, 1–2
audio-biased cells are stamped onto a **living anchor** so the frozen structure breaks in
place instead of new life spawning beside it. `fingerprintLife` does double duty — FNV-1a
hash + anchor pick in one sweep, per generation (80–220 ms), not per frame. Spur probing
leans on the grid's existing out-of-bounds rejection, so an edge anchor just falls through to
the next probe.

**Evidence** — 18-cell sweep (layout × sensitivity × density) under a realistic speech
envelope, longest frozen stretch over 60 s:

| scene | before | after | mean alive |
|-------|--------|-------|------------|
| centered · sens 0.35 · dens 0.90 | **54.37 s** | 1.43 s | 12.4 → 37.9 |
| linear · sens 0.35 · dens 0.90 | **24.73 s** | 0.83 s | 62.1 → 61.0 |
| remaining 16 cells | healthy | healthy | no regression |

Mean alive *rises* in the frozen cases, so the field genuinely churns rather than flickering.
Threshold 3 was chosen over 4 on measurement (worst case 1.87 s → 1.53 s; linear 1.57 s →
0.40 s); both sit in the requested 3–4 band.

**Trap for future passes:** the freeze is **trajectory-dependent** — it appeared in only 2 of
18 configurations, and small shifts in seeding phase or band weights make it vanish. That
matches the operator's "frequently", not "always". A browser before/after fixture was built
and **discarded** because it would not reproduce the freeze; a non-reproducing comparison page
in this workspace is worse than none. Reach for the Node sweep, not a fixture, for this class
of defect.

Tests: two new checks (17/17 in the Conway suite). The stagnation check is a real
discriminator — **2** generations held with the fix vs **16** without, bound at 9. The second
pins that the nudge can never light up a silent capture. **All 57 Node suites PASS** · `tsc` =
same 2 pre-existing subtitle diagnostics · `wxt build` PASS.

**Pass E addition:** confirm the colony keeps reorganising across speech pauses, stays still
in silence, and that the nudge never reads as cells "popping" in on a visible cadence.

### 2026-07-19 (evening) — Pass D targeted follow-up: digital-rain visibility + glitch photosensitivity (agent)

Two operator-directed fixes (commits `882a61e` + `87efdb0`):

- **digital-rain** — audio drive now gates **spawning only**. An active stream captures its
  spawn-time drive as a per-lane `residual[]` brightness floor and lives out its whole pass
  (advancing + trailing until the tail leaves the grid) — Rising Ember's
  spawn-then-live-out-their-life model. Previously strength decayed toward the *live* drive
  every frame, so quiet passages dimmed glyphs mid-fall and the next word re-lit them
  mid-air. Live drive still modulates fall *speed* (0.55× floor guarantees completion);
  transients still briefly lift a stream above its residual. Element ceilings + size gates
  unchanged; the stable per-stream alpha removes flicker entropy. New suite check: streams
  primed loud survive 2.5 s of near-silence at spawn-residual brightness (17/17 pass).
- **glitch (HIGH PRIORITY — photosensitivity)** — the DEFAULT path is now safe under
  WCAG 2.3.1 on its own (reduced-motion is not the safety mechanism):
  1. Full-strength invert flashes are spaced ≥ 340 ms + 0–80 ms seeded jitter
     (≤ 3 full flashes in any rolling second, never a rigid cadence).
  2. Rate-refused hits fall back to a quarter-scale wash (~7% peak white — under the
     luminance change that counts as a flash) and every blip eases in over a 60 ms
     smoothstep. Burst-decay envelope untouched; the effect stays reactive.
  3. Saturated-red prohibition: invert is white-by-construction; user palettes pass
     through `sanitizeGlitchPalette` (R/(R+G+B) ≥ 0.72 desaturates toward signal white)
     before fringes/seams/scanlines/rails. The `#ff2f92` magenta identity is untouched.
  4. Glitch selection card carries the semiotic warning indicator + one polite line
     ("May feel intense for some viewers — reduced-motion settings soften it.");
     icon stamps at mount, no behavior change, no modal.
  Two new suite checks pin the flash budget and the red guard (14/14 pass).

Verification: **all 57 Node suites PASS** · `tsc` = same 2 pre-existing subtitle
diagnostics · `wxt build` PASS.

**Pass E additions:** confirm rain streams no longer fade/re-lit mid-fall across pauses
in speech; hammer Glitch with rhythmic loud speech and confirm the invert cadence feels
stochastic (full hits interleaved with soft ramps, never a strobe); check the Glitch
card note reads as a courtesy, not an alarm.

### 2026-07-19 (later still) — Pass D fix sprint (agent)

Addressed the full Pass D packet (`track-a/artifacts/qa-session-track-a-pass-d-2026-07-17.json`)
in per-effect commits (`26f3a0c..c184985`, 8 commits). Operator verdict was "visuals nearly
perfect"; this sprint closed the remaining items:

- **oscilloscope** (§2f, the open reactivity defect) — the fixed sensitivity gain became a
  waveform AGC (fast-rise 9/s / slow-decay 0.55/s recent-peak reference → sensitivity-shaped
  display target 0.34+s·0.42, boost capped ×6 for an honest silence floor). Preview lands at
  ~60% of its old clipped activity; live speech is lifted to the same target; one shared code
  path keeps the preview==capture parity contract.
- **inferno** (§3e) — per-layer vertical heat ramps on the front (sheath dissolves upward,
  body keeps its ramp, core hottest at the hearth); licks morph over life: bottoms stretch
  into an elongated tendril at birth, retract by mid-life, and the last 22% pinches to a
  small point — the requested "lick of flame" arc; spark trails taper head→zero-tail in both
  variants. Verified visually on the regenerated before/after fixture.
- **§3 line-taper prescription** (inner end full alpha → outer end zero, performant, no new
  glow) applied everywhere flat straight strokes remained: **smoke** spine (vent-anchored,
  both contrast modes), **rising-ember** HC trail, **aurora** (open-lane fold-spine ends,
  HC source lines, radial ring as a cross-stroke fade — a closed ring has no ends),
  **particle-burst** comet trails + reduced-motion rays, **inferno** spark trails.
  Deliberately skipped: lightning/electric-arc (jagged hard segments are the electric
  identity and were signed off §4a), neon-glow (wide glow tubes, no bare segments), conway
  (cell fills only).
- **caps** (blockers) — BROWSER_COMPOSITE_VIDEO_BPS 1.5 → 2.2 Mbps so a 2:00 bake targets
  ~35 MiB (operator figure) under the 40 MiB store cap (~5 MiB headroom); fixed the stale
  BAKED_MP4_MAX_BYTES guard mirror (still 30 MiB from before Pass A). Explains the operator's
  "baked is less than base" observation — the old pin crushed every bake to ~25 MB. Future
  intent recorded in-comment: ~48 MiB if worker memory allows (store caps first).
- **Void Inferno toggle** (blockers) — relocated from beside the global High Contrast switch
  into the Atmosphere bay directly under the picker (still Inferno-only). Same data
  attributes, so wiring and prefs schema are untouched.
- Trap confirmed again: particle-burst's mock returned an own-closure gradient stub; the
  prototype-`MockGradient` pattern restored deepEqual determinism (same fix as Pass A).
- **Fixture port moved 9310** (8600 fell into a Windows excluded range after reboot);
  `.claude/launch.json` updated; after.js regenerated from source.

Verification: **all 57 Node suites PASS** · `tsc` = same 2 pre-existing subtitle
diagnostics · `wxt build` PASS (1.9 s).

**Next for operator (Pass E):** reload, confirm oscilloscope live-vs-preview parity at
normal speech, the inferno front gradients + tendril licks, the line tapers (smoke HC
spines / ember HC / aurora lines / particle-burst), the Void toggle's new home under the
Atmosphere picker, and re-run one 120 s digital-rain size gate to see the new ~35 MiB
baked target land under 40.

### 2026-07-19 (later) — Pass C fix sprint (agent)

Addressed the full Pass C packet (`track-a/artifacts/qa-session-track-a-pass-c-2026-07-19.json`)
in per-effect commits (`3ba5a26..820a2e8`, 13 commits). All §8-12 size gates PASSED under
the 40/40 caps (operator reports: rain 19/25 · aurora 11/25 · glitch 10/23 · inferno 13/25 ·
three-stack 18/25 MiB). Highlights:

- **inferno** (the priority) — five-sine crest ripple → deterministic lattice value noise
  (smoothstep space+time, seam-free radial wrap); front painted as noise-masked layers
  (sheath / gradient body+crest / bright core); lick emission gated by the same flare
  channel that bulges the core, so pulse and spawn are one event. Verified visually via
  the rebuilt before/after fixture (after.js regenerated from source; **fixture port moved
  8873 → 8600** — old port fell into a Windows excluded range).
- **aurora** — centered side lines now trace the live paired-band envelope (were static
  bars); radial "left gap" was the atan2 sort seam → lanes close into wrapped annulus
  loops + mirrored band mapping (Central Pulse treatment); ribbons fade in/out on their
  mean member-life envelope.
- **digital-rain** — radial only: 25% fewer spoke cells, 0.06–0.52 span, glyphs sized to
  one radial step (divisor 1.32 → 2.2).
- **glitch** — threshold + flux floor lowered again, simmer ~4× faster (fires every 1–3 s
  of speech, still silent in silence), + vertical chroma ghost and difference-composite
  inversion flash (element cap formula updated with test).
- **sparkle** — honest post-teleport-fix motion was ~2 px/s; rise now streams with energy
  and the wobble amplitude (never frequency) rides audio.
- **bubbles** — new `imageBackdrop` environment flag (set at the drawThemeBackground seam);
  lens alpha ×1.4 ± 0.1 per-orb flutter over image backgrounds.
- **forest-spirits** — head "ears" → smaller swaying wisps with tip-fading gradient.
- **phosphor** — AGC (fast-rise/slow-decay reference, 0.85 headroom) replaces per-frame
  1/peak normalization; ends cap-sitting, preview/capture parity kept.
- **central-pulse** — symmetric stochastic flutter on the band shape bias (folded-coordinate
  sampling preserves the signed-off symmetry).
- **oscilloscope** — defaults retuned to the old maxed-out feel + ~12-13% amplitude headroom.
- **lightning** — per-route low-frequency bow (real arcing) + walk endpoints anchored to
  the dominant band (Particle Burst's praised placement logic).
- **electric-arc** — contact jumps ~2.5× larger on slower 0.9–2.2 s epochs (jumpy but buildable).
- **smoke** — per-plume agitation cycles: puffs jump per spawn during the agitated window,
  then settle to the smooth wander; spine breaks across jump gaps.
- **neon-glow** — second small reactivity bump. **ember/particle-burst/conway** untouched.

Verification: **all 57 Node suites PASS (528 checks)**; `tsc` = same 2 pre-existing
subtitle diagnostics; `wxt build` PASS.

**Next for operator (Pass D):** reload, visually confirm the Pass C rework (esp. the
inferno noise front + flare-coupled licks, aurora centered/radial modes, glitch activation
cadence), spot-check bubbles over an image background, and re-export a packet.

### 2026-07-19 — Pass A fix sprint (agent) + operator Pass B feedback folded in

Addressed the full Pass A packet (`track-a/artifacts/qa-session-track-a-pass-a-2026-07-17.json`)
in per-effect commits on this branch (`2598815..aaf0bb3`, 20 commits). Highlights:

- **digital-rain** — per-lane streams replace global-step propagation (sync-strobe +
  size-gate root cause); Pass B: trails min ~2–3 cells, ~10% slower. **Needs 120 s size-gate re-run.**
- **inferno** — SDF-smoothed flame front (≤ half canvas, hysteresis) + Pass B peak→lick
  coupling; Void variant toggle revealed in Style panel; Void smoke = noise lobes.
- **aurora** — lane-joined Catmull-Rom ribbons (pool 200→84, maxElements 403→17); bow
  line now traces the real emission envelope with end-taper.
- **glitch** — onset flux averages rising bands only (activation bug), simmer
  micro-glitches, burst wave-slice pass.
- **spectra** — phosphor 18–36×9–14 grid + sub-bin interpolation + reduced-motion
  breathing; radial gradient colors + rocking + reduced-motion unfreeze; central pulse
  mirrored band deformation + unfreeze; oscilloscope reduced-motion clip fix + hotter
  gain + picker cost badges (default stays classic-neon everywhere).
- **stackables** — ember whip trail (operator: perfect); lightning walking endpoints;
  arc sporadic contact roaming; smoke smooth vent wander + wider spread; neon-glow hotter.
- **forest-spirits** (Pass B) — snake turn-commitment steering, segments −25%,
  dandelion-puff dots with per-dot alpha.
- **caps** — base/baked MP4 blob caps raised 25/30 → **40/40 MiB** (operator decision,
  §8-12); harness + checklist synced; composite bitrate pin intentionally stays 30 MiB.

Verification: **all 57 Node suites PASS** (test contracts updated where behavior
legitimately changed); `tsc` = same 2 pre-existing subtitle diagnostics; `wxt build` PASS.

**Next for operator (Pass C):** reload from `.output/chrome-mv3-dev/`, visually confirm
the reworked effects (esp. inferno peak-licks, aurora ribbons, digital-rain trails),
re-run the digital-rain 120 s size gate under the new caps, and re-export a packet.

### 2026-07-15 — Interactive Track A QA guide

- Verified checklist was real gates (not boilerplate); embellished with registry IDs, governor 560/980, §16 Classic no-regression, non-negotiables, ADR pointers.
- Added primary operator UI: [`track-a/qa-checklist.html`](track-a/qa-checklist.html) — sticky progress, per-item Open/Pass/Fail/Partial + notes, size table, localStorage autosave, **Export agent packet (JSON)** / **Copy agent brief** / Import restore.
- Agent ingest path: save exported JSON under `track-a/artifacts/` (gitignored) or paste brief into chat. Schema `rvn-qa-session/v1`.

**Next for operator:** open the HTML board → pre-flight → live matrix + 120 s size rows; export packet when handing off.

### 2026-07-15 — QA workspace scaffold

- Established `qa/QA-6.0.0` as the nested QA project (out of `.ignore/` for lasting scope).
- Created scoped [`TODO-6.0.0.md`](TODO-6.0.0.md) + this progress file; Track A checklist skeleton; Track B placeholder only.
- Preserved existing early dumps under `track-a/logs/`:
  - `notes-before-bed-1.txt` — voice re-apply / Change Voice not applying (triage later; may not be a Track A visual defect)
  - `offscreen-transcode-failure-1.log` / `offscreen-transcode-success-1.log`
- Global root `TODO.md` + `claude-progress.md` updated with **location/name pointers only**.
- Option 2 gitignore: track process under `qa/`; ignore `qa/**/logs|screenshot|artifacts/`.

---

## Evidence index

| Path | What |
|------|------|
| `track-a/logs/` | Console dumps, free-form notes |
| `track-a/screenshot/` | UI / DevTools images |
| `track-a/artifacts/` | 120 s base/baked MP4s + `qa:visual-size` text/JSON + exported agent packets |
| `track-a/qa-checklist.html` | **Primary** interactive checklist (localStorage + export) |
| `track-a/qa-checklist.md` | Reference matrix (same gates) |

---

## Verdict

| Gate | Result | Date |
|------|--------|------|
| Live capture / FPS / a11y | ■ PASS | 2026-07-19 (Pass E) |
| 120 s heavy size reports | ■ PASS | 2026-07-19 (Pass C + Pass E reconfirm) |
| **Track A overall** | ■ PASS | 2026-07-19/20 |

**Key:** ■ PASS · □ FAIL · ▲ PARTIAL · ☐ open  
**Evidence:** `track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json`
