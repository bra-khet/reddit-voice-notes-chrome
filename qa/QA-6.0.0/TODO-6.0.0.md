# TODO — v6.0.0 QA workspace

**Workspace:** [`qa/QA-6.0.0/`](./) · **Progress:** [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md)  
**Branch:** `feature/v6.0.0-custom-styles-refactor`  
**Baseline stable:** v5.11.0 (`main@98c37ab` ancestry)  
**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

---

## Status snapshot

| Track | Status | Roadmap | ADR |
|-------|--------|---------|-----|
| **A — audio-reactive visuals** | Phase 4 **implemented** · focused fixture QA PASS · **live confidence QA open** | [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) | [0007](../../docs/architecture/adr/0007-audio-reactive-visualizer-core.md) · [0009](../../docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) · [0010](../../docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) |
| **B — background layout** | **Not started** (branch may exist; do not open QA until A confidence close) | [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) | [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md) |

**Automated (re-run 2026-07-19 after the Pass D fix sprint):** all **57 Node suites PASS** · `npm run build` PASS · `npm run compile` = same 2 pre-existing subtitle diagnostics.

**Pass A+B fixes landed 2026-07-19** (commits `2598815..aaf0bb3`) · **Pass C operator QA PASSED** + polish sprint (`3ba5a26..820a2e8`) · **Pass D operator QA PASSED** ("visuals nearly perfect") · **Pass D fix sprint landed** (commits `26f3a0c..c184985`, 8 commits; see `progress-QA-6.0.0.md`). Open re-QA items for Pass E:
- [ ] Oscilloscope — live capture at normal speech now ≈ preview activity (waveform AGC); preview ~half its old clipped level
- [ ] Inferno — front layers carry vertical heat ramps; licks are born with stretched tendril bottoms that retract into a point; Void toggle now lives under the Atmosphere picker
- [ ] Line tapers everywhere flat segments remained: smoke HC spines · ember HC trails · aurora fold-spine ends / HC source lines / ring cross-fade · particle-burst trails+rays · inferno sparks
- [ ] Size gate: one 120 s digital-rain re-run — baked should now land ~35 MiB (bitrate pin 1.5 → 2.2 Mbps) under the 40 MiB cap
- [ ] Digital Rain follow-up (`882a61e`): streams no longer fade / re-light mid-fall with the live drive — spawn-gated only, spawn-residual brightness for the whole pass
- [ ] Glitch photosensitivity hardening (`87efdb0`, HIGH PRIORITY): invert cadence must feel stochastic (full hits ≥ 340 ms apart interleaved with soft eased ramps — never a strobe); saturated-red user palettes desaturate; selection-card courtesy note present
- [ ] Conway Life stagnation detector (`f231938`): let a Conway scene run through several speech pauses and confirm the field no longer parks on a still-life tapestry or blinker — it should keep churning while you talk, and stay honestly still during silence (the nudge is gated at `drive > 0.02`). Watch for the opposite failure too: the nudge should read as the colony reorganising, never as cells "popping" in at a visible cadence
- [ ] Note: visual-fixture dev server moved to **port 9310** (8600 also fell into a Windows excluded-port range after reboot)

**Architecture at Phase 4:** map **v3.21** / I22 · extension-points **v1.35** · confidence stays **Medium** until live capture/FPS + 120 s heavy-artifact reports land.

---

## Active — Track A Phase 4 confidence close

**Operator UI:** [`track-a/qa-checklist.html`](track-a/qa-checklist.html) (open in browser; export JSON for agents)  
Reference matrix: [`track-a/qa-checklist.md`](track-a/qa-checklist.md)  
Evidence: [`track-a/logs/`](track-a/logs/) · [`track-a/screenshot/`](track-a/screenshot/) · [`track-a/artifacts/`](track-a/artifacts/)

### Pre-flight
- [ ] Load / reload extension from this branch; confirm Style panel (not legacy bar-style)
- [ ] Note browser + machine; open SW / Studio / Reddit consoles as needed

### Live reactive capture matrix
- [ ] Preview = representative motion; record = true voice reactivity; bake = identical bars/overlays (I1/I3 — bake never re-renders them)
- [ ] Smoke each spectrum: Classic · Minimal · Phosphor · Radial · Central Pulse · Oscilloscope
- [ ] Smoke each atmosphere: Sparkle · Bubbles (`bokeh` ID) · Forest Spirits · Digital Rain · Inferno · Aurora · Glitch
- [ ] Smoke stackables solo + one ordered three-stack; max-three + governor pause/restore
- [ ] Audio axes: silence · normal speech · loud/sibilant · Oscilloscope waveform path

### FPS / governor / a11y
- [ ] Mid-device FPS on heavy scenes; Detail Comfortable → Elevated → Guarded warnings + one-accent pause
- [ ] High Contrast + reduced-motion on a representative spectrum + overlay + stackable
- [ ] Keyboard Detail + preset pickers; caption-safe dim below captions

### 120 s size gate (hard ceiling: base ≤40 MiB · baked ≤40 MiB — raised from 25/30 per Pass A §8-12)
All **PASSED** in operator Pass C (2026-07-19); reports under `track-a/artifacts/<scene>/`:
- [x] Digital Rain — 19 / 25 MiB
- [x] Aurora — 11 / 25 MiB
- [x] Glitch — 10 / 23 MiB
- [x] Inferno — 13 / 25 MiB
- [x] Heavy three-stack (inferno + conway/smoke/particle-burst) — 18 / 25 MiB

```bash
npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
```

### Product smoke (v6 Style path)
- [ ] Short record → process → bake → download still works with a non-default Style
- [ ] Saved style / profile with `sparkle` / `bokeh` loads Sparkle / Bubbles (label ≠ ID for Bubbles)
- [ ] Identity hot-swap does not leave stale visual state

### Open notes / triage (from early dumps)
- [ ] Triage `track-a/logs/notes-before-bed-1.txt` — voice re-apply / Change Voice path after a take (may be pre-existing or environment; classify before treating as v6 blocker)
- [ ] Review offscreen transcode fail/success pair in `track-a/logs/` if still relevant

---

## Deferred — Track B

Do **not** expand this section into a checklist until Track A confidence close (or explicit user go-ahead).

- Placeholder: [`track-b/README.md`](track-b/README.md)
- Scope when open: direct drag/zoom/snap on hero preview; `dim`→field; `customPosition`; `interaction-utils.ts`

---

## Done (implementation — not re-QA unless regressions)

- ✅ Phase 0–3 full catalog (6 spectrum · 7 overlay · 7 stackable) + registry runtime
- ✅ Phase 4 Style Control Center + `maxElements` governor + caption-safe dim
- ✅ Focused desktop/mobile fixture QA (overflow fix, keyboard Detail, max-three/governor)
- ✅ Automated **226/226** + production build PASS

---

## Non-negotiables (fail the gate)

- Capture-time visuals only (no bake re-render of bars/overlays)
- No bake-size / FPS / legibility regression vs v5.11.0 on default/Classic
- No new deps / WASM / fourth compositing layer / `USER_PREFS_VERSION` bump
