# TODO — v6.0.0 QA workspace

**Workspace:** [`qa/QA-6.0.0/`](./) · **Progress:** [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md)  
**Branch:** `feature/v6.0.0-custom-styles-refactor` → **merged to `main` (Track A confidence close)**  
**Baseline stable:** v5.11.0 (`main@98c37ab` ancestry)  
**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

---

## Status snapshot

| Track | Status | Roadmap | ADR |
|-------|--------|---------|-----|
| **A — audio-reactive visuals** | Phase 4 **implemented** · fixture QA PASS · **live confidence QA PASS (Pass E 2026-07-19)** | [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) | [0007](../../docs/architecture/adr/0007-audio-reactive-visualizer-core.md) · [0009](../../docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) · [0010](../../docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) |
| **B — background layout** | **Not started** (open when ready; Track A no longer blocks) | [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) | [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md) |
| **C — popup UI refresh** | **Agent QA gate PASS (2026-07-19) · merged to `main`** · §8 residual optional ([`track-c/qa-checklist.md`](track-c/qa-checklist.md)) | [`docs/v6.0.0-popup-ui-refresh.md`](../../docs/v6.0.0-popup-ui-refresh.md) | none — presentational under 0007 tokens |

**Automated (last full re-run through Conway stagnation land):** all **57 Node suites PASS** · `npm run build` PASS · `npm run compile` = same 2 pre-existing subtitle diagnostics.

**Operator QA arc (2026-07-19):** Pass A+B fixes · Pass C **PASSED** (size gates) · Pass D **PASSED** ("visuals nearly perfect") + polish · Pass D follow-ups (rain residual/density, glitch photosafety, Conway stagnation) · **Pass E full PASS** — packet [`track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json`](track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json) · overall `pass` · blockers **None**.

**Architecture at confidence close:** map **v3.21** / I22 · extension-points **v1.35** · confidence **High** for Track A live capture path (package version remains **5.11.0** until an explicit v6 ship/tag decision).

---

## Closed — Track A Phase 4 confidence (Pass E)

**Operator UI:** [`track-a/qa-checklist.html`](track-a/qa-checklist.html)  
**Evidence packet:** `track-a/artifacts/qa-session-track-a-pass-e-2026-07-17.json`  
**Operator:** bra-khet · **Date:** 2026-07-19 · **Machine:** Win 10, RTX 4050 Laptop · **Browser:** Chrome 150 · **Build:** `.output/chrome-mv3-dev/`

### Pre-flight — **PASS**
- [x] Load / reload extension; Style panel (not legacy bar-style)
- [x] Browser / machine noted; SW / Studio clean on load

### Live reactive capture matrix — **PASS**
- [x] Preview = representative; record = true voice reactivity; bake = identical bars/overlays (I1/I3)
- [x] Smoke each spectrum: Classic · Minimal · Phosphor · Radial · Central Pulse · Oscilloscope
- [x] Smoke each atmosphere: Sparkle · Bubbles (`bokeh`) · Forest Spirits · Digital Rain · Inferno · Aurora · Glitch
- [x] Smoke stackables solo + ordered three-stack; max-three + governor pause/restore
- [x] Audio axes: silence · normal speech · loud/sibilant · Oscilloscope waveform path

### FPS / governor / a11y — **PASS**
- [x] Mid-device FPS / Detail Comfortable → Elevated → Guarded
- [x] High Contrast + reduced-motion on representative spectrum + overlay + stackable
- [x] Keyboard Detail + preset pickers; caption-safe dim below captions

### 120 s size gate (base ≤40 MiB · baked ≤40 MiB) — **PASS**
Pass E packet + Pass C reports (operator figures; under cap):

| Scene | Base / Baked (MiB) |
|-------|--------------------|
| Digital Rain | ~30 / 25 |
| Aurora | 11 / 25 |
| Glitch | 10 / 23 |
| Inferno | 13 / 25 |
| Heavy three-stack | 18 / 25 |

### Product smoke (v6 Style path) — **PASS**
- [x] Short record → process → bake → download with non-default Style
- [x] Saved style / profile with `sparkle` / `bokeh` loads correctly
- [x] Identity hot-swap does not leave stale visual state
- [x] Classic / default no-regression vs v5.11

### Early-log triage — **PASS** (classified non-blocking for Track A visuals)
- [x] `notes-before-bed-1.txt` / offscreen transcode pair reviewed in Pass E section 15

### Pass E re-QA items (post–Pass D polish) — **PASS**
- [x] Oscilloscope live ≈ preview (waveform AGC)
- [x] Inferno heat ramps / tendril licks / Void under Atmosphere
- [x] Line tapers (smoke · ember · aurora · particle-burst · inferno sparks)
- [x] Digital Rain residual brightness + edge sustain + denser spawn
- [x] Glitch photosensitivity (stochastic invert, red desat, card note)
- [x] Conway stagnation detector under speech / silence (see accepted residual below)

---

## Accepted residual (not a merge blocker)

**Conway Life — long-horizon corner parking (Pass E operator note):** after a rather long time, with multiple independent colonies still moving, life can still park in a dead-edge corner. The whole-grid period-1/period-2 stagnation detector (`f231938`) only fires when the *entire* field is frozen, so motion elsewhere masks corner attractors. Documented in `src/theme/audio-reactive/stackables/conway.ts` (`trackStagnation` KNOWN LIMIT) and progress session log. Elevate only if a future pass wants regional/spatial stagnation.

---

## Deferred — Track B

Track A confidence close no longer blocks opening B.

- Placeholder: [`track-b/README.md`](track-b/README.md)
- Scope when open: direct drag/zoom/snap on hero preview; `dim`→field; `customPosition`; `interaction-utils.ts`

---

## Done (implementation + confidence)

- ✅ Phase 0–3 full catalog (6 spectrum · 7 overlay · 7 stackable) + registry runtime
- ✅ Phase 4 Style Control Center + `maxElements` governor + caption-safe dim
- ✅ Focused desktop/mobile fixture QA
- ✅ Live confidence matrix Pass A–E (Pass E full pass, blockers none)
- ✅ Automated Node suites + production build PASS through confidence close

---

## Non-negotiables (held at Pass E)

- Capture-time visuals only (no bake re-render of bars/overlays)
- No bake-size / FPS / legibility regression vs v5.11.0 on default/Classic
- No new deps / WASM / fourth compositing layer / `USER_PREFS_VERSION` bump
