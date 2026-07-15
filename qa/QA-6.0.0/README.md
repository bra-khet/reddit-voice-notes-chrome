# QA workspace — v6.0.0

**Scoped project root for v6 real-browser QA.** Session churn lives here; globals only point here by path.

| File | Role |
|------|------|
| [`TODO-6.0.0.md`](TODO-6.0.0.md) | Actionable QA task ledger for this workspace |
| [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md) | Living session notes / evidence pointers |
| [`track-a/`](track-a/) | Track A — audio-reactive visuals (active) |
| [`track-b/`](track-b/) | Track B — background layout (**not started**) |

**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

**Branch:** `feature/v6.0.0-custom-styles-refactor`  
**Roadmap A:** [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md)  
**Roadmap B:** [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) (do not start until Track A confidence close)

## Directory map

```
qa/QA-6.0.0/
  README.md                 ← this file
  TODO-6.0.0.md
  progress-QA-6.0.0.md
  track-a/
    qa-checklist.md         ← live reactive / FPS / a11y / size matrix
    logs/                   ← console dumps, free-form notes
    screenshot/             ← UI / DevTools captures
    artifacts/              ← 120 s base/baked MP4s + qa:visual-size reports
  track-b/
    README.md               ← placeholder only until Track B begins
```

## Conventions

1. Put **text** under `track-a/logs/` (or a dated subfolder). Put **images** under `track-a/screenshot/`. Put **size-gate products** (MP4s + JSON/text harness output) under `track-a/artifacts/`.
2. Tick checklist items in `track-a/qa-checklist.md`; summarize outcomes in `progress-QA-6.0.0.md` and `TODO-6.0.0.md`.
3. Do **not** append long QA narrative to root `claude-progress.md` — a short pointer + overall verdict is enough when a gate closes.
4. Real-artifact size command (roadmap §9):

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

   Short smoke clips cannot pass the long-capture gate.
