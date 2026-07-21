# QA workspace — v6.0.0

**Scoped project root for v6 real-browser QA.** Session churn lives here; globals only point here by path.

| File | Role |
|------|------|
| [`TODO-6.0.0.md`](TODO-6.0.0.md) | Actionable QA task ledger for this workspace |
| [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md) | Living session notes / evidence pointers |
| [`track-a/`](track-a/) | Track A — audio-reactive visuals (**confidence PASS · closed**) |
| [`track-b/`](track-b/) | Track B — background layout (**open · Phase 0–4 DONE · Phase 1–3 operator PASS · Phase 4 operator QA pending · Phase 5 next**) |
| [`track-c/`](track-c/) | Track C — popup UI refresh (**agent gate PASS · merged**) |

**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

**Active branch:** `feature/v6.0.0-background-panel-refactor` (Phase 0 `08a2de5` · Phase 1 `1e3118f` · Phase 2 `b129713` · Phase 3 `844a81f` · Phase 4 `1166d51`)<br>
**Roadmap B:** [`docs/v6.0.0-background-panel-refactor.md`](../../docs/v6.0.0-background-panel-refactor.md) · ADR [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)  
**Closed A:** [`docs/v6.0.0-custom-styles-refactor.md`](../../docs/v6.0.0-custom-styles-refactor.md)  
**Closed C:** [`docs/v6.0.0-popup-ui-refresh.md`](../../docs/v6.0.0-popup-ui-refresh.md)

## Directory map

```
qa/QA-6.0.0/
  README.md                 ← this file
  TODO-6.0.0.md
  progress-QA-6.0.0.md
  track-a/
    qa-checklist.html       ← Track A operator UI (closed)
    qa-checklist.md
    logs/ · screenshot/ · artifacts/   (gitignored)
  track-b/
    README.md               ← open status + phase map
    qa-checklist.md         ← committed gate (Phase 0–4 partial; full gate open)
    logs/ · screenshot/ · artifacts/   (gitignored)
  track-c/
    README.md · qa-checklist.md        (closed)
    logs/ · screenshot/ · artifacts/   (gitignored)
```

## Conventions

1. **Track B evidence** goes under `track-b/` (`logs/`, `screenshot/`, `artifacts/`). Tick the markdown checklist; optional HTML board can be added later if operator volume warrants it (Track A’s board is the precedent).
2. Keep `progress-QA-6.0.0.md` / `TODO-6.0.0.md` as the thin ledger (verdicts + pointers), not a second full checklist.
3. Do **not** append long QA narrative to root `claude-progress.md` — a short pointer + overall verdict is enough when a gate closes.
4. Real-artifact size command:

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

   Short smoke clips cannot pass the long-capture gate. Track B stress caps (roadmap §8): base ≤ **25 MiB** · baked ≤ **30 MiB** for blur+GIF ~120 s.
