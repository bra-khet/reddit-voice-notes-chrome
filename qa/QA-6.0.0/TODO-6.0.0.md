# TODO — v6.0.0 QA workspace

**Workspace:** [`qa/QA-6.0.0/`](./) · **Progress:** [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md)<br>
**Active branch:** `feature/v6.0.0-background-panel-refactor` (Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` · Phase 3 `844a81f` · Phase 4 `1166d51` · Phase 5 `16e3dd0` · Phase 6 `e7346ca`)<br>
**Baseline stable:** v5.11.0 package · Track A + Track C merged  
**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

---

## Status snapshot

| Track | Status | Roadmap | ADR |
|-------|--------|---------|-----|
| **A — audio-reactive visuals** | **Confidence PASS (Pass E) · merged** | [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) | [0007](../../docs/architecture/adr/0007-audio-reactive-visualizer-core.md) · [0009](../../docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) · [0010](../../docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) |
| **B — background layout** | **OPEN · Phase 0–7 DONE · operator Phase 1–6 + size/parity/a11y baseline PASS · final presentation/product closeout** | [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) | [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md) **Accepted** |
| **C — popup UI refresh** | **Agent QA gate PASS · merged to `main`** · §8 residual optional ([`track-c/qa-checklist.md`](track-c/qa-checklist.md)) | [`docs/v6.0.0-popup-ui-refresh.md`](../../docs/v6.0.0-popup-ui-refresh.md) | none — presentational under 0007 tokens |

**Automated (Track B through Phase 7):** focused layout/interaction/UI set **88/88** · UI tokens PASS · visual-size gate logic 5/5 · `npm run build` **PASS** · compile only the same 2 pre-existing subtitle diagnostics. Real blur/GIF gate **23/29 MiB PASS**.

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
- [x] **Phase 4** — four bundled image/layout presets + non-destructive hover/focus live preview + explicit Apply · commit `1166d51` · **operator QA PASS** (2026-07-20); recording-time hover caveat guarded in Phase 5
- [x] **Phase 5** — dim/blur/blend treatment bay + GIF speed/audio reactivity + in-canvas eye-dropper + recording-safe preset lockout · commit `16e3dd0` · original operator §6 PASS
- [x] **Phase 5 follow-up** — spatial Y-key semantics; recorder-session layout authority/no redundant image reload; sampler-owned hero interaction + miss guidance; burn/dodge/difference; opt-in Canvas 2D Holo drift · **operator core recheck PASS**
- [x] **Phase 5 residual — blend plate (P0 visual)** — normalized six-source draw-time solid (legacy/theme tint/bar/mid-gray/soft-white/custom HSV+HEX), one fill beneath image, dim after, no second image · operator PASS
- [x] **Phase 5 follow-up (eye-dropper gap)** — hero + precision surface/canvas pairs, mini crosshair chrome, shared miss/cancel exits · operator PASS
- [x] **Phase 5 size gate** — required blur/GIF stress **23 MiB base / 29 MiB baked — PASS**; upper-end non-blur observation 28/35 MiB recorded as informational
- [x] **Phase 6** — native/1:1/9:16 hero crop lab + independent thirds + transient Theme-only compare + restore/decode guard · commit `e7346ca` · crop/thirds operator PASS
- [x] **Phase 6 Theme-only follow-up** — null-image preview clock, hard preset mutex, single `finishCompare` restore owner, explicit current-look copy · operator recheck PASS
- [x] **Phase 7** — coarse/fine preview keyboard + +/- zoom/Esc; `aria-valuetext` + polite X/Y/zoom status; session-only next-take A/B framing; responsive Position Preview (panel + viewport bounded) · focused 88/88

**Immediate next:** operator-check the resized Position Preview and Save variant → change → Swap A/B flow, optionally listen to the live announcement, then close saved-profile/identity/Classic/popup product smoke.

**Non-blocking performance note:** subtitle browser-composite/burn-in reportedly runs roughly **5–6× faster while the Studio window is minimized**. Not breaking and out of Track B Phase 6 scope; investigate later for focused-window RAF/render contention, scheduling, or GPU-throttling interaction before treating it as an optimization.

### Phase gates (partial)

| Gate | Status |
|------|--------|
| Phase 0 automated (layout math) | **PASS** 10/10 |
| Phase 1+3+7 automated (drag/zoom/keyboard math) | **PASS** 10/10 |
| Phase 1 operator UI (hero drag) | **PASS** (user) |
| Phase 2 automated (precision nudge math) | **PASS** 5/5 |
| Phase 2 operator behavior (mini frame + bidirectional sync) | **PASS** (user) |
| Phase 3 automated (interaction/UI/caption contracts) | **PASS** 19/19 |
| Phase 3 operator UI (spatial console + zoom/snap/safe/history) | **PASS** (user) |
| Phase 4 automated (preset catalog + contact sheet behavior) | **PASS** 14/14 |
| Phase 4 operator UI (hover/focus restore + Apply + live audition) | **PASS** (user; recording caveat guarded in `16e3dd0`) |
| Phase 5 automated (effects/GIF/sampler/recording guard + residual) | **PASS** · included in focused total 83/83 |
| Phase 5 operator UI + recording-safety smoke | **PASS** · blend plate + precision sampler + size gate closed |
| Phase 6 automated | **PASS** · framing/compare/loop policy + preset mutex + recording restore contract |
| Phase 6 operator UI | **PASS** · crop/thirds + Theme-only motion/mutex/record restore |
| Phase 7 automated | **PASS** · focused total 88/88 + build; responsive/ARIA/A-B contracts covered |
| Phase 7 operator baseline | **PASS** · keyboard/scaling/reset/high-contrast/reduced-motion; new presentation recheck open |
| Preview→record→bake parity | **PASS** (user/operator) |
| Full Track B checklist merge gate | **open** (Phase 7 presentation + remaining product-smoke rows) |

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
- ✅ Track B Phase 0 layout core + Phase 1 hero direct drag + Phase 2 precision widget + Phase 3 positioning console/zoom/snap/safe/history + Phase 4 bundled presets/live audition + Phase 5 effects/GIF/no-flash/blends/Holo/plate/sampling (operator PASS + size PASS) + Phase 6 framing aids/compare (operator recheck pending)
