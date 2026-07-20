# TODO — v6.0.0 QA workspace

**Workspace:** [`qa/QA-6.0.0/`](./) · **Progress:** [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md)  
**Active branch:** `feature/v6.0.0-background-panel-refactor` (FF from `main@2b42db5`)  
**Baseline stable:** v5.11.0 package · Track A + Track C merged  
**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

---

## Status snapshot

| Track | Status | Roadmap | ADR |
|-------|--------|---------|-----|
| **A — audio-reactive visuals** | **Confidence PASS (Pass E) · merged** | [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) | [0007](../../docs/architecture/adr/0007-audio-reactive-visualizer-core.md) · [0009](../../docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) · [0010](../../docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) |
| **B — background layout** | **OPEN · scaffold ready · implementation not started** | [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) | [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md) **Accepted** |
| **C — popup UI refresh** | **Agent QA gate PASS · merged to `main`** · §8 residual optional ([`track-c/qa-checklist.md`](track-c/qa-checklist.md)) | [`docs/v6.0.0-popup-ui-refresh.md`](../../docs/v6.0.0-popup-ui-refresh.md) | none — presentational under 0007 tokens |

**Automated (last full re-run at Track A close):** all **57 Node suites PASS** · `npm run build` PASS · `npm run compile` = same 2 pre-existing subtitle diagnostics.

**Architecture at Track A confidence close:** map **v3.21** / I22 · extension-points **v1.35** · package version remains **5.11.0** until an explicit v6 ship/tag.

---

## Active — Track B

**Branch:** `feature/v6.0.0-background-panel-refactor`  
**QA:** [`track-b/README.md`](track-b/README.md) · [`track-b/qa-checklist.md`](track-b/qa-checklist.md)

### Scaffold (this sprint) — **DONE**

- [x] Fast-forward feature branch to current `main` (post A + C)
- [x] Checkout `feature/v6.0.0-background-panel-refactor`
- [x] Open `track-b/` (README + checklist + evidence dirs)
- [x] Flip workspace + root living-doc status to Track B open
- [x] Accept ADR-0008 (implementation track open)

### Implementation backlog (roadmap §7)

- [ ] **Phase 0** — types + `normalizeUserBackgroundLayout` + `customPosition` offset path + field `dim` + Node `test-background-layout.mjs` (zero visual change)
- [ ] **Phase 1** — direct canvas drag + focal affordances
- [ ] **Phase 2** — precision widget + bidirectional sync
- [ ] **Phase 3** — `interaction-utils.ts` (zoom / sticky snap / undo)
- [ ] **Phase 4** — presets row + live hover preview
- [ ] **Phase 5** — properties/effects + eye-dropper
- [ ] **Phase 6** — multi-aspect crop guides + compare
- [ ] **Phase 7** — keyboard / ARIA / variants + confidence QA

**Immediate next:** Phase 0 `layout-core` only.

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
- ✅ Track B branch FF + QA scaffold (this sprint)
