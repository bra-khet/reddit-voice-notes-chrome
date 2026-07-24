# QA workspace — v6.0.0

**Scoped project root for v6 real-browser QA.** Session churn lives here; globals only point here by path.

| File | Role |
|------|------|
| [`TODO-6.0.0.md`](TODO-6.0.0.md) | Actionable QA task ledger for this workspace |
| [`progress-QA-6.0.0.md`](progress-QA-6.0.0.md) | Living session notes / evidence pointers |
| [`track-a/`](track-a/) | Track A — audio-reactive visuals (**confidence PASS · closed**) |
| [`track-b/`](track-b/) | Track B — background layout (**full operator checklist PASS · merged**) |
| [`track-c/`](track-c/) | Track C — popup UI refresh (**agent gate PASS · merged**) |
| [`track-d/`](track-d/) | Track D — hosted Design Studio (**OPEN · Phase 0 not started**) |

**Globals (pointers only):** root [`TODO.md`](../../TODO.md) · [`claude-progress.md`](../../claude-progress.md)

**Current branch:** `feature/v6.0.0-hosted-design-studio` (cut from `main@a4df9a1`); Tracks A/B/C merged<br>
**Closed D:** [archived roadmap](../../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-hosted-design-studio.md) · ADR none (0011 next)
**Closed B:** [archived roadmap](../../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-background-panel-refactor.md) · ADR [0008](../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)
**Closed A:** [archived roadmap](../../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-custom-styles-refactor.md)
**Closed C:** [archived roadmap](../../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-popup-ui-refresh.md)

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
    README.md               ← closed status + phase map
    qa-checklist.md         ← committed full PASS gate
    logs/ · screenshot/ · artifacts/   (gitignored)
  track-c/
    README.md · qa-checklist.md        (closed)
    logs/ · screenshot/ · artifacts/   (gitignored)
  track-d/
    README.md               ← open status + phase gates + open checks/decision
    qa-checklist.md         ← phase-staged operator gate
    logs/ · screenshot/ · artifacts/   (gitignored)
```

## Conventions

1. **Track B evidence** remains under `track-b/` (`logs/`, `screenshot/`, `artifacts/`); its markdown checklist is the closed merge gate.
2. Keep `progress-QA-6.0.0.md` / `TODO-6.0.0.md` as the thin ledger (verdicts + pointers), not a second full checklist.
3. Do **not** append long QA narrative to root `claude-progress.md` — a short pointer + overall verdict is enough when a gate closes.
4. **Track D only:** QA the hosted surface against a **build or a deploy**, never `vite dev` — the dev server aborts the 31 MB `ffmpeg.load()` (documented for the Voice Studio in `docs/static-voice-studio-design.md` §8, and it applies identically here). Its `§0` standing regression re-runs at **every** phase exit, not just at close.
5. Real-artifact size command:

   ```bash
   npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
   ```

   Short smoke clips cannot pass the long-capture gate. Track B stress caps (roadmap §8): base ≤ **25 MiB** · baked ≤ **30 MiB** for blur+GIF ~120 s.
