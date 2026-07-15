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

### 2026-07-15 — QA workspace scaffold

- Established `qa/QA-6.0.0` as the nested QA project (out of `.ignore/` for lasting scope).
- Created scoped [`TODO-6.0.0.md`](TODO-6.0.0.md) + this progress file; Track A checklist skeleton; Track B placeholder only.
- Preserved existing early dumps under `track-a/logs/`:
  - `notes-before-bed-1.txt` — voice re-apply / Change Voice not applying (triage later; may not be a Track A visual defect)
  - `offscreen-transcode-failure-1.log` / `offscreen-transcode-success-1.log`
- Global root `TODO.md` + `claude-progress.md` updated with **location/name pointers only**.

**Next for operator:** pre-flight on branch → start [`track-a/qa-checklist.md`](track-a/qa-checklist.md) live matrix; drop screenshots under `track-a/screenshot/` and size reports under `track-a/artifacts/`.

---

## Evidence index

| Path | What |
|------|------|
| `track-a/logs/` | Console dumps, free-form notes |
| `track-a/screenshot/` | UI / DevTools images |
| `track-a/artifacts/` | 120 s base/baked MP4s + `qa:visual-size` text/JSON |
| `track-a/qa-checklist.md` | Tickable matrix + progress table |

---

## Verdict (update when Track A confidence close finishes)

| Gate | Result | Date |
|------|--------|------|
| Live capture / FPS / a11y | ☐ open | — |
| 120 s heavy size reports | ☐ open | — |
| **Track A overall** | ☐ open | — |

**Key:** ■ PASS · □ FAIL · ▲ PARTIAL · ☐ open
