# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on the current release boundary. The complete sprint-by-sprint record through the three v6.0 development tracks (and Track D) is preserved at [`archive/progress/claude-progress-through-v6.0.0-tracks.md`](archive/progress/claude-progress-through-v6.0.0-tracks.md). Earlier snapshots remain indexed by [`docs/HISTORY.md`](docs/HISTORY.md) and [`archive/README.md`](archive/README.md).

---

## Current stable — v6.0.0 Polish & Visual Maturity

**SHIPPED · package `6.0.0` · tagged `v6.0.0` · push user-owned.**

Four development tracks + Field Guide orientation polish, released as one stable product checkpoint.

| Track | Outcome |
|-------|---------|
| **A — audio-reactive visuals** | Six spectra · seven atmospheres · seven stackables · Style Control Center · governor · Cividis tokens |
| **B — background layout** | Direct drag/zoom/precision · presets · dim/blur/blends/plate/Holo/GIF · framing · A/B · full operator PASS |
| **C — popup UI** | Popup-only Cividis skin · elevated restart caution |
| **D — hosted Design Studio** | Full Studio on GitHub Pages · shim + loopback pipeline · Vosk · chronos · real Pages 5.7 PASS |
| **Field Guide** | One canonical tutorial; Design → Capture → Polish; hosted + extension mental model |

**Release notes (full + GitHub summary):** [`docs/release-notes-v6.0.0.md`](docs/release-notes-v6.0.0.md)  
**Milestone index:** [`docs/HISTORY.md`](docs/HISTORY.md)  
**Hosted Studio:** https://bra-khet.github.io/reddit-voice-notes-chrome/design-studio/

### Canonical track docs

- [`docs/v6.0.0-custom-styles-refactor.md`](docs/v6.0.0-custom-styles-refactor.md) · ADRs 0007/0009/0010  
- [`docs/v6.0.0-background-panel-refactor.md`](docs/v6.0.0-background-panel-refactor.md) · ADR-0008  
- [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md)  
- [`docs/v6.0.0-hosted-design-studio.md`](docs/v6.0.0-hosted-design-studio.md) · [`qa/QA-6.0.0/track-d/`](qa/QA-6.0.0/track-d/)

### Contracts that held

- `USER_PREFS_VERSION` remains **1**; no new execution context / message family / preference schema.
- Backgrounds remain Design-phase → capture-time (I1/I3/I23).
- `npm run compile` stays zero-error; host-neutrality gates the Pages build.

### Accepted residuals (not blockers)

- Conway long-horizon corner parking.
- Optional Track C §8 real-extension popup eyeball.
- Preference Import merge/union mode → [`docs/future-ideas.md`](docs/future-ideas.md).

---

## Architecture state

- Architecture map **v3.26**; extension points **v1.42**; hardening backlog **v2.13**; ADRs 0001–0010; **0011 unallocated**.
- Six contexts unchanged; Track D is a second **host** for Design Studio, not a seventh context.
- Canonical: [`docs/architecture/architecture-map.md`](docs/architecture/architecture-map.md), [`docs/architecture/extension-points.md`](docs/architecture/extension-points.md), [`docs/design-studio.md`](docs/design-studio.md).

---

## Immediate next

1. **User-owned:** `git push origin main` and `git push origin v6.0.0` (and create the GitHub Release from the summary in the release notes).
2. Optional polish after the tag: Track C §8 eyeball, Conway residual, Import merge mode, free-form style composition (v6.1+).
3. Run `/docs-archiving` Refresh only if living progress grows again; Refresh #5 is this ship (v5.10/v5.11 notes archived).

**Restore this stable:** `git checkout v6.0.0 && npm install && npm run dev`  
**Hosted Studio local:** `cd demo && npm install && npm run build && npm run preview` — QA against a **build**, never `vite dev`.

---

## Resume in a new chat

```text
Reddit Voice Notes: v6.0.0 SHIPPED (Polish & Visual Maturity). package 6.0.0, tag v6.0.0.
Tracks A/B/C/D + Field Guide complete. Release notes: docs/release-notes-v6.0.0.md (includes GitHub summary).
Push of main + tag is user-owned. Next work is post-v6 optional polish / future roadmap, not reopening Track D.
```
