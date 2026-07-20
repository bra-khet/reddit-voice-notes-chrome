# TODO — v6.0.0 QA workspace

**Workspace:** [`qa/QA-6.0.0/`](./) · **Progress:** [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md)<br>
**Active branch:** `feature/v6.0.0-background-panel-refactor` (Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` · Phase 3 `844a81f` · Phase 4 `1166d51`)<br>
**Baseline stable:** v5.11.0 package · Track A + Track C merged  
**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

---

## Status snapshot

| Track | Status | Roadmap | ADR |
|-------|--------|---------|-----|
| **A — audio-reactive visuals** | **Confidence PASS (Pass E) · merged** | [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) | [0007](../../docs/architecture/adr/0007-audio-reactive-visualizer-core.md) · [0009](../../docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) · [0010](../../docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) |
| **B — background layout** | **OPEN · Phase 0–4 DONE · Phase 1–3 operator PASS · Phase 4 operator QA pending · Phase 5 next** | [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) | [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md) **Accepted** |
| **C — popup UI refresh** | **Agent QA gate PASS · merged to `main`** · §8 residual optional ([`track-c/qa-checklist.md`](track-c/qa-checklist.md)) | [`docs/v6.0.0-popup-ui-refresh.md`](../../docs/v6.0.0-popup-ui-refresh.md) | none — presentational under 0007 tokens |

**Automated (Track B Phase 0–4):** focused layout/interaction/UI set **62/62** (layout 10 · direct-manipulation 8 · precision 5 · interaction utils 6 · control UI 9 · presets 5 · caption geometry 7 · prefs storage 12) · `npm run build` **PASS** · compile only the same 2 pre-existing subtitle diagnostics.

**Architecture at Track A confidence close:** map **v3.21** / I22 · extension-points **v1.35** · package version remains **5.11.0** until an explicit v6 ship/tag. Track B architecture MINOR bumps deferred to merge closeout (§9).

---

## Active — Track B

**Branch:** `feature/v6.0.0-background-panel-refactor`  
**QA:** [`track-b/README.md`](track-b/README.md) · [`track-b/qa-checklist.md`](track-b/qa-checklist.md)

### Scaffold — **DONE**

- [x] Fast-forward feature branch to current `main` (post A + C)
- [x] Checkout `feature/v6.0.0-background-panel-refactor`
- [x] Open `track-b/` (README + checklist + evidence dirs)
- [x] Flip workspace + root living-doc status to Track B open
- [x] Accept ADR-0008 (implementation track open)

### Implementation backlog (roadmap §7)

- [x] **Phase 0** — types + `normalizeUserBackgroundLayout` + `customPosition` offset path + field `dim` + Node `test-background-layout.mjs` (zero visual change) · commit `08a2de5`
- [x] **Phase 1** — direct canvas drag + focal affordances on hero preview · commit `1e3118f` · **operator QA PASS** (2026-07-20)
- [x] **Phase 2** — precision mini-preview + shared drag controller + X/Y ±0.01/±0.05 nudges + bidirectional hero/widget sync · commit `b129713` · **operator behavior QA PASS** (2026-07-20)
- [x] **Phase 3** — spatial positioning console + `interaction-utils.ts` + cursor-anchored zoom / sticky snap / caption-safe lock / bounded undo-redo · commit `844a81f` · **operator QA PASS** (2026-07-20); final Y-up order `.01` then `.05`
- [x] **Phase 4** — four bundled image/layout presets + non-destructive hover/focus live preview + explicit Apply · commit `1166d51` · operator §7 pending
- [ ] **Phase 5** — properties/effects + eye-dropper
- [ ] **Phase 6** — multi-aspect crop guides + compare
- [ ] **Phase 7** — keyboard / ARIA / variants + confidence QA

**Immediate next:** operator-check Phase 4 checklist §7, then implement Phase 5 properties/effects + eye-dropper.

### Phase gates (partial)

| Gate | Status |
|------|--------|
| Phase 0 automated (layout math) | **PASS** 10/10 |
| Phase 1+3 automated (drag/zoom math) | **PASS** 8/8 |
| Phase 1 operator UI (hero drag) | **PASS** (user) |
| Phase 2 automated (precision nudge math) | **PASS** 5/5 |
| Phase 2 operator behavior (mini frame + bidirectional sync) | **PASS** (user) |
| Phase 3 automated (interaction/UI/caption contracts) | **PASS** 19/19 |
| Phase 3 operator UI (spatial console + zoom/snap/safe/history) | **PASS** (user) |
| Phase 4 automated (preset catalog + contact sheet behavior) | **PASS** 14/14 |
| Phase 4 operator UI (hover/focus restore + Apply + live audition) | **open** |
| Full Track B checklist merge gate | **open** (Phase 4 operator + Phase 5–7 + parity/size still ahead) |

### Non-negotiables (Track B)

- Design-phase pre-capture only (I1/I3) — no post-capture bg re-position
- Additive prefs — no `USER_PREFS_VERSION` bump
- No new deps / WASM / fourth compositing layer
- No bake-size / FPS / legibility regression vs v5.11.0 on default/Classic
- Multi-aspect = crop guides on 16:9, not multi-format export

---

## Closed — Track A Phase 4 confidence (Pass E)

**Operator UI:** [`track-a/qa-checklist.html`](track-a/qa-checklist.html)  
**Evidence packet:** `track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json`  
**Operator:** bra-khet · **Date:** 2026-07-19 · **Machine:** Win 10, RTX 4050 Laptop · **Browser:** Chrome 150 · **Build:** `.output/chrome-mv3-dev/`

Full section checklist remains in git history / prior ledger revisions; verdict **PASS · blockers none**.  
**Accepted residual:** Conway long-horizon corner parking under multi-entity motion (documented in `conway.ts`; not a merge blocker).

---

## Closed — Track C agent gate

**Checklist:** [`track-c/qa-checklist.md`](track-c/qa-checklist.md) · **Evidence:** `track-c/logs/computed-style-qa-2026-07-19.json`  
**Verdict:** agent gate §1–§7 **PASS** · merged to `main` · §8 real-extension eyeball residual optional.

---

## Done (prior tracks)

- ✅ Track A Phase 0–4 full catalog + Style panel + governor + fixture QA + Pass A–E live confidence
- ✅ Track C popup-only Cividis skin + elevated restart caution + tokens guard + fixture + agent gate
- ✅ Track B branch FF + QA scaffold
- ✅ Track B Phase 0 layout core + Phase 1 hero direct drag + Phase 2 precision widget + Phase 3 positioning console/zoom/snap/safe/history (operator Phase 1–3 QA PASS) + Phase 4 bundled presets/live audition (operator QA pending)
