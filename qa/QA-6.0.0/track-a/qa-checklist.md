# Track A — Phase 4 confidence QA checklist

**Sprint:** v6.0.0 Track A — audio-reactive Style / governor confidence close  
**Branch:** `feature/v6.0.0-custom-styles-refactor`  
**Roadmap:** [`docs/v6.0.0-custom-styles-refactor.md`](../../../docs/v6.0.0-custom-styles-refactor.md) §9  
**Workspace TODO / progress:** [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md)  
**Machine / browser:** _(_fill in_)_  
**Date:** _(_fill in_)_  
**Build:** load `.output/chrome-mv3-dev/` (or prod) from this branch  

**Why this gate exists:** Phase 4 Style Control Center + shared `maxElements` governor are implemented and fixture-QA’d. Confidence stays **Medium** until **live reactive capture**, **device FPS**, **a11y**, and **real 120 s encoded-size** evidence land. Visuals are **capture-time only** (I1/I3); bake must not re-paint bars/overlays.

**Merge / release when:** required sections PASS (or FAIL with notes + no ship).  
**Automated already green:** focused v6 **226/226** · `npm run build` PASS · `npm run compile` = 2 pre-existing subtitle diagnostics.

---

## How to use

1. Prefer a **dev build** so governor / size / Style logs are visible.
2. Reload the extension after every rebuild.
3. Tick `- [ ]` → `- [x]`; jot evidence paths under **Notes** (`logs/`, `screenshot/`, `artifacts/`).
4. Consoles: Service worker · Design Studio · Reddit tab (for capture path).
5. Size gate command (short smokes **cannot** pass):

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

6. Caps: base ≤ **25 MiB** · baked ≤ **30 MiB** · duration ~**120 s** for heavy reports.

### What to bring back on FAIL

| Item | Why |
|------|-----|
| Section # + checkbox | Locates the gate |
| UI symptom + preset IDs (spectrum / overlay / stackables / Detail) | Product surface |
| SW + Studio + offscreen console excerpts | Capture / transcode / governor |
| Paths to screenshot / artifact / harness report | Repro |
| Whether reduced-motion / High Contrast / mobile width was on | Context |

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
| 8 | 120 s size — Digital Rain | ☐ | |
| 9 | 120 s size — Aurora | ☐ | |
| 10 | 120 s size — Glitch | ☐ | |
| 11 | 120 s size — Inferno | ☐ | |
| 12 | 120 s size — heavy three-stack | ☐ | |
| 13 | Saved styles / hot-swap / Bubbles label | ☐ | |
| 14 | Product smoke wrap | ☐ | |
| 15 | Early-log triage (optional) | ☐ | voice re-apply note |

**Overall:** ☐ open  

**Key:** ■ PASS · □ FAIL · ▲ PARTIAL · ☐ open  

---

## 0 · Pre-flight

- [ ] Branch is `feature/v6.0.0-custom-styles-refactor` (or equivalent v6 Track A build loaded)
- [ ] Extension reloaded; no red errors on load (SW / offscreen)
- [ ] Design Studio opens; **Style** section present (Atmosphere → Accents → Spectrum → Captions)
- [ ] Detail / High Contrast / caption-safe dim controls visible
- [ ] Evidence folders ready: `logs/` · `screenshot/` · `artifacts/`

**Notes:**


---

## 1 · Preview ↔ capture ↔ bake parity

For at least one static-ish preset (e.g. **Minimal** or **Classic**) and one reactive atmosphere (e.g. **Digital Rain** or **Sparkle**):

- [ ] Studio Live preview shows **representative** motion (not dead; not claiming live mic)
- [ ] Short recording reacts to **voice** (bars/overlays move with speech)
- [ ] After process/bake, base/baked frame still shows the **same** bars/overlays (bake only adds captions)
- [ ] Captions sit above visuals; caption-safe dim (if on) does not crush legibility

**Notes:**


---

## 2 · Spectrum smoke (all six)

Record a short take or rely on preview + one short capture per family as needed:

- [ ] Classic (Neon Glow) — default/no-change feel
- [ ] Minimal
- [ ] Phosphor
- [ ] Radial Spectrum
- [ ] Central Pulse
- [ ] Oscilloscope (linear and/or circular if exposed)

**Notes:**


---

## 3 · Atmosphere smoke (all seven)

- [ ] Sparkle
- [ ] Bubbles (UI label **Bubbles**; persisted ID still `bokeh`)
- [ ] Forest Spirits
- [ ] Digital Rain
- [ ] Inferno (Void via High Contrast if tested here or in §7)
- [ ] Aurora
- [ ] Glitch

**Notes:**


---

## 4 · Accents · max-three · governor

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
- [ ] Detail Comfortable → Elevated → Guarded color/label transitions honest
- [ ] No silent drop of saved accents (pause is visible)

**Notes / device:**


---

## 7 · a11y

- [ ] High Contrast on representative spectrum + overlay + stackable (harder edges, less blur)
- [ ] OS/browser reduced-motion: freezes/simplifies as designed (no stuck stale audio history)
- [ ] Keyboard: Detail and primary Style pickers operable
- [ ] Caption-safe dim optional on; captions remain readable

**Notes:**


---

## 8–12 · 120 s size gate

Put files under `artifacts/` (e.g. `artifacts/digital-rain/base.mp4`, `baked.mp4`, `report.json`).

| # | Scene | base ≤25 MiB | baked ≤30 MiB | Report path | Status |
|---|--------|--------------|---------------|-------------|--------|
| 8 | Digital Rain | | | | ☐ |
| 9 | Aurora | | | | ☐ |
| 10 | Glitch | | | | ☐ |
| 11 | Inferno | | | | ☐ |
| 12 | Heavy three-stack _(name IDs)_ | | | | ☐ |

```bash
npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
```

**Notes:**


---

## 13 · Saved styles · hot-swap · Bubbles ID stability

- [ ] Saved custom style / profile with `sparkle` still renders Sparkle
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
- [ ] Offscreen fail/success pair understood or filed

**Notes:**


---

## Sign-off

| Field | Value |
|-------|--------|
| Overall Track A confidence QA | ☐ open / ■ PASS / □ FAIL / ▲ PARTIAL |
| Blockers | |
| Operator | |
| Date | |
