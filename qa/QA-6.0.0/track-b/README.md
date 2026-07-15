# Track B — background layout QA (not started)

**Status:** deferred until Track A confidence close (or explicit go-ahead).  
**Roadmap:** [`docs/v6.0.0-background-panel-refactor.md`](../../../docs/v6.0.0-background-panel-refactor.md)  
**ADR:** [0008 — background direct-manipulation layout](../../../docs/architecture/adr/0008-background-direct-manipulation-layout.md)

When this track opens, mirror Track A:

```
track-b/
  qa-checklist.md
  logs/
  screenshot/
  artifacts/   # only if size/perf evidence is required
```

**Scope reminder (do not implement from here):** direct drag/zoom/snap on hero preview; promote `dim` to a field; `customPosition`; new `interaction-utils.ts`. Shared Cividis tokens already land from Track A Phase 0.

Active QA lives in [`../track-a/`](../track-a/) and the workspace ledger [`../TODO-6.0.0.md`](../TODO-6.0.0.md).
