# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on the current release boundary. The complete sprint-by-sprint record through the three v6.0 development tracks is preserved verbatim at [`archive/progress/claude-progress-through-v6.0.0-tracks.md`](archive/progress/claude-progress-through-v6.0.0-tracks.md). Earlier snapshots remain indexed by [`docs/HISTORY.md`](docs/HISTORY.md) and [`archive/README.md`](archive/README.md).

---

## Current stable — v5.11.0 preferences full-IDB migration

**SHIPPED · browser QA PASS 2026-07-13 · merged to `main` + tagged `v5.11.0` · push deferred.**

- Durable user-preference truth lives in extension-origin IndexedDB `rvnUserPrefs` (`global`, `profiles`, `customStyles`); `rvnUserPrefs.v2` is signal/revision only.
- Public `UserPreferencesV1` API and `USER_PREFS_VERSION = 1` remain stable. Content scripts use bounded background relays; one-time v1 migration is delete-after-success and retryable on failure.
- Studio profile management includes versioned JSON Export/Import and per-save size telemetry.
- Automated `test-user-prefs-storage.mjs` **12/12**; browser matrix PASS. Canonical design: [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md), [ADR-0006](docs/architecture/adr/0006-user-preferences-full-idb.md), [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md).

---

## v6.0 “Polish & Visual Maturity” — all development tracks merged

**Code/QA integration complete on `main` 2026-07-20 · package remains `5.11.0` until the explicit v6 release commit/tag · no push performed.**

| Track | Outcome | Canonical record |
|-------|---------|------------------|
| **A — audio-reactive visuals** | **Confidence QA PASS · merged.** Six spectra, seven atmospheres, seven ordered stackables, Style Control Center, shared bounded performance governor, caption-safe dim, Cividis tokens. Accepted residual: Conway can park in a dead-edge corner after a long run while other colonies remain active. | [`docs/v6.0.0-custom-styles-refactor.md`](docs/v6.0.0-custom-styles-refactor.md) · ADR-0007/0009/0010 |
| **B — background layout** | **Full operator checklist PASS · merged at `7d1c649`.** Direct hero/precision manipulation, responsive jog console, presets, dim/blur/blends/plate/Holo/GIF, eye-dropper, framing aids, live Theme-only compare, keyboard/ARIA, and one session-only next-take A/B layout. | [`docs/v6.0.0-background-panel-refactor.md`](docs/v6.0.0-background-panel-refactor.md) · [ADR-0008](docs/architecture/adr/0008-background-direct-manipulation-layout.md) · [`qa/QA-6.0.0/track-b/qa-checklist.md`](qa/QA-6.0.0/track-b/qa-checklist.md) |
| **C — popup UI refresh** | **Agent QA gate PASS · merged.** Popup-only Cividis overlay and elevated restart caution; optional real-extension appearance eyeball remains non-blocking. | [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md) |

### Track B final evidence

- Operator reports **all checklist items pass**, including enlarged Position Preview, next-take A/B, saved-profile load, identity hot-swap, Classic/default no-background, popup coherence, keyboard positioning/scaling/reset, High Contrast, reduced motion, and preview→record→bake parity.
- Final control refinement moved the Center reset into the precision stage with a dedicated inward-arrow frame glyph and removed the redundant legacy Fit/Fill + 3×3 position UI. Migration-compatible `scaleMode` / discrete `position` fields remain normalized and emitted.
- Focused Track B automation: **89/89**. Shared UI tokens: PASS. Visual-size logic: **5/5**. Production build: PASS.
- Required real blur+GIF artifact gate: **23 MiB base / 29 MiB baked — PASS** against 25/30 MiB caps. Upper-end non-blur creative sample 28/35 MiB remains informational, not the defined gate.
- `npm run compile` reports only the same two pre-existing subtitle diagnostics: `subtitle-canvas-bake.ts:158` (`number` vs `Timeout`) and `subtitle-overlay-lab.ts:130` (optional `enabled` vs required boolean).
- No new execution context, message family, store, signal, dependency, compositing layer, preference version, or post-capture background renderer. Backgrounds remain Design-phase configuration captured into the base video at record time (I1/I3/I22).

### Deferred observations (not v6 merge blockers)

- Subtitle browser-composite/burn-in reportedly runs roughly **5–6× faster while the Studio window is minimized**. Investigate focused-window RAF/render contention, browser scheduling, or GPU behavior before changing the compositor.
- Track C’s optional §8 real-extension visual eyeball remains available but is not a state/architecture gate.
- Optional future: preference Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

---

## Architecture state

- Architecture map **v3.22**; extension points **v1.37**; hardening backlog **v2.13**; ADRs 0001–0010, with ADR-0008 Accepted and finalized for Track B.
- Six contexts remain unchanged: Reddit content script, background service worker, offscreen FFmpeg document, Vosk sandbox, Design Studio, popup.
- Background Layout v2 extends the existing personal-image draw slot: normalized preferences → Studio preview/direct manipulation → recorder hot-swap/relay → `drawUserBackgroundLayer` / `drawImageBackground`. Bake does not re-render it; subtitle-only post-base composition preserves captured background pixels.
- Canonical cross-cutting sources: [`docs/architecture/architecture-map.md`](docs/architecture/architecture-map.md), [`docs/architecture/extension-points.md`](docs/architecture/extension-points.md), [`docs/design-studio.md`](docs/design-studio.md).

---

## Immediate next

1. Decide and execute the explicit **v6.0.0 release boundary**: package/manifest version bump, release notes, final release build, and tag. Track implementation itself is complete.
2. User-owned push of `main` and tags remains deferred.
3. Treat the minimized-window bake-speed observation as a separate performance investigation, not a release blocker.

**Restore stable v5.11.0:** `git checkout v5.11.0 && npm install && npm run dev`
**Develop current main:** `git checkout main && npm install && npm run dev`

---

## Resume in a new chat

```text
Reddit Voice Notes current main: all v6.0 visual-maturity Tracks A/B/C merged; package still 5.11.0 pending explicit v6 release/tag.
Track B merged at 7d1c649 with full operator checklist PASS: responsive direct background layout, presets/effects/GIF/plate/Holo, framing/live compare, keyboard/ARIA, session-only A/B; focused 89/89 + build PASS; blur+GIF 23/29 MiB PASS.
Architecture map v3.22, extension points v1.37, ADR-0008 Accepted/final. No new context/message/store/signal/layer/dependency/USER_PREFS_VERSION.
Background is Design-phase and captured at record time (I1/I3/I22); no post-capture reposition or multi-format export.
Full pre-closeout history: archive/progress/claude-progress-through-v6.0.0-tracks.md.
NEXT: explicit v6.0.0 version/release-notes/tag decision; push is user-owned. Run architecture-hardening resume if deeper context is needed.
```
