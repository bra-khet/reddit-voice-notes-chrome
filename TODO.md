# TODO

## v5.5.0 — Browser-side Full Composite — **IN DEVELOPMENT**

**Branch:** `feature/v5.5.0-browser-composite` · **Decision:** ADR-0003 (accepted) · **Plan/as-built:** [`docs/v5.5.0-browser-composite-migration.md`](docs/v5.5.0-browser-composite-migration.md)

| Phase | Scope | Status |
|-------|-------|--------|
| 0+1 (collapsed) | `src/composite/*` + hybrid behind `experimental.browserComposite` + Lab A/B toggle + timing v4 + tests | **done** (2026-07-07, commits `c1a79fe` + `b00f381`) |
| 0 QA gate | **USER:** Lab bake ON vs OFF side-by-side (R9), take/attach/H6 e2e, 2:00-cap size (R13), second machine (R11) — checklist in roadmap §Phase 0 QA gate | **open — blocks everything below** |
| 2 | Default flip (`browserComposite: true` + rollout migration), retire alphamerge tiers for constructed path, `transcription-architecture.md` + diagrams catch-up | pending QA |
| 3 | Fidelity Lab surface (consume `composite-fidelity.ts`), release notes, merge + tag `v5.5.0` | pending |

**Verify now:** `node scripts/test-browser-composite-plan.mjs` (14) · all suites PASS · build PASS · tsc 4 pre-existing only

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