# Architecture docs — Reddit Voice Notes

**Updated:** 2026-07-13 · **Reflects:** `feature/v5.11.0-prefs-storage-refactor` @ package `5.11.0` · **browser QA PASS** · **Map:** v3.1 · **Skill:** `/architecture-hardening`

This directory holds the **living, versioned** architecture index for the extension. It is the cross-cutting view — subsystem internals live in the canonical docs listed below.

**Inbound rule:** Any doc or session touching cross-context design, new pipelines, new storage, or new effects should link here and check the extension-points registry before writing code.

---

## Index

| File | Owns | Version |
|------|------|---------|
| [`architecture-map.md`](architecture-map.md) | Cross-cutting architecture: six contexts, current diagrams, first-class concerns, invariants I1–I21, preference publication/relay, and recovery traces | v3.1 |
| [`extension-points.md`](extension-points.md) | Integration seam registry: preference storage v2 (QA PASS), message pipelines v3, H13 storage rule, H8 capture intent, Studio/capture, browser/fallback composite, take/audio editing, splice, timeline, and trim | v1.15 |
| [`hardening-backlog.md`](hardening-backlog.md) | Ranked hardening: H8/H13/H14 fully closed (browser QA PASS); R18 prefs gate closed; H10 deferred | v2.13 |
| `adr/` | [0001 WebCodecs encoding backbone](adr/0001-webcodecs-encoding-backbone.md) · [0002 Take lifecycle storage sync](adr/0002-take-lifecycle-storage-sync.md) · [0003 Composite-stage elimination](adr/0003-composite-stage-elimination.md) · [0004 Audio decoupling — voice re-apply](adr/0004-audio-decoupling-voice-reapply.md) · [0005 Partial re-bake splice](adr/0005-partial-rebake-splice.md) · [0006 Full-IDB user preferences](adr/0006-user-preferences-full-idb.md) | Accepted |

---

## Canonical docs (win on their topic — never duplicated here)

| Doc | Owns |
|-----|------|
| `docs/design-studio.md` | Studio semantics through v5.10: native capture, preview=bake, timeline/trim + raw WebM, dirty layers, storage map, outbound index |
| `docs/transcription-architecture.md` | Vosk sandbox CSP stack + current browser-composite / FFmpeg fallback bake ladder |
| `docs/engineering-principles.md` | Semantic health, save pathways, ImageDB, pipeline-native effects |
| `docs/bug-archive.md` | `BUG-###` history (Phase-3 raw material) |
| `docs/v4-development-principles.md` | Branch model, compositing, WASM queues, sprint hygiene |
| `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md` | v5.4.0 Phase 0 as-built (TakeManager) |
| `docs/5.3.10-webcodecs-per-chunk-encoding.md` | WebCodecs backbone as-built (§0) |
| `docs/v5.6.0-audio-decoupling.md` | Audio decoupling + editing/timeline backend + partial-splice contract (§4.2, §13) |
| `docs/v5.8.0-trim-ui-visual-subtitle-editor.md` | Timeline visual subtitle editor as-built (v5.8.0) |
| `docs/v5.9.0-trim-apply-roadmap.md` | Atomic trim apply as-built (v5.9.0) |
| `docs/v5.10.0-raw-trim-apply-roadmap.md` | Raw-WebM trim as-built (v5.10.0) — post-trim voice re-apply restored; real-browser QA PASS 2026-07-12 |
| `docs/v5.11.0-prefs-storage-refactor.md` | Full-IDB preference migration + relay + Export/Import — **browser QA PASS 2026-07-13 · merge-ready** |
| `docs/release-notes-v5.10.0.md` | Latest ship notes on `main` (prior versions under `archive/docs/`); write `release-notes-v5.11.0.md` at tag |
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
- Any recoverable pipeline moving its only COMPLETE handler, timeout, or durable save into a tab: re-check H14/BUG-038's background terminal-owner contract.

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
Repo: Reddit Voice Notes, feature/v5.11.0-prefs-storage-refactor @ package 5.11.0.
Architecture map v3.1 · browser QA PASS 2026-07-13 · merge-ready.
Six contexts unchanged; primary subtitle bake is direct browser composite, with permanent FFmpeg fallbacks.
Editing arc CLOSED at raw-trim apply: preview=APPLY (I18), dual cue shift, base + raw WebM cut together
(audio-only; baseRecording re-stamped or honestly dropped — I19); post-trim voice re-apply works.
H13 RESOLVED + browser QA PASS: saveLast* throw on size/IDB failure + return persisted meta; the four
mutation choke points stamp/signal only from that meta; H6 reads untouched; test-artifact-store-writes.mjs 28.
H14/BUG-038 RESOLVED + browser QA PASS: background owns terminal transcript commit + 125s watchdog;
Node 12/12; tab-close mid-processing delivers transcript/scaffold. No retry UI (Vosk already succeeded).
H8 RESOLVED + browser QA PASS: captureVoiceIntent is persisted before transcode; recovery reuses it
and stamps the result even if resume-time prefs were mutated/nuked. No H8 re-run for v5.11.
v5.11 prefs: full rvnUserPrefs IDB (global/profiles/customStyles), signal-only rvnUserPrefs.v2;
Reddit content scripts relay DB load/replace through background. Focused 12/12 + build PASS;
real-browser matrix PASS 2026-07-13 (I21 High). No post-QA code fixes.
Legacy drafts retain current-prefs recovery with a visible note.
Risks: R13 closed by H13; R14 verified splice, R15 two-view draft, R16 trim multi-store window (3–4 stores);
R17 by H14; R18 by ADR-0006/I21 + browser QA.
Read architecture-map.md, extension-points.md v1.15, hardening-backlog.md v2.13, ADR-0006.
Next: merge v5.11.0 → main + tag/notes; v6.0 remains unscoped.
```
