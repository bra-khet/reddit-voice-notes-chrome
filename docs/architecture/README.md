# Architecture docs — Reddit Voice Notes

**Updated:** 2026-07-11 · **Reflects:** `main` @ tagged `v5.10.0` (in-place v5.10 update; last full pass at `v5.9.0`) · **Map:** v2.7 · **Skill:** `/architecture-hardening`

This directory holds the **living, versioned** architecture index for the extension. It is the cross-cutting view — subsystem internals live in the canonical docs listed below.

**Inbound rule:** Any doc or session touching cross-context design, new pipelines, new storage, or new effects should link here and check the extension-points registry before writing code.

---

## Index

| File | Owns | Version |
|------|------|---------|
| [`architecture-map.md`](architecture-map.md) | Cross-cutting architecture: six contexts, current diagrams, first-class concerns, invariants I1–I19, confidence ledger, and five money-path traces through atomic trim + raw-WebM trim | v2.7 |
| [`extension-points.md`](extension-points.md) | Integration seam registry: voice/subtitle/font, message/query, storage, Studio/capture, browser/fallback composite, take/audio editing, verified splice, timeline, and atomic trim (raw leg incl.) | v1.9 |
| [`hardening-backlog.md`](hardening-backlog.md) | Ranked hardening: H13 persistence acknowledgment + H8 recovery voice open; H12 resolved; H10 deferred; risks through v5.9 trim | v2.5 |
| `adr/` | [0001 WebCodecs encoding backbone](adr/0001-webcodecs-encoding-backbone.md) (Accepted, v5.3.10) · [0002 Take lifecycle storage sync](adr/0002-take-lifecycle-storage-sync.md) (Accepted, v5.4.0) · [0003 Composite-stage elimination](adr/0003-composite-stage-elimination.md) (Accepted, v5.5.0) · [0004 Audio decoupling — voice re-apply](adr/0004-audio-decoupling-voice-reapply.md) (Accepted, v5.6.0) · [0005 Partial re-bake splice](adr/0005-partial-rebake-splice.md) (Accepted, v5.7.0 — execution behind flag, **default on**) | — |

---

## Canonical docs (win on their topic — never duplicated here)

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics through v5.9: native capture, preview=bake, timeline/trim, dirty layers, storage map, outbound index |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack + current browser-composite / FFmpeg fallback bake ladder |
| `docs/engineering-principles.md` | Semantic health, save pathways, ImageDB, pipeline-native effects |
| `docs/bug-archive.md` | `BUG-###` history (Phase-3 raw material) |
| `docs/v4-development-principles.md` | Branch model, compositing, WASM queues, sprint hygiene |
| `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md` | v5.4.0 Phase 0 as-built (TakeManager) |
| `docs/5.3.10-webcodecs-per-chunk-encoding.md` | WebCodecs backbone as-built (§0) |
| `docs/v5.6.0-audio-decoupling.md` | Audio decoupling + editing/timeline backend + partial-splice contract (§4.2, §13) |
| `docs/v5.8.0-trim-ui-visual-subtitle-editor.md` | Timeline visual subtitle editor as-built (v5.8.0) |
| `docs/v5.9.0-trim-apply-roadmap.md` | Atomic trim apply as-built (v5.9.0) |
| `docs/v5.10.0-raw-trim-apply-roadmap.md` | Raw-WebM trim as-built (v5.10.0) — post-trim voice re-apply restored; §7 = open real-browser QA gate |
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
- Any artifact save function changing caps/error behavior: re-check H13's persist-before-stamp contract.

## Version policy

- `architecture-map.md`: bump MINOR for additive content, MAJOR when a context/pipeline/storage class is added or removed.
- `extension-points.md`, `hardening-backlog.md`: version independently by seam/sprint.
- Never create `architecture-map-v2.md` — update in place.
- ADRs are immutable once Accepted; supersede with a new ADR instead of editing.

## Standards

- Diagrams embedded inline (Mermaid fenced blocks) — render-checked before commit.
- Each diagram has one sentence above (what it shows + what to verify it against) and the invariant(s) it encodes below.
- Every living doc ends with a carry-forward block for cold-session re-seeding.
- All ADRs use `adr/NNNN-short-title.md` (zero-padded, incrementing — 0006 is next).

## Resume in a new chat (carry-forward)

```
architecture-hardening resume.
Repo: Reddit Voice Notes, main @ tagged v5.10.0. Architecture map v2.7 (last full pass at v5.9.0).
Six contexts unchanged; primary subtitle bake is direct browser composite, with permanent FFmpeg fallbacks.
Editing arc ends at raw-trim apply: preview=APPLY, dual cue shift, base + raw WebM cut together
(audio-only; baseRecording re-stamped or honestly dropped — I19); post-trim voice re-apply works.
Open hardening: H13 acknowledged artifact persistence (High/S — v5.10 bounds pre-check at trim raw leg only);
H8 recovery voice provenance (Med/S).
H12 Studio progress delivery is resolved as direct runtime broadcast + tab-relay suppression.
Risks: R14 verified splice, R15 two-view draft, R16 narrow trim multi-store commit window.
Read architecture-map.md, extension-points.md v1.9, hardening-backlog.md v2.5.
```
