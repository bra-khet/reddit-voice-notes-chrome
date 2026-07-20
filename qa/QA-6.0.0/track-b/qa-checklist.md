# Track B — Background panel refactor QA checklist

**Sprint:** v6.0.0 Track B — Design-phase direct-manipulation background layout  
**Branch:** `feature/v6.0.0-background-panel-refactor`  
**Roadmap:** [`docs/v6.0.0-background-panel-refactor.md`](../../../docs/v6.0.0-background-panel-refactor.md) §8  
**ADR:** [0008](../../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)  
**Workspace TODO / progress:** [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md)  
**Machine / browser:** operator workstation (Phase 1 UI)  
**Date:** 2026-07-20 (Phase 0–3 landed; Phase 1–2 operator QA PASS; Phase 3 operator pending)<br>
**Build:** load `.output/chrome-mv3-dev/` (or prod) from this branch  

**Why this gate exists:** Track B elevates the 9-direction grid into drag/zoom/snap layout on the Studio hero. Background pixels are **capture-time only** (I1/I3); layout must hot-swap into the *next* recording with no post-capture re-composite, no prefs version bump, and no bake-size/perf regression vs v5.11.0.

**Merge / release when:** required sections PASS (or FAIL with notes + no ship).  
**Automated (as of Phase 3):** focused layout/interaction/UI set **54/54** — layout **10/10** · direct-manipulation/zoom **8/8** · precision **5/5** · interaction utils **6/6** · control UI **6/6** · caption geometry **7/7** · prefs storage **12/12**. `npm run build` **PASS**; `npm run compile` = 2 pre-existing subtitle diagnostics only (expected).

### Non-negotiables (any FAIL here fails the gate)

| Rule | Source |
|------|--------|
| Design-phase only — cannot re-position an already-recorded take | roadmap §0 · ADR-0008 · I1/I3 |
| Capture-time background — bake never re-renders the image layer | I1/I3 |
| Additive prefs only — no `USER_PREFS_VERSION` bump | ADR-0006 · roadmap §3.2 |
| No new deps / WASM / fourth compositing layer | ADR-0008 · non-goals |
| No bake-size / FPS / legibility regression vs **v5.11.0** default/Classic | roadmap §8 success metrics |
| Multi-aspect = **crop guides** on 16:9 only — not multi-format export | roadmap R-multi |
| `normalizeUserBackgroundLayout` guards every new field | R18 prefs-gate class |

### Size caps (roadmap §8 parity / size)

| Artifact | Cap | Note |
|----------|-----|------|
| Base MP4 (~120 s, blur + GIF stress) | ≤ **25 MiB** | Track B stress case |
| Baked MP4 (~120 s, same) | ≤ **30 MiB** | Track B stress case |
| Track A heavy scenes (context) | ≤ 40 / 40 MiB | Do not regress those either |

---

## How to use

1. Prefer a **dev build**; reload the extension after every rebuild.
2. Tick `- [ ]` → `- [x]`; jot evidence under **Notes** (`logs/`, `screenshot/`, `artifacts/`).
3. Consoles: Service worker · Design Studio · Reddit tab (for capture path).
4. Size gate (short smokes **cannot** pass the 120 s row):

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

5. Phase 0 acceptance is **automated + migration** only (zero intentional visual change). Direct-manipulation rows open after Phase 1+.

### What to bring back on FAIL

| Item | Why |
|------|-----|
| Section # + checkbox | Locates the gate |
| UI symptom + layout fields (`customPosition`, scale, dim, blur, blend, GIF) | Product surface |
| SW + Studio console excerpts | Hot-swap / persist / capture |
| Paths to screenshot / artifact | Repro |
| Whether reduced-motion / keyboard-only / lock-to-safe-text was on | Context |

### Evidence layout (gitignore — process tracked, blobs ignored)

| Path | What goes here | Git? |
|------|----------------|------|
| `logs/` | Console dumps, free-form notes | ignored |
| `screenshot/` | UI / DevTools / before-after images | ignored |
| `artifacts/` | 120 s MP4s + size reports + agent packets | ignored |
| `qa-checklist.md` / `README.md` | Process structure | tracked |

---

## Progress summary

| # | Section | Status | Notes |
|---|---------|--------|-------|
| 0 | Pre-flight | ▲ | Phase 1–2 operator path PASS · Phase 3 build reload pending |
| 1 | Automated / Node (layout + interaction utils) | ■ | focused Track B layout/interaction/UI set 54/54 · build PASS |
| 2 | Phase 0 migration + zero visual change | ■ | Node + design intent; panel still legacy 9-grid |
| 3 | Direct manipulation (drag / focal / reset) | ■ | Operator Phase 1 QA PASS — hero only |
| 4 | Precision widget + bidirectional sync | ▲ | Phase 2 behavior operator PASS · redesigned spatial console operator smoke pending |
| 5 | Zoom, sticky snap, undo/redo, lock-to-safe-text | ▲ | Phase 3 code + automated gate PASS · operator UI pending |
| 6 | Properties / effects / GIF | ☐ | Phase 5+ |
| 7 | Presets + eye-dropper hand-off | ☐ | Phase 4–5 |
| 8 | Framing aids (crop guides / thirds) | ☐ | Phase 6 |
| 9 | Preview ↔ record ↔ bake parity (I1/I3) | ☐ | |
| 10 | 120 s size — blur + GIF stress | ☐ | |
| 11 | a11y (keyboard / ARIA / reduced-motion) | ☐ | Phase 7 |
| 12 | Product smoke + Classic / default no-regression | ☐ | |

**Overall:** ▲ partial (Phase 0–3 code complete; redesigned console/Phase 3 operator QA + full Track B merge gate open)

**Key:** ■ PASS · □ FAIL · ▲ PARTIAL · ☐ open  

---

## 0 · Pre-flight

- [x] Branch is `feature/v6.0.0-background-panel-refactor` (or equivalent Track B build loaded)
- [x] Extension reloaded from `.output/chrome-mv3-dev/` (or prod); no red errors on load (SW / offscreen)
- [x] Design Studio opens; background panel still **hidden** until a personal background is selected
- [ ] Selecting / uploading a custom background reveals the spatial precision console plus existing fit/grid controls *(re-check on Phase 3 build)*
- [x] Evidence folders ready: `logs/` · `screenshot/` · `artifacts/`

**Notes:** Operator Phase 1–2 paths passed 2026-07-20. Reload and check the redesigned Phase 3 positioning console before closing pre-flight.


---

## 1 · Automated / Node

Fill as pure-math suites land; re-run only when related code changes.

- [x] `node scripts/test-background-layout.mjs` PASS (normalize defaults/clamps, blend allow-list, `customPosition`↔discrete, offset math) — **Phase 0 · 10/10**
- [x] `node scripts/test-background-direct-manipulation.mjs` PASS (pan/focal drag + cursor-anchored zoom math) — **Phase 1+3 · 8/8**
- [x] `node scripts/test-background-precision.mjs` PASS (±0.01/±0.05 axis nudges, clamps, field preservation) — **Phase 2 · 5/5**
- [x] `node scripts/test-interaction-utils.mjs` PASS (sliderToScale round-trip, sticky-snap hysteresis, per-axis `snapPosition`, caption-band constraint, `clamp01`) — **Phase 3 · 6/6**
- [x] `node scripts/test-background-control-ui.mjs` PASS (embedded mini, spatial rails, single/double assets, slider orientation/pointer mapping, Phase 3 controls) — **Phase 3 · 6/6**
- [x] `node scripts/test-cue-measurement.mjs` PASS (including shared normalized caption-safe band) — **7/7**
- [x] Focused Track B layout/interaction/UI set green — **54/54** including prefs storage **12/12**
- [x] `npm run build` PASS
- [x] `npm run compile` — only the 2 pre-existing subtitle diagnostics

**Notes:** Phase 3 agent gate 2026-07-20: focused **54/54**, production build PASS, and `git diff --check` PASS. Compile retains only the same two pre-existing subtitle diagnostics.


---

## 2 · Phase 0 migration + zero visual change

- [x] Existing profiles/styles with flat `backgroundScaleMode` / `backgroundPosition` load unchanged *(normalize migration + Node coverage)*
- [x] Default dim still matches pre-v6 constant (`USER_BACKGROUND_DIM_OVERLAY`) when `dim` omitted
- [x] Discrete 9-grid still works; nested layout mirrors discrete position when grid used
- [x] Panel still hides with no `customBackgroundId`
- [x] No intentional panel redesign vs v5.11 / Track A baseline (Phase 0 acceptance)

**Notes:** Phase 0 commit `08a2de5`. Side UI remains legacy; zero intentional visual redesign.


---

## 3 · Direct manipulation (Phase 1+)

- [x] Drag on hero pan updates live preview immediately
- [ ] Live audition (recording) reflects arrangement via hot-swap (`setUserBackgroundLayout`) *(wiring present; full record-path eyeball optional / later parity §9)*
- [x] Focal dot / dashed hover / BG chip affordances present and usable
- [ ] Double-click and Esc reset to center (or documented default) *(confirm if exercised; leave open if not)*
- [x] RAF throttle: no jank during sustained drag on a mid-device session *(operator: usable drag)*
- [x] Persist: layout survives Studio reload / prefs reload *(debounced persist path; operator accepted Phase 1)*

**Notes:** **Operator Phase 1 QA PASS (2026-07-20).** Drag lives on the main Design Studio live preview only. Background panel submenu not remodeled (correct for Phase 1). Commit `1e3118f`.


---

## 4 · Precision widget (Phase 2)

- [x] Mini preview frame tracks hero layout
- [x] Drag on mini frame updates hero + prefs
- [x] Numeric nudges (±0.01 / ±0.05) work and stay in [0,1]
- [x] Bidirectional sync: hero drag → widget numbers; widget → hero
- [ ] X rail is below the mini preview; Y rail is immediately to its right and remains usable at narrow widths
- [ ] Single chevrons communicate ±0.01; doubled chevrons communicate ±0.05 in all four directions
- [ ] Horizontal and vertical physical sliders track their axes, support pointer/keyboard input, and commit once per gesture

**Notes:** Original Phase 2 behavior in `b129713` received user/operator PASS on 2026-07-20. Phase 3 `844a81f` preserves it while reorganizing the controls around the embedded mini-preview; the three new presentation/input rows remain open for operator confirmation.


---

## 5 · Zoom, snap, undo/redo, lock-to-safe-text (Phase 3)

- [ ] Ctrl/Cmd+wheel adjusts `manualScale` at cursor (clamped)
- [ ] Center / thirds / edges sticky-snap with hysteresis (enter harder than exit)
- [ ] Guides match rendered caption band (`lockToSafeText` keeps subject clear of captions)
- [ ] Undo / redo for layout gestures (bounded stack; **not** entangled with subtitle editor undo)
- [ ] Snap off / guides off still allows free position

**Notes:**

Automated math/UI contracts pass in `844a81f`; this section intentionally remains open for real-extension interaction and visual confirmation.


---

## 6 · Properties / effects / GIF (Phase 5+)

- [ ] Scale segmented Fit / Fill / Custom+slider
- [ ] **Dim** slider is a real field (default = old constant; movable)
- [ ] Blur toggle + amount (cheap `ctx.filter`; reset after draw)
- [ ] Each allow-listed blend mode (`source-over`, `multiply`, `overlay`, `screen`, `soft-light`)
- [ ] GIF speed 0.5–2×; `gifReactToAudio` during live audition
- [ ] Reduced-motion still freezes animated GIF to frame 0

**Notes:**


---

## 7 · Presets + eye-dropper (Phase 4–5)

- [ ] Curated presets apply image + scaleMode + position + dim (non-destructive hover preview)
- [ ] Eye-dropper samples via canvas `getImageData` (in-surface; no whole-screen permission)
- [ ] Sampled color hands off to Style / bar color path (`onSampleColor`) without corrupting layout

**Notes:**


---

## 8 · Framing aids (Phase 6)

- [ ] 9:16 and 1:1 crop-guide overlays on the single 16:9 canvas
- [ ] Rule-of-thirds overlay
- [ ] Guides are preview-only (no multi-format export, no second render pipeline)
- [ ] Optional before/after compare (current vs no-background) if shipped

**Notes:**


---

## 9 · Preview ↔ record ↔ bake parity (I1 / I3)

- [ ] Arrange bg on hero → short record → process → bake
- [ ] Preview arrangement matches recorded base pixels (position / scale / dim / blur)
- [ ] Baked output keeps the same background arrangement (bake only burns subtitles)
- [ ] No post-capture path offers “re-position this take’s background”

**Notes:**


---

## 10 · 120 s size — blur + GIF stress

- [ ] ~120 s take with personal bg + blur + animated GIF (if available)
- [ ] Base ≤ **25 MiB** · baked ≤ **30 MiB**
- [ ] Evidence under `artifacts/` + `npm run qa:visual-size` report

| Scene | Base MiB | Baked MiB | Path | Status |
|-------|----------|-----------|------|--------|
| blur + GIF stress | | | | ☐ |

**Notes:**


---

## 11 · a11y (Phase 7)

- [ ] Keyboard-only positioning (arrow nudges; Shift = fine step)
- [ ] +/- scale; Esc reset; Space GIF toggle (if shipped)
- [ ] ARIA live position announcements (or documented equivalent)
- [ ] Guide contrast legible; focus management consistent with Studio sliders/knobs
- [ ] High Contrast / reduced-motion: no broken panel; GIF frozen under reduced-motion

**Notes:**


---

## 12 · Product smoke + Classic / default no-regression

- [ ] Short record → process → bake → download with custom bg + non-default layout
- [ ] Saved profile / style carrying layout fields loads correctly
- [ ] Identity hot-swap does not leave stale layout state
- [ ] Classic / default no-background path unchanged vs v5.11 / Track A close
- [ ] Clip appearance summary / popup still coherent (Track C skin intact)

**Notes:**


---

## Verdict

**Overall:** ☐ open  
**Blockers:** _(_none / list_)_  
**Evidence:** `logs/` · `screenshot/` · `artifacts/`

## Notes

- Phase 0 is intentionally silent visually — do not fail the gate for “no new UI” before Phase 1.
- Rejected over-engineering (must stay rejected): post-capture re-composite · multi-format export · video backgrounds.
