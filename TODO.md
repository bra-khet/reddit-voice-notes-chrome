# TODO

## v5.3.6 Phase 1 — Editor Intelligence — **COMPLETE** (pre-merge polish)

**Branch:** `feature/v5.3.6-smart-split-refactor` — ready to merge → `main` (rolls into next tag with BUG-036 + 24px headroom).  
**Roadmap:** [`docs/5.3.6-5.3.8-integrated-roadmap.md`](docs/5.3.6-5.3.8-integrated-roadmap.md)

| Deliverable | Status |
|-------------|--------|
| Real-canvas measurement @ bake 640×360, backdrop vs frame | **done**, QA pass |
| LONG badge / fit status / Validate All | **done**, QA pass |
| Smart Adjust (Auto-fix re-splice + Mode A) | **done**, QA pass |
| Smart Adjust amber glow + “Auto-fix recommended” hint below button | **done** |
| Auto-validate on font size change (slider / Smart Adjust) | **done** |
| Smart Split word budget @ bake ink max (large-font over-split fix) | **done** |

**Deferred:** Smart Adjust rich visual UI → `docs/future-ideas.md` § Smart Adjust UX.

**Next:** merge branch → `main`, tag next release. **Then:** Oklch (v5.3.7 / Phase 2); worker chunking (v5.3.8 / Phase 3).

## v5.3.6+ — on `main` (next tag)

**Includes:** tagged `v5.3.6` baseline + BUG-036 + 24px headroom + Phase 1 (after merge).

## v5.3.6 — Smart Split relaxation — **TAGGED** (`v5.3.6`)

**Release notes:** [`docs/release-notes-v5.3.6.md`](docs/release-notes-v5.3.6.md)

## v5.3.5 — Cue-stable overlay caching — **COMPLETE**

**Tag:** `v5.3.5` (push deferred) · [`docs/5.3.5-cue-stable-overlay-caching-design.md`](docs/5.3.5-cue-stable-overlay-caching-design.md)

## v5.3.4 — Subtitle canvas overlay — **COMPLETE**

**Tag:** `v5.3.4` · [`docs/v5.3.4-subtitle-canvas-overlay.md`](docs/v5.3.4-subtitle-canvas-overlay.md)

### Restore / test (Phase 1 branch)

```bash
git checkout feature/v5.3.6-smart-split-refactor && npm install && npm run dev
node scripts/test-smart-split.mjs
node scripts/test-cue-measurement.mjs
node scripts/test-transcript-edit-diff.mjs
node scripts/test-smart-adjust.mjs
node scripts/test-overlay-frame-pacing.mjs
node scripts/test-cue-cache.mjs
```

Design Studio → Subtitles → **Edit transcript** → Validate all / Smart Adjust when ⚠ LONG cues appear.