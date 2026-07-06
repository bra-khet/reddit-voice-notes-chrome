# TODO

## v5.4.0 — Design Studio First — **MERGED TO `main`** (tag deferred)

**Roadmap:** [`docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`](docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md)  
**Release notes:** [`docs/release-notes-v5.4.0.md`](docs/release-notes-v5.4.0.md)  
**Merged:** `feature/v5.4.0-standalone-design-studio` → `main` (2026-07-06) · **Package:** `5.4.0` on `main`  
**Tag `v5.4.0`:** deferred until user completes external doc refresh  
**Push:** deferred (local only)

| Phase | Scope | Status |
|-------|-------|--------|
| Prep | `TakeManager` + session storage + storage-key sync + auto-draft | **done** |
| 1 | Current Take deck + Download MP4 | **done** |
| 2 | Studio-native recording + live WYSIWYG preview | **done** |
| 3 | Reddit as output target (attach mode) | **done** |
| 4 | Polish + QA hardening | **done** — user QA **PASS** (2026-07-06) |

**Restore:** `git checkout main && npm install && npm run dev`

**Deferred (not blocking tag):**
- Demo site (`demo/src/studio/`) standalone capture parity
- Composite-stage perf (~43 s alphamerge wall on WebCodecs bakes)
- External documentation refresh (user-owned, before tag)

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

## Architecture hardening v2.0 refresh — 2026-07-06

Full `/architecture-hardening` pass on `main` @ 5.4.0. Map bumped **v2.0**, extension-points **v1.3** (take lifecycle + Studio capture host seams), hardening backlog **v2.0** (H6–H12 + WebCodecs/canvas risk register), ADR-0002 (TakeManager storage sync, accepted) + ADR-0003 (composite-stage, stub).

**Top open hardening item:** **H6** — `TakeArtifactStamp` cross-check is documented in `src/session/take-manager.ts` but unimplemented at consumption sites (attach / recovery / Download CTA) — see [`docs/architecture/hardening-backlog.md`](docs/architecture/hardening-backlog.md). Recommended before or shortly after the `v5.4.0` tag.