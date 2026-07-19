# Progress — v6.0.0 QA

**Living session file for this workspace only.**  
**TODO ledger:** [`TODO-6.0.0.md`](TODO-6.0.0.md) · **Checklist:** [`track-a/qa-checklist.md`](track-a/qa-checklist.md)  
**Root pointers:** [`claude-progress.md`](../../claude-progress.md) · [`TODO.md`](../../TODO.md)

Do not dump long QA narrative into the global progress file — update a short verdict + path there when a gate closes.

---

## Context (read once)

| | |
|--|--|
| **Branch** | `feature/v6.0.0-custom-styles-refactor` (stay on this branch for Track A QA) |
| **Stable baseline** | v5.11.0 prefs IDB · tagged; push deferred |
| **Track A roadmap** | [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md) §9 QA matrix · §11 item 23 |
| **Track B** | Not started · [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) |
| **ADRs** | 0007 (core) · 0009 (registry Sparkle/Bubbles) · 0010 (Bubbles label / `bokeh` key) |
| **Architecture** | map **v3.21** / I22 · seams **v1.35** · confidence **Medium** until this QA closes |
| **Key product fact** | Bars + overlays paint at **record time** (`WaveformRenderer.drawFrame` → `captureStream`). Bake only burns subtitles (I3). Studio preview is **representative** (synthetic bands/energy); capture is **truly reactive**. |

**Already proven (do not re-prove unless a fix lands):**

- Full curated catalog + Style Control Center + governor
- Focused fixture browser QA (desktop + narrow; max-three; keyboard Detail; overflow fix)
- Automated focused v6 set **226/226** · build PASS · tsc = 2 pre-existing subtitle diagnostics

**Still open (this workspace’s job):**

1. Live reactive capture / FPS / a11y matrix  
2. Real **120 s** heavy-preset + three-stack size reports (`npm run qa:visual-size`)  
3. Raise confidence / release readiness only after both land  

---

## Session log

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

## Verdict (update when Track A confidence close finishes)

| Gate | Result | Date |
|------|--------|------|
| Live capture / FPS / a11y | ☐ open | — |
| 120 s heavy size reports | ☐ open | — |
| **Track A overall** | ☐ open | — |

**Key:** ■ PASS · □ FAIL · ▲ PARTIAL · ☐ open
