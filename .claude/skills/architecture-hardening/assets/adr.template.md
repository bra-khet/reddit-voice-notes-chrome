<!--
  TEMPLATE — copy to docs/architecture/adr/NNNN-short-title.md (zero-padded,
  incrementing). An ADR captures WHY a decision was made so a future session
  doesn't relitigate it. A stub with just Context + Decision-needed is valid
  (Phase 2 opens stubs; Phase 3 / feature-integration resolve them).
-->

# ADR-NNNN: <short decision title>

- **Status:** Proposed | Accepted | Superseded by ADR-MMMM | Rejected
- **Date:** <YYYY-MM-DD>
- **Reflects branch/tag:** <branch-or-tag>
- **Deciders:** <who / which session>

## Context

What forces a decision? Link the trigger — a Phase-2 finding, a `BUG-###`
pattern, or a planned feature. State the constraint honestly (CSP limit, WASM
ceiling, MV3 lifecycle, payload size, etc.).

## Decision

What we will do, in one or two sentences. If this is a stub, write
"**Decision needed:** <the question>" and leave the rest for later.

## First-class concern impact

- **Preview ↔ bake:** <does this need both paths? do they agree? gap to document?>
- **Effect composition:** <which layer; compositing-order change?>
- **Message contracts:** <new/changed message family? `src/messaging/types.ts`?>
- **State ownership:** <new datum/store/signal? who writes it?>

## Options considered

1. **<Option A>** — pros / cons / cost.
2. **<Option B>** — pros / cons / cost.
3. **Do nothing** — what we lose / what stays risky.

## Consequences

- **Positive:** <what gets cheaper or safer>
- **Negative / accepted cost:** <the over-engineering we deliberately avoided, and
  why — the anti-over-engineering guard>
- **Follow-ups:** <hardening-backlog items, doc updates, sync points>

## References

- Code: `<file:line>`
- Docs: `<doc §>`
- Bugs: `<BUG-###>`
