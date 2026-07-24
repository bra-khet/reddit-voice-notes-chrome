# Track A — Phase 4 confidence QA checklist

**Sprint:** v6.0.0 Track A — audio-reactive Style / governor confidence close  
**Branch:** `feature/v6.0.0-custom-styles-refactor`  
**Roadmap:** [archived Track A roadmap](../../../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-custom-styles-refactor.md) §9 · §11 item 23
**ADRs:** [0007](../../../docs/architecture/adr/0007-audio-reactive-visualizer-core.md) · [0009](../../../docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) · [0010](../../../docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md)  
**Workspace TODO / progress:** [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md)  
**Interactive guide (primary fill-in surface):** [`qa-checklist.html`](qa-checklist.html) — open in a browser; autosaves; export JSON for agents  
**Machine / browser:** _(_fill in HTML session meta_)_  
**Date:** _(_fill in_)_  
**Build:** load `.output/chrome-mv3-dev/` (or prod) from this branch  

**Why this gate exists:** Phase 4 Style Control Center + shared `maxElements` governor are implemented and fixture-QA’d. Architecture confidence stays **Medium** (map **v3.21** / I22 · seams **v1.35**) until **live reactive capture**, **device FPS**, **a11y**, and **real 120 s encoded-size** evidence land. Visuals are **capture-time only** (I1/I3); bake must not re-paint bars/overlays.

**Merge / release when:** required sections PASS (or FAIL with notes + no ship).  
**Automated already green:** focused v6 **226/226** · `npm run build` PASS · `npm run compile` = 2 pre-existing subtitle diagnostics. Do **not** re-run these unless a code fix lands.

### Non-negotiables (any FAIL here fails the gate)

| Rule | Source |
|------|--------|
| Capture-time visuals only — bake never re-renders bars/overlays | I1/I3 · ADR-0007 |
| No bake-size / FPS / legibility regression vs **v5.11.0** on default/Classic | roadmap §9 success metrics |
| No new deps / WASM / fourth compositing layer / `USER_PREFS_VERSION` bump | ADR-0007 · Track A non-negotiables |
| Bubbles UI label + stable persisted ID `bokeh` (not a migration) | ADR-0010 |
| Governor may **pause** an accent; must **not** rewrite the saved selection list | Phase 4 as-built |

### Governor thresholds (as-built)

Estimated paint work from definition `maxElements`: **Comfortable ≤560** · **Elevated ≤980** · **Guarded >980**. Guarded suspends the most expensive selected accent in preview **and** capture without mutating saved accents.

---

## How to use

### Preferred: interactive HTML

1. Open [`qa-checklist.html`](qa-checklist.html) in Chrome (double-click or `file://`).
2. Fill **Session** (machine, browser, date, build path, operator).
3. Work section by section: set item status, write notes, attach evidence paths.
4. State **autosaves in this browser** (`localStorage`). Export **Agent packet (JSON)** when you want another agent (or a later you) to ingest results — drop the JSON under `artifacts/` or paste into chat.
5. Optional: **Copy agent brief** puts a short markdown summary on the clipboard for a chat handoff.

### Fallback: this markdown

1. Prefer a **dev build** so governor / size / Style logs are visible.
2. Reload the extension after every rebuild.
3. Tick `- [ ]` → `- [x]`; jot evidence paths under **Notes** (`logs/`, `screenshot/`, `artifacts/`).
4. Consoles: Service worker · Design Studio · Reddit tab (for capture path).
5. Size gate command (short smokes **cannot** pass):

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

6. Caps: base ≤ **40 MiB** · baked ≤ **40 MiB** · duration ~**120 s** for heavy reports.

### What to bring back on FAIL

| Item | Why |
|------|-----|
| Section # + checkbox / item id | Locates the gate |
| UI symptom + preset IDs (spectrum / overlay / stackables / Detail) | Product surface |
| SW + Studio + offscreen console excerpts | Capture / transcode / governor |
| Paths to screenshot / artifact / harness report | Repro |
| Whether reduced-motion / High Contrast / mobile width was on | Context |

### Evidence layout (Option 2 gitignore — process tracked, blobs ignored)

| Path | What goes here | Git? |
|------|----------------|------|
| `logs/` | Console dumps, free-form notes | ignored |
| `screenshot/` | UI / DevTools images | ignored |
| `artifacts/` | 120 s MP4s + `qa:visual-size` text/JSON + exported agent packets | ignored |
| `qa-checklist.md` / `qa-checklist.html` | Process structure | tracked |

---

## Progress summary

| # | Section | Status | Notes |
|---|---------|--------|-------|
| 0 | Pre-flight | ☐ | |
| 1 | Preview ↔ capture ↔ bake parity (I1/I3) | ☐ | |
| 2 | Spectrum smoke (6) | ☐ | |
| 3 | Atmosphere smoke (7) | ☐ | |
| 4 | Accents / stackables + max-three + governor | ☐ | |
| 5 | Audio axes (silence / speech / loud / Oscilloscope) | ☐ | |
| 6 | FPS + Detail governor (Comfortable → Guarded) | ☐ | |
| 7 | a11y (High Contrast · reduced-motion · keyboard) | ☐ | |
| 8 | 120 s size — Digital Rain (`digital-rain`) | ☐ | |
| 9 | 120 s size — Aurora (`aurora`) | ☐ | |
| 10 | 120 s size — Glitch (`glitch`) | ☐ | |
| 11 | 120 s size — Inferno (`inferno`) | ☐ | |
| 12 | 120 s size — heavy three-stack | ☐ | |
| 13 | Saved styles / hot-swap / Bubbles label | ☐ | |
| 14 | Product smoke wrap | ☐ | |
| 15 | Early-log triage (optional) | ☐ | voice re-apply note |
| 16 | Classic / default no-regression vs v5.11 | ☐ | ship metric |

**Overall:** ☐ open  

**Key:** ■ PASS · □ FAIL · ▲ PARTIAL · ☐ open  

---

## 0 · Pre-flight

- [ ] Branch is `feature/v6.0.0-custom-styles-refactor` (or equivalent v6 Track A build loaded)
- [ ] Extension reloaded from `.output/chrome-mv3-dev/` (or prod); no red errors on load (SW / offscreen)
- [ ] Design Studio opens; **Style** section present with order **Atmosphere → Accents → Spectrum → Captions** (not legacy “Bar Style”)
- [ ] Detail / High Contrast / caption-safe dim controls visible
- [ ] Evidence folders ready: `logs/` · `screenshot/` · `artifacts/`

**Notes:**


---

## 1 · Preview ↔ capture ↔ bake parity (I1 / I3 / I22)

Mental model: Studio Live preview = **representative** (synthetic energy ~0.32 + `PREVIEW_BAND_LEVELS`). Capture = **true** mic reactivity via `WaveformRenderer.drawFrame` → `captureStream`. Bake = **identical** bars/overlays + captions only (I3).

For at least one static-ish preset (e.g. **Classic** / `classic-neon` or **Minimal** / `minimal`) **and** one reactive atmosphere (e.g. **Digital Rain** / `digital-rain` or **Sparkle** / `sparkle`):

- [ ] Studio Live preview shows **representative** motion (not dead; not claiming live mic)
- [ ] Short recording reacts to **voice** (bars/overlays move with speech)
- [ ] After process/bake, base/baked frame still shows the **same** bars/overlays (bake only adds captions)
- [ ] Captions sit above visuals; caption-safe dim (if on) does not crush legibility

**Notes:**


---

## 2 · Spectrum smoke (all six)

Registry IDs in backticks. Record a short take or rely on preview + one short capture per family as needed:

- [ ] Classic / Neon Glow (`classic-neon`) — default/fallback; no-change feel for Classic users
- [ ] Minimal (`minimal`)
- [ ] Phosphor (`phosphor`)
- [ ] Radial Spectrum (`radial-spectrum`)
- [ ] Central Pulse (`central-pulse`)
- [ ] Oscilloscope (`oscilloscope`) — linear and/or circular if exposed; must engage **waveform** path (not bars)

**Notes:**


---

## 3 · Atmosphere smoke (all seven)

- [ ] Sparkle (`sparkle`) — v6 algorithm (ADR-0009); not legacy placeholder pixels
- [ ] Bubbles (`bokeh` ID · UI label **Bubbles** — ADR-0010)
- [ ] Forest Spirits (`forest-spirits`)
- [ ] Digital Rain (`digital-rain`)
- [ ] Inferno (`inferno`) — Void Inferno via High Contrast if tested here or in §7
- [ ] Aurora (`aurora`)
- [ ] Glitch (`glitch`)

**Notes:**


---

## 4 · Accents · max-three · governor

Stackable IDs: `ember` · `electric-arc` · `lightning` · `conway` · `smoke` · `neon-glow` · `particle-burst` · hard cap **3** (`MAX_STACKABLE_EFFECTS`).

- [ ] Each stackable solo briefly OK: Rising Ember · Electric Arc · Lightning · Conway · Smoke · Neon Glow · Particle Burst
- [ ] Ordered **three-stack** accepts; fourth selection blocked or unlocks by removing one
- [ ] High Detail / expensive scene → **Guarded** warning; one expensive accent **paused** (saved list retained)
- [ ] Lower Detail restores paused accent in preview **and** would apply on next capture

**Notes:**


---

## 5 · Audio axes

- [ ] Silence — heavy overlays quiet / empty as designed (no runaway entropy)
- [ ] Normal speech — readable reactivity
- [ ] Loud / sibilant — no catastrophic flicker or freeze
- [ ] Oscilloscope — waveform path engaged (trace, not bars)

**Notes:**


---

## 6 · FPS + Detail governor

- [ ] Mid-device: heavy scene stays usable (note FPS feel; exact counter optional)
- [ ] Detail Comfortable → Elevated → Guarded color/label transitions honest (thresholds ~560 / ~980)
- [ ] No silent drop of saved accents (pause is visible)

**Notes / device:**


---

## 7 · a11y

- [ ] High Contrast on representative spectrum + overlay + stackable (harder edges, less blur; Inferno → Void look if checked)
- [ ] OS/browser reduced-motion: freezes/simplifies as designed (no stuck stale audio history)
- [ ] Keyboard: Detail and primary Style pickers operable
- [ ] Caption-safe dim optional on; captions remain readable

**Notes:**


---

## 8–12 · 120 s size gate

Hard ceiling: **base ≤40 MiB** · **baked ≤40 MiB** · duration ~**120 s** (short smokes cannot pass).  
Put files under `artifacts/` (e.g. `artifacts/digital-rain/base.mp4`, `baked.mp4`, `report.json`).

| # | Scene | Registry ID | base ≤40 MiB | baked ≤40 MiB | Report path | Status |
|---|--------|-------------|--------------|---------------|-------------|--------|
| 8 | Digital Rain | `digital-rain` | | | | ☐ |
| 9 | Aurora | `aurora` | | | | ☐ |
| 10 | Glitch | `glitch` | | | | ☐ |
| 11 | Inferno | `inferno` | | | | ☐ |
| 12 | Heavy three-stack _(name stackable IDs)_ | e.g. `inferno` + 3 accents | | | | ☐ |

```bash
npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
```

**Notes:**


---

## 13 · Saved styles · hot-swap · Bubbles ID stability

- [ ] Saved custom style / profile with `sparkle` still renders Sparkle (v6 look OK)
- [ ] Saved `bokeh` still renders **Bubbles** (v6 algorithm; no placeholder pixels expected)
- [ ] Hot-swap spectrum/overlay identity does not leave previous effect’s state bleeding
- [ ] Tuning-only changes (e.g. smoothing) do not needlessly wipe identity state incorrectly

**Notes:**


---

## 14 · Product smoke wrap

- [ ] Short record → process → bake → download with a non-default Style succeeds
- [ ] Voice path still usable enough for a take (flag defects; see §15 if re-apply broken)
- [ ] No new red SW/offscreen errors on the happy path

**Notes:**


---

## 15 · Early-log triage (optional · not a ship gate by default)

From `logs/notes-before-bed-1.txt` and offscreen fail/success pair:

- [ ] Classify voice re-apply issue: Track A regression · pre-existing · environment · fixed already  
  - Early note: “Can't re-record voice effects over clip… plays last recording but doesn't reapply” — treat as **voice re-apply / Change Voice**, not visual Style, until proven otherwise
- [ ] Offscreen fail/success pair understood or filed

**Notes:**


---

## 16 · Classic / default no-regression vs v5.11.0

Roadmap success metric — explicit ship gate (not “assumed green” from fixture QA alone):

- [ ] Default / Classic (`classic-neon`) short capture + bake looks and feels like pre-v6 bar product (no surprise density/glow regression)
- [ ] File size on Classic short/medium take is not obviously worse than v5.11 habit (note qualitative if you lack a side-by-side MP4)
- [ ] Legibility of captions over Classic remains acceptable without forcing High Contrast

**Notes:**


---

## Sign-off

| Field | Value |
|-------|--------|
| Overall Track A confidence QA | ☐ open / ■ PASS / □ FAIL / ▲ PARTIAL |
| Blockers | |
| Operator | |
| Date | |
| Agent packet exported? | path under `artifacts/` or chat paste |

When closed: update [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md) verdict table + one-line pointer in root `claude-progress.md` / `TODO.md` (no long narrative in globals).
