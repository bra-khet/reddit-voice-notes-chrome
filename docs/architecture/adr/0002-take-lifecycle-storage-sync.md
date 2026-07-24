# ADR-0002: Take lifecycle syncs via storage key, not a message family

- **Status:** Accepted (retro-documented 2026-07-06; decision made v5.4.0 Phase 0, 2026-07-05)
- **Date:** 2026-07-06
- **Reflects branch/tag:** `main` @ package `5.4.0` (tag deferred)
- **Deciders:** v5.4.0 Phase 0 implementation session (Claude + bra-khet)

## Context

v5.4.0 makes Design Studio the primary authoring surface with Reddit demoted to
an optional output target. That requires one authoritative "current take" visible
to four contexts at once (Studio page, Reddit content script, background SW,
offscreen doc): status, source, and which single-slot IDB blobs it owns. The
repo already had two cross-context sync idioms: (a) `MSG_*` pipeline families
relayed by the background (fragile part of the codebase — BUG-032 class,
`jobId→tabId` registry, skip-tab-relay special case for extension pages), and
(b) storage-key signals (`rvn.workflow.phase`, `rvn.*.ready`) — writes to
`chrome.storage.local` observed via `storage.onChanged`, which all contexts
share and which survives MV3 SW death by construction. `MSG_TAKE_*` placeholders
were scaffolded first, then removed.

## Decision

The current take is a JSON snapshot under `rvn.take.current` in
`chrome.storage.local`, written only through the TakeManager
(`src/session/take-manager.ts`); `storage.onChanged` is the sync channel. Blobs
never enter the snapshot — they stay in the existing IDB stores, referenced by
`TakeArtifactStamp` freshness stamps. No `MSG_TAKE_*` family exists.

## First-class concern impact

- **Preview ↔ bake:** none directly; the deck's Download CTA resolves blobs
  from IDB at click time, so the snapshot can never serve stale bytes itself.
- **Effect composition:** none.
- **Message contracts:** deliberately *not* extended — this ADR is the recorded
  reason a fourth message family does not exist. The one message added in the
  same release (`MSG_QUERY_TRANSCODE_INFLIGHT`) is a side-effect-free query for
  recovery, not take sync.
- **State ownership:** new datum `rvn.take.current`; single choke-point writer
  (TakeManager) with three sanctioned callers — recorder session (capture
  transitions), background (artifact stamps after relayed IDB writes), Studio
  bake (`updateFromBake`). Read-side hygiene: `normalizeStaleTake` demotes
  transient states older than 2 min to `draft`.

## Options considered

1. **`MSG_TAKE_*` message family (scaffolded, then removed)** — symmetric with
   pipelines, but state-shaped data over a work-shaped channel: needs the relay
   registry (the codebase's most fragile seam), a skip-tab-relay special case,
   replay-on-SW-restart semantics, and a "who missed the broadcast" story for
   every late-joining context. All of that is free with storage.
2. **IDB row + `rvn.take.ready` ping** — consistent with transcript delivery,
   but content scripts cannot read extension IDB, so every Reddit-panel read
   becomes a chunked relay round-trip for a <1 KB snapshot; overkill.
3. **Storage-key snapshot + `storage.onChanged` (CHOSEN)** — same proven idiom
   as `rvn.workflow.phase`; all four contexts read/write natively; survives SW
   restarts; `storage.onChanged` delivers to every open context without a
   registry. Costs: ~10 write/s sustained quota (fine — take transitions are
   human-paced), JSON-only payloads (blobs excluded by design), no ordering
   guarantee beyond last-write-wins (mitigated by same-context write
   serialization + `sessionEpoch` + freshness precedence).
4. **Do nothing (per-surface ad-hoc state)** — the pre-5.4.0 world: Reddit
   panel and Studio each inferred session state from IDB metas; the exact
   desync class Phase 0 existed to remove.

## Consequences

- **Positive:** zero new relay surface; take state visible to any future
  context (side panel, options page) for free; MV3-restart-proof; pure snapshot
  helpers are Node-testable (`scripts/test-take-manager.mjs`); the Reddit
  panel's live-sync during Studio capture (v5.4.0 QA follow-up) was a pure
  consumer addition — no protocol change.
- **Negative / accepted cost:** last-write-wins semantics put the burden on
  writer discipline (three sanctioned writers only — a fourth writer is an ADR
  event); artifact stamps reference single-slot stores that can be overwritten
  by newer captures, so consumers must cross-check stamps (contract documented
  in the TakeManager header; **implementation gap tracked as backlog H6**);
  concurrent Studio-tab writers unexamined (backlog H11). Rejected
  over-engineering: no BroadcastChannel layer, no take history/multi-take
  store, no tab-lease locking — single-slot, freshness-precedence semantics
  are enough for a single-user session tool.
- **Follow-ups:** H6 (stamp verification at consumption points), H8
  (capture-time voice provenance in take meta), H11 (dual-Studio-tab
  investigation). Extension seam documented in
  `docs/architecture/extension-points.md` § Take lifecycle & artifacts — v1.

## References

- Code: `src/session/take-manager.ts` (header = authoritative contract),
  `src/recorder/voice-recorder.ts` (transitions), `entrypoints/background.ts`
  (`recordArtifact`, orphan adoption), `src/ui/design-studio/studio-take-recovery.ts`,
  `src/ui/recorder-panel.ts` (attach mode, `maybePromoteNewerTake`).
- Docs: `archive/docs/pre-v6.0.0/designs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`
  §3.1 / Phase 0 as-built; `docs/design-studio.md` §3.2 (storage map);
  `docs/architecture/architecture-map.md` v2.0 §2.3 (take lifecycle diagram).
- Bugs: BUG-032 (the relay fragility this decision routes around); v5.4.0 QA #4
  (mid-processing tab close — recovery semantics built on this snapshot).
