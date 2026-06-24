# Architecture docs — Reddit Voice Notes

**Updated:** 2026-06-24 · **Skill:** `/architecture-hardening`

This directory holds the **living, versioned** architecture index for the extension. It is the cross-cutting view — subsystem internals live in the canonical docs listed below.

**Inbound rule:** Any doc or session touching cross-context design, new pipelines, new storage, or new effects should link here and check the extension-points registry before writing code.

---

## Index

| File | Owns | Version |
|------|------|---------|
| [`architecture-map.md`](architecture-map.md) | Cross-cutting architecture: contexts, diagrams, first-class concerns, invariants, confidence ledger | v1.0 |
| [`extension-points.md`](extension-points.md) | Integration seam registry: where new voice effects, subtitle effects, pipelines, storage, and surfaces plug in | v1.0 |
| [`hardening-backlog.md`](hardening-backlog.md) | Ranked hardening items with ROI scores, evidence, blast radius, and non-goals | v1.0 |
| `adr/` | Architecture Decision Records (stubs opened in Phase 2/3; resolved in future sprints) | — |

---

## Canonical docs (win on their topic — never duplicated here)

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics, preview=bake, dirty layers, storage map, outbound index (§12) |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack, postMessage trust model |
| `docs/engineering-principles.md` | Semantic health, save pathways, ImageDB, pipeline-native effects |
| `docs/bug-archive.md` | `BUG-###` history (Phase-3 raw material) |
| `docs/v4-development-principles.md` | Branch model, compositing, WASM queues, sprint hygiene |
| `claude-progress.md` | Session timeline + release tags |

---

## Update triggers (when to re-run `/architecture-hardening`)

- New execution context added (e.g. side-panel, options page).
- New offscreen pipeline (new `MSG_<NAME>_*` family in `src/messaging/types.ts`).
- New IDB store or new `rvn.*.ready` signal.
- New visual effect type that touches the preview=bake boundary.
- A bug class from `docs/bug-archive.md` recurs — indicates a systemic gap.
- Before any major refactor (prefs, relay, offscreen lifecycle).
- Before merging `eloquent → main` for v4 release.

## Version policy

- `architecture-map.md`: bump MINOR for additive content, MAJOR when a context/pipeline/storage class is added or removed.
- `extension-points.md`, `hardening-backlog.md`: version independently by seam/sprint.
- Never create `architecture-map-v2.md` — update in place.

## Standards

- Diagrams embedded inline (Mermaid fenced blocks) — render-checked before commit.
- Each diagram has one sentence above (what it shows + what to verify it against) and the invariant(s) it encodes below.
- Every living doc ends with a carry-forward block for cold-session re-seeding.
- All ADRs use `adr/NNNN-short-title.md` (zero-padded, incrementing).
