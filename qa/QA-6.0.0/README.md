# QA workspace — v6.0.0

**Scoped project root for v6 real-browser QA.** Session churn lives here; globals only point here by path.

| File | Role |
|------|------|
| [`TODO-6.0.0.md`](TODO-6.0.0.md) | Actionable QA task ledger for this workspace |
| [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md) | Living session notes / evidence pointers |
| [`track-a/qa-checklist.html`](track-a/qa-checklist.html) | **Primary fill-in surface** — interactive board, autosave, agent JSON export |
| [`track-a/qa-checklist.md`](track-a/qa-checklist.md) | Reference matrix (same gates); not the preferred operator UI |
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
    qa-checklist.html       ← open in Chrome; primary operator UI
    qa-checklist.md         ← same gates (reference / agent-readable markdown)
    logs/                   ← console dumps, free-form notes (gitignored)
    screenshot/             ← UI / DevTools captures (gitignored)
    artifacts/              ← 120 s MP4s + harness reports + exported agent JSON (gitignored)
  track-b/
    README.md               ← placeholder only until Track B begins
```

## Conventions

1. **Run QA in the HTML board** — open `track-a/qa-checklist.html` in Chrome. Status + notes autosave in `localStorage`. Use **Export agent packet** (JSON → drop under `artifacts/`) or **Copy agent brief** for chat handoff. Import the same JSON later to restore.
2. Put **text** under `track-a/logs/`. Put **images** under `track-a/screenshot/`. Put **size-gate products** and exported packets under `track-a/artifacts/`.
3. Keep `progress-QA-6.0.0.md` / `TODO-6.0.0.md` as the thin ledger (verdicts + pointers), not a second full checklist.
4. Do **not** append long QA narrative to root `claude-progress.md` — a short pointer + overall verdict is enough when a gate closes.
5. Real-artifact size command (roadmap §9):

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

   Short smoke clips cannot pass the long-capture gate.
