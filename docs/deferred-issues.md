# Deferred Issues

<!--
CHANGED: Reduced the register to active deferrals and current un-deferral triggers.
WHY: Full original evidence is archived; this file should answer only whether work is presently justified.
-->

## Archive Notice (Living Document)

The full v6-checkpoint version is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/deferred-issues.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/deferred-issues.md). Fixed-bug forensics are indexed by [`bug-archive.md`](bug-archive.md); architecture deferrals live in [`architecture/hardening-backlog.md`](architecture/hardening-backlog.md); milestones live in [`HISTORY.md`](HISTORY.md).

## DEF-001 — Cold-start inference error under record/stop spam

**Status:** Accepted / deferred
**Normal-use impact:** None reproduced after BUG-034
**Trigger:** Cold offscreen boot plus deliberately rapid record → stop → record or repeated sub-two-second silent clips.

The common first-recording race is fixed by serialized offscreen creation/dispatch, prewarm, and readiness checks. An adversarial boot-window storm can still yield one classified inference-error scaffold.

### Why it remains deferred

- It is not a normal workflow.
- MV3 offscreen and worker startup latency is part of the trigger.
- Stronger global locking or record blocking would widen a historically race-prone choke point.
- The current failure is explicit and recoverable, not silent.

### Un-defer only when

- a normal-use report reproduces it, or
- a cheap boot-complete gate can be proven without regressing BUG-032/034/038 behavior.

Any attempted fix must re-run cold start, tab close, explicit cancel/supersession, and terminal persistence QA.
