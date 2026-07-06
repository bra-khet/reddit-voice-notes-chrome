# Architecture docs — Reddit Voice Notes

**Updated:** 2026-07-06 · **Reflects:** `main` @ package `5.4.0` (tag deferred) · **Skill:** `/architecture-hardening`

This directory holds the **living, versioned** architecture index for the extension. It is the cross-cutting view — subsystem internals live in the canonical docs listed below.

**Inbound rule:** Any doc or session touching cross-context design, new pipelines, new storage, or new effects should link here and check the extension-points registry before writing code.

---

## Index

| File | Owns | Version |
|------|------|---------|
| [`architecture-map.md`](architecture-map.md) | Cross-cutting architecture: contexts, diagrams (incl. take lifecycle), first-class concerns, invariants I1–I15, confidence ledger, money-path traces | v2.0 |
| [`extension-points.md`](extension-points.md) | Integration seam registry: voice effects, subtitle effects, fonts, message pipelines (v2), storage, theme, Studio surfaces, live-mic preview, overlay encoding backbone, **take lifecycle**, **Studio capture host** | v1.3 |
| [`hardening-backlog.md`](hardening-backlog.md) | Ranked hardening items (H6–H12 open) + **risk register** for the WebCodecs/canvas paths | v2.0 |
| `adr/` | [0001 WebCodecs encoding backbone](adr/0001-webcodecs-encoding-backbone.md) (Accepted, v5.3.10) · [0002 Take lifecycle storage sync](adr/0002-take-lifecycle-storage-sync.md) (Accepted, v5.4.0) · [0003 Composite-stage elimination](adr/0003-composite-stage-elimination.md) (Proposed stub) | — |

---

## Canonical docs (win on their topic — never duplicated here)

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics, preview=bake, dirty layers, storage map (§3.2 incl. `rvn.take.current`), outbound index (§12) |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack, canvas overlay + WebCodecs bake paths, strategy/fallback table |
| `docs/engineering-principles.md` | Semantic health, save pathways, ImageDB, pipeline-native effects |
| `docs/bug-archive.md` | `BUG-###` history (Phase-3 raw material) |
| `docs/v4-development-principles.md` | Branch model, compositing, WASM queues, sprint hygiene |
| `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md` | v5.4.0 Phase 0 as-built (TakeManager) |
| `docs/5.3.10-webcodecs-per-chunk-encoding.md` | WebCodecs backbone as-built (§0) |
| `src/session/take-manager.ts` (header) | Take lifecycle contract |
| `claude-progress.md` | Session timeline + release tags |

---

## Update triggers (when to re-run `/architecture-hardening`)

- New execution context (side panel, options page) or a worker adopted for the encode loop (ADR-0001 named this follow-up).
- New `MSG_<NAME>_*` pipeline family or a query message growing lifecycle semantics.
- New IDB store, new `rvn.*` storage key, new `TakeStatus`/`TakeArtifactKind`, or a **fourth take writer**.
- New overlay encoder strategy, or an encoder/parallel flag default flip (rerun the observability check, backlog H10).
- New visual effect touching the preview=bake boundary, or a fourth compositing layer (ADR required).
- A bug class from `docs/bug-archive.md` recurs — indicates a systemic gap.
- Before any major refactor (prefs, relay, offscreen lifecycle, TakeManager writers).
- Before pushing / tagging a release: confirm map version reflects the tag.

## Version policy

- `architecture-map.md`: bump MINOR for additive content, MAJOR when a context/pipeline/storage class is added or removed.
- `extension-points.md`, `hardening-backlog.md`: version independently by seam/sprint.
- Never create `architecture-map-v2.md` — update in place.
- ADRs are immutable once Accepted; supersede with a new ADR instead of editing.

## Standards

- Diagrams embedded inline (Mermaid fenced blocks) — render-checked before commit.
- Each diagram has one sentence above (what it shows + what to verify it against) and the invariant(s) it encodes below.
- Every living doc ends with a carry-forward block for cold-session re-seeding.
- All ADRs use `adr/NNNN-short-title.md` (zero-padded, incrementing — 0004 is next).
