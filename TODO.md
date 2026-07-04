# TODO

## v5.3.8 — Oklch Perceptual Hue Rotation (Phase 2) — **NEXT**

**Branch:** `feature/v5.3.8-oklch-rainbow` (create from `main`)  
**Design:** [`docs/5.3.8-oklch-rainbow-perceptual-uniformity-design.md`](docs/5.3.8-oklch-rainbow-perceptual-uniformity-design.md)  
**Roadmap:** [`docs/5.3.6-5.3.9-integrated-roadmap.md`](docs/5.3.6-5.3.9-integrated-roadmap.md) § Phase 2

| Deliverable | Status |
|-------------|--------|
| Oklch ↔ sRGB conversion module + tests | **done** — `src/utils/oklch.ts`, `scripts/test-oklch.mjs` |
| Rainbow / monochromatic hue paths → Oklch rotation | **done** — `subtitle-effects.ts` |
| Phase buckets 32 → 24 | **done** — `subtitle-overlay-cue-cache.ts` |
| Visual QA on animated effects | pending |

**After v5.3.8:** worker chunking → **v5.3.9** (`docs/5.3.9-worker-and-chunked-parallelization-design.md`).

## v5.3.7 — Editor Intelligence (Phase 1) — **MERGED & TAGGED**

**Tag:** `v5.3.7` on `main` · **Release notes:** [`docs/release-notes-v5.3.7.md`](docs/release-notes-v5.3.7.md)  
**Push:** deferred (local tag + merge only)

| Deliverable | Status |
|-------------|--------|
| Real-canvas measurement @ bake 640×360, backdrop vs frame | **done**, QA pass |
| LONG badge / fit status / Validate All | **done**, QA pass |
| Smart Adjust (Auto-fix re-splice + Mode A) | **done**, QA pass |
| Smart Adjust amber glow + “Auto-fix recommended” hint below button | **done** |
| Auto-validate on font size change (slider / Smart Adjust) | **done** |
| Smart Split word budget @ bake ink max (large-font over-split fix) | **done** |

**Deferred:** Smart Adjust rich visual UI → `docs/future-ideas.md` § Smart Adjust UX.

**Next push when ready:** `git push origin main --tags`

## v5.3.6 — Smart Split relaxation — **TAGGED** (`v5.3.6`)

**Release notes:** [`docs/release-notes-v5.3.6.md`](docs/release-notes-v5.3.6.md)

## v5.3.5 — Cue-stable overlay caching — **COMPLETE**

**Tag:** `v5.3.5` (push deferred) · [`docs/5.3.5-cue-stable-overlay-caching-design.md`](docs/5.3.5-cue-stable-overlay-caching-design.md)

## v5.3.4 — Subtitle canvas overlay — **COMPLETE**

**Tag:** `v5.3.4` · [`docs/v5.3.4-subtitle-canvas-overlay.md`](docs/v5.3.4-subtitle-canvas-overlay.md)

### Restore / test (v5.3.7)

```bash
git checkout v5.3.7 && npm install && npm run dev
node scripts/test-smart-split.mjs
node scripts/test-cue-measurement.mjs
node scripts/test-transcript-edit-diff.mjs
node scripts/test-smart-adjust.mjs
node scripts/test-overlay-frame-pacing.mjs
node scripts/test-cue-cache.mjs
node scripts/test-oklch.mjs
```

Design Studio → Subtitles → **Edit transcript** → Validate all / Smart Adjust when ⚠ LONG cues appear.