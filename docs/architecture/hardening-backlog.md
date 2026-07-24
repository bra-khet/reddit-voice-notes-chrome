# Hardening Backlog — Post-v6 Residuals

<!--
CHANGED: Removed resolved H6–H14 case narratives and retained only live deferrals and current risk.
WHY: Resolved evidence is preserved in the checkpoint snapshot; the living backlog must drive future hardening choices.
-->

**Version:** v3.0 · **Updated:** 2026-07-23 · **Baseline:** `v6.0.0`

## Archive Notice (Living Document)

The complete v2.13 backlog, resolved case evidence, and prior risk register are preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/architecture/hardening-backlog.md`](../../archive/docs/v6.0.0-checkpoint/living-snapshots/architecture/hardening-backlog.md). Milestone context lives in [`docs/HISTORY.md`](../HISTORY.md).

## Open / deferred

| Item | Status | Revisit trigger |
|------|--------|-----------------|
| **H10 — encoder-fallback observability** | Deferred by user decision | Real report of an unexplained multi-minute bake or silent strategy fallback |
| **H5 — binary transport / recording cap expansion** | Deferred | Concrete product need beyond the stable 2:00 cap |
| **Vosk model re-download/cache architecture** | Accepted | Measured user harm that justifies a different packaging/origin strategy |
| **DEF-001 — cold-start spam race** | Accepted | Normal-use reproduction or a proven cheap boot-complete gate |

### H10 scope if revived

Thread a small strategy/cause enum through the existing bake result/progress path and show one muted explanation near progress. Reuse the current message family and local diagnostics; no remote telemetry, retry redesign, or encoder knobs.

## Closed structural items

| Item | Durable protection |
|------|--------------------|
| H6 artifact validation | Consumption points verify single-slot bytes against take stamps |
| H8 voice provenance | Recovery/re-apply uses explicit voice stamp semantics |
| H9 composite-stage elimination | ADR-0003 + browser full composite default |
| H11 concurrent recordings | Freshness precedence verified in real use |
| H12 Studio progress relay | Direct runtime broadcast plus content-tab relay split |
| H13 persist-before-stamp | Shared artifact commit choke point |
| H14 tab-close transcript survival | Background terminal owner + watchdog |

Use the archived snapshot and [`../bug-archive.md`](../bug-archive.md) for evidence; do not reopen these as plans without a recurrence.

## Current risk register

| Risk | Posture | Required check when touched |
|------|---------|-----------------------------|
| Hardware codec/calibration difference | Bounded by capability probe and fallback | Rich-effects compare and forced fallback |
| MediaRecorder fallback rot | Supported but off hot path | Periodic forced-fallback artifact |
| Take snapshot vs single-slot artifact mismatch | H6 mitigated | All new consumption/writer paths verify stamps |
| Recovery channel drift | Medium coupling risk | Re-run map Trace B and tab-close money path |
| Long-clip memory pressure | Bounded by 2:00/360p and segmented work | Observe buffers and size gate |
| Browser-composite visual/audio drift | Harness + fallback | Duration, packet/frame, and visual compare |
| Preference IDB publish race | H13-style commit/publish ordering | Migration, relay, writer-echo, force-fail |
| Hosted shim silent success | Shared commit fallback + host gate | Record/persist/reload on hosted build |
| New visual effect cost | Registry bounds + governor | Reduced motion, High Contrast, FPS, size |
| Background layout fidelity | Shared draw seam; captured at record time | Preview → record → bake comparison |
| Caption fallback divergence | Explicit canvas-only detection | Rich path plus bounded drawtext fallback |

## Intake rule

A new hardening item needs:

- a concrete failure class or violated invariant;
- the owning seam/context/store;
- a surgical mitigation and fallback;
- a verification hook;
- explicit non-goals.

Product polish belongs in [`../future-ideas.md`](../future-ideas.md), not here.
