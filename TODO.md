# TODO

## v5.7.0 — Partial Re-bake Splice (Phase 2b) — **IN PROGRESS**

**Branch:** `feature/5.7.0-partial-rebake-splice` (from `main` @ `v5.6.0`) · **Contract:** [`docs/v5.6.0-audio-decoupling.md`](docs/v5.6.0-audio-decoupling.md) §4.2 + §12 follow-ups

Packet-level splice execution behind `coordinateRebake` — re-composite only dirty keyframe-aligned spans and splice back into the MP4. Requires fidelity-harness extension (v5.3.9.1 lesson). Planner + telemetry shipped in v5.6.0.

| Sprint | Scope | Status |
|--------|-------|--------|
| 1 | `src/editing/splice-plan.ts` — keyframe alignment + region model + plan/output validation gates + splice chronos + `scanKeyframes` gate (pure, Node-tested) | **done** — `test-splice-plan.mjs` 29/29 |
| 2 | `src/composite/composite-splice.ts` — browser executor (scan→plan→re-encode dirty GOPs→copy kept packets→interleave→validate; honest null-fallbacks) | **done (automated)** — flag-off, in-browser UNVERIFIED (avcC hazard) |
| 3 | **fidelity gate (the load-bearing avcC check):** `selectSpliceFidelityAnchors` (pure) + `verifySpliceKeptFrames` (kept frames pixel-identical vs original + boundary decodability); wired into `renderCompositeSplice` → miss throws → full fallback | **done (automated)** — `test-splice-plan` 33/33 |
| 4 | wire `coordinateRebake` conditional (`executed:'partial'` honest, AbortError passthrough) + `experimental.partialRebakeSplice` flag (default off) + `bakeWithOptionalSplice` in bake path + splice chronos copy; fixed executor to re-composite dirty regions from CLEAN base | **done (automated)** — `test-partial-rebake-plan` 13/13; flag-off |
| 5 | ADR-0005 + design doc §4.2 as-built + **§13 real-browser QA checklist** + README ADR index | **done** |

**Phase 2b code + docs COMPLETE.** Real-browser QA **in progress** — living checklist [`.ignore/QA-5.7.0/checklist.md`](.ignore/QA-5.7.0/checklist.md).

| Gate | Status |
|------|--------|
| A happy path (AVC splice) | **PASS** |
| B honesty + fidelity fallback | **PASS** (B3: close-window abort retains prior MP4) |
| C1 AVC | **PASS** |
| C2 VP9 | **RETEST** after VP9 `latencyMode:realtime` fix (A1 passed; A2 scan-gate pre-fix) |
| D honest fallbacks | **PASS** |
| E download / attach / artifact | **PASS** |
| Single-machine sign-off (A+B+(C1∨C2)+D+E) | **Ready (AVC)** once B3 accepted as unit-only |
| Default-on flip | **Not yet** — separate decision |

Ships dark (`experimental.partialRebakeSplice` default OFF); production unchanged until sign-off + default-on decision.

**Then (Phase 3):** trim UI + atomic artifact/cue/raw-WebM integration — own branch after 2b or parallel.

**Verify (baseline):** `node scripts/test-splice-plan.mjs` (33) · `test-partial-rebake-plan.mjs` (13) · `test-browser-composite-plan.mjs` (17) · `npm run build` PASS

## v5.6.0 — Audio Decoupling + Editing-Suite Backend — **TAGGED** `v5.6.0`

**Release notes:** [`docs/release-notes-v5.6.0.md`](docs/release-notes-v5.6.0.md) · **Contract:** [`docs/v5.6.0-audio-decoupling.md`](docs/v5.6.0-audio-decoupling.md) · **ADR:** [`0004`](docs/architecture/adr/0004-audio-decoupling-voice-reapply.md) · **Package:** `5.6.0` on `main` · **Push:** deferred

Voice re-apply shipped (Phase 1 QA PASS 2026-07-08). Editing backend scaffolds: timeline, dirty tracker, partial-rebake planner, trim backend (no UI).

**Restore:** `git checkout main && npm install && npm run dev`

## v5.5.1 — Browser composite default-on — **TAGGED** `v5.5.1`

**Release notes:** [`docs/release-notes-v5.5.1.md`](docs/release-notes-v5.5.1.md) · **Package:** `5.5.1` on `main` · **Push:** deferred

Flipped `experimental.browserComposite` default **true** + one-time rollout migration (Overlay Lab is dev-only; v5.5.0 opt-in was unreachable in production builds).

## v5.5.0 — Browser-side Full Composite — **TAGGED** `v5.5.0`

**Release notes:** [`docs/release-notes-v5.5.0.md`](docs/release-notes-v5.5.0.md) · **Plan/as-built:** [`docs/v5.5.0-browser-composite-migration.md`](docs/v5.5.0-browser-composite-migration.md)

**Restore:** `git checkout main && npm install && npm run dev`

## v5.4.0 — Design Studio First — **TAGGED** `v5.4.0`

**Roadmap:** [`docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`](docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md)  
**Release notes:** [`docs/release-notes-v5.4.0.md`](docs/release-notes-v5.4.0.md)  
**Merged:** `feature/v5.4.0-standalone-design-studio` → `main` (2026-07-06) · **Package:** `5.4.0` on `main`  
**Tag `v5.4.0`:** 2026-07-06 (after doc refresh)  
**Push:** deferred (user will push)

| Phase | Scope | Status |
|-------|-------|--------|
| Prep | `TakeManager` + session storage + storage-key sync + auto-draft | **done** |
| 1 | Current Take deck + Download MP4 | **done** |
| 2 | Studio-native recording + live WYSIWYG preview | **done** |
| 3 | Reddit as output target (attach mode) | **done** |
| 4 | Polish + QA hardening | **done** — user QA **PASS** (2026-07-06) |

**Restore:** `git checkout main && npm install && npm run dev`

**Deferred (not blocking release):**
- Demo site (`demo/src/studio/`) standalone capture parity
- Composite-stage perf (~43 s alphamerge wall on WebCodecs bakes)

## v5.3.10 — WebCodecs Per-Chunk Encoding — **MERGED & TAGGED**

**Tag:** `v5.3.10` on `main` · **Release notes:** [`docs/release-notes-v5.3.10.md`](docs/release-notes-v5.3.10.md)  
**Push:** deferred (local tag + merge only)

## v5.3.9 — Parallel Chunked Bake — **MERGED & TAGGED** (`v5.3.9`)

**Release notes:** [`docs/release-notes-v5.3.9.md`](docs/release-notes-v5.3.9.md)

### Quick verify on `main` @ 5.4.0

```bash
git checkout main && npm install && npm run dev
node scripts/test-take-manager.mjs
node scripts/test-take-deck.mjs
npm run build
```

**When ready:** `git tag v5.4.0` (after doc refresh) · `git push origin main --tags`

## Architecture hardening v2.0 — **COMPLETE** (2026-07-06)

Full `/architecture-hardening` pass + triage on `main` @ 5.4.0. Map **v2.1**, extension-points **v1.4**, hardening backlog **v2.1**, ADR-0002 (accepted) + ADR-0003 (stub, decision-first).

**H6 IMPLEMENTED:** `takeArtifactMatchesStore` + `clearArtifact` in `src/session/take-manager.ts`, verified at all three blob-consumption points (`studio-take-recovery.ts` resume · `recorder-panel.ts` attach via new `fetchBakedMp4Meta` · `current-take-status.ts` Download CTA). Mismatch → stamp demoted + "Recording superseded — re-record". Tests: `test-take-manager.mjs` **20/20** (6 new), `test-take-deck.mjs` 12/12, build PASS, tsc 6→4 pre-existing errors (fixed recovery `durationSeconds` TS2339 in passing).

**Triage:** H11 closed (user QA — concurrent recordings solid; transient length-display edge accepted) · H10 deferred (user decision) · H8 + H12 = v5.4.x patches · H9 = v5.5+ via ADR-0003. Details: [`docs/architecture/hardening-backlog.md`](docs/architecture/hardening-backlog.md).