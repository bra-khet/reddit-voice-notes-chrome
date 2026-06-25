# Release notes — v5.0.0 **Dulcet II**

**Tag:** `v5.0.0` · **Codename:** Dulcet II · **Date:** 2026-06-25  
**Merge:** `dulcet-ii/integration` → `main` (from the v4.0.0 baseline)  
**Restore:** `git checkout v5.0.0 && npm install && npm run dev`  
**Prior stable:** `v4.0.0` (main — Eloquent I, automated subtitles)

## Summary

**Dulcet II** is a ground-up rebuild of the voice-stylization engine. The legacy
flat-field voice layer (fixed presets + a handful of scalar knobs) is gone,
replaced by a **graph-native DSP**: a voice is an ordered, composable
`StylizedGraph` of effect *fragments*. The same graph drives both the live
preview (Web Audio) and the final export (FFmpeg) — there is now **one source of
truth** for what a voice sounds like.

On top of the engine, the Design Studio voice composer gains **character voice
presets** (one-click chips, including an **Incognito** anonymizer), **per-primitive
Fine-tune dials** for non-linear strength control, and **physical analog sliders**
that scale and capture correctly.

Everything stays **client-side**; nothing about the voice pipeline leaves the
browser.

## Highlights

### Graph-native voice engine (`StylizedGraph`)

| Area | What shipped |
|------|----------------|
| **Fragment model** | A voice is an ordered list of `GraphFragment`s — 21 effect kinds across 7 categories (clean, pitch/formant, tone, dynamics, color/character, modulation/space, safety) with a typed `FRAGMENT_DEFS` registry |
| **Canonical chain order** | `clean → shape → character → space → safety` default signal flow; user reorder wins once set |
| **Renderer-agnostic build** | `buildStylizedGraph()` walks enabled fragments through a pluggable renderer — FFmpeg for export, Web Audio for preview — from the exact same call |
| **One source of truth** | The graph bake is authoritative for preview *and* export; the old parallel flat-field code path was removed (~1,100 lines deleted) |

### Pitch & formant

- Dedicated `pitchFormant` fragment with independent pitch and formant control,
  so character voices can shift register without the "chipmunk" formant smear.

### Live preview pipeline

- Web Audio preview renders the **same graph** the exporter bakes, with a
  fidelity cap and edge-case handling so the Test button matches the final MP4.

### Character voice presets

- One-click **character chips** in the voice composer seed a full graph for a
  named voice; **Incognito** ships as a built-in anonymizer preset.
- Helper tooltip explains the one-voice-per-profile model; a status pill named
  after the active profile indicates when a custom voice is in effect
  (text-sanitized — no escape-character bleed).

### Per-primitive Fine-tune dials

- A **Fine-tune** disclosure (nested under Advanced — enabling it auto-enables
  Advanced) exposes a per-fragment `gain` (0–10, default 10 = unchanged) via a
  themed mini-knob with **press-and-hold** chevron steppers (dead-man's-switch
  auto-repeat).
- Gain is applied as an intensity **multiplier**
  (`intensityFactor × (gain/10)^1.3`), so it's audible at every intensity level
  and byte-identical to the prior render at the default of 10.

### Physical analog sliders

- The native `<input type=range>` is replaced by a shared, div-based
  `physical-slider` with `setPointerCapture` — drags stay glued to one control,
  no dropped capture, no stickiness.
- The machined-track SVG uses `preserveAspectRatio="none"` so the track and its
  edge glow stretch to fill the full row (was a short static stub).
- Adopted by both the Fine-tune primitive sliders and the main Intensity slider;
  Turbo cleanly disables the Intensity slider.

## Pipeline

```
Voice draft (StylizedGraph)
  → resolveVoiceGraph (the "bake")
  → buildStylizedGraph(graph, renderer)
       ├─ ffmpegRenderer  → -af chain   (export / final MP4)
       └─ webAudioRenderer → node graph (live preview / Test)
```

Per-fragment `gain` weights each stage; disabled fragments and zero intensity
assemble to nothing.

## Build

```bash
npm install
npm run build && npm run zip
# → .output/reddit-voice-notes-5.0.0-chrome.zip (~57 MB)
```

Release gate: `npm run compile` (tsc `--noEmit`) clean and `npm run build`
(WXT) clean.

## Upgrade from v4.0.0

1. Remove or disable the old build at `chrome://extensions`
2. Load the new zip (or checkout tag `v5.0.0` and run `npm run zip`)
3. Reload the extension and hard-refresh Reddit

Saved profiles, appearance, subtitles, and personal backgrounds carry over.
Voice **intent** is preserved across the rebuild via the id-independent intent
key; voices configured as fixed legacy presets resolve into their graph
equivalent. Re-snapshot a profile (**Update profile**) to capture any new
Fine-tune dialing.

## Known limitations

- **2-minute recording cap** unchanged (BUG-001 deferred)
- **Bundle size** ~57 MB zip (Vosk model + DejaVu fonts + FFmpeg WASM)
- **Memory:** do not run FFmpeg + Vosk concurrently; separate job queues
- Voice preview requires a prior recording in the same browser session
- One voice per profile by design (the status pill / tooltip reflect this)

## Docs

| Doc | Purpose |
|-----|---------|
| `dulcet-branch.md` / `eloquent-branch.md` | v3 / v4 history |
| `docs/architecture/` | architecture map + hardening backlog |
| `.claude/skills/architecture-hardening/` | hardening playbooks used this cycle |

## Branch completion

| Branch | Scope |
|--------|-------|
| `dulcet-ii/dsp-foundation` | `StylizedGraph` model, fragment registry, FFmpeg renderer, baking |
| `dulcet-ii/pitch-formant` | Pitch & formant fragment |
| `dulcet-ii/preview-pipeline` | Web Audio preview of the same graph |
| `dulcet-ii/character-system` | Character chips + Incognito, Fine-tune dials, physical sliders, legacy strip |
| `dulcet-ii/integration` | Integrate branches, harden, docs, merge → **v5.0.0** |

---

**Tag history:** `v5.0.0` · `v4.0.0` · `v3.7.0` · `v3.1.0` · `v3.0.0` · `v2.0.0`
