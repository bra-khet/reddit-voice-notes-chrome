# TODO

## v5.6.0 — Audio Decoupling + Editing-Suite Backend — **CODE COMPLETE, QA PENDING**

**Branch:** `feature/5.6.0-audio-decoupling` · **Contract:** [`docs/v5.6.0-audio-decoupling.md`](docs/v5.6.0-audio-decoupling.md) (§12 as-built) · **ADR:** [`0004`](docs/architecture/adr/0004-audio-decoupling-voice-reapply.md)

"Change Voice" without re-recording: `TakeVoiceStamp` provenance + Dulcet II re-render + stream-copy remux (visuals bit-exact). Editing backend: timeline primitives, dirty tracking, partial-rebake **planner** (execution = Phase 2b), trim backend (artifact integration deferred).

**Urgent / next:**
- [ ] User QA: e2e re-apply on a fresh take (voice A → B; audio differs, visuals identical, attach works; voice-off apply; legacy degradation).
- [ ] On QA pass: version bump + release notes + merge/tag per repo convention.
- [ ] Follow-up branches: Phase 2b splice execution (behind `coordinateRebake`), trim artifact integration + cue shift.

**Verify:** `node scripts/test-voice-reapply-plan.mjs` (12) · `test-timeline.mjs` (10) · `test-segment-dirty-tracker.mjs` (11) · `test-partial-rebake-plan.mjs` (9) · `test-take-manager.mjs` (31) · `npm run build` PASS

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