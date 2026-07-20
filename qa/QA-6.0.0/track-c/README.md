# Track C — popup UI refresh QA (in progress)

**Status:** open — implementation + fixture QA in flight on `feature/v6.0.0-popup-ui-refresh`  
**Roadmap:** [`docs/v6.0.0-popup-ui-refresh.md`](../../../docs/v6.0.0-popup-ui-refresh.md) (redrafted 2026-07-19 against as-landed Track A)  
**ADR:** none required — presentational unification under ADR-0007's token contract

Workspace mirrors Track A:

```
track-c/
  qa-checklist.md   # committed gate
  logs/             # gitignored evidence
  screenshot/       # gitignored evidence
  artifacts/        # gitignored evidence (only if needed)
```

**Fixture:** `npm run qa:popup-visual` (port 4175) — production render builders + production CSS, no extension load needed.

Last QA lives in [`../track-a/`](../track-a/) and the workspace ledger [`../TODO-6.0.0.md`](../TODO-6.0.0.md).
