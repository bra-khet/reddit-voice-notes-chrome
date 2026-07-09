# TODO

## v5.8.0 — Phase 3 Trim UI: Timeline Visual Subtitle Editor — **IN PROGRESS**

**Design:** [`docs/v5.8.0-trim-ui-visual-subtitle-editor.md`](docs/v5.8.0-trim-ui-visual-subtitle-editor.md) (authoritative) · **Scope:** [`docs/v5.8.0-scope.md`](docs/v5.8.0-scope.md)
**Branch:** `feature/v5.8.0-trim-ui-visual-subtitle-editor` (from `main` @ `1a8f370`) · **Package:** `5.7.0` (bump at release)

Visual timeline cue editor over the live v5.6/v5.7 editing backend. Committed: DOM-not-canvas, timeline-primary + List toggle, `SegmentEditorHandle` preserved, frame-snap via `timeline.ts` (I11), no new seam, Cividis palette.

| Sprint | Scope | Status |
|--------|-------|--------|
| 1 | docs redraft + committed architecture | **done** (`04e803d`, `be1c7be`) |
| 2 | foundation: `timeline-geometry` (pure) + read-only ruler/bars/playhead + List toggle | **done** (`f1f3d16`) |
| 3 | drag/resize (clamp-to-neighbor) + magnetism + bar↔inspector two-way sync + dirty | **done** (`e24eb96`) |
| 4 | **stage & zoom** (§16.1–16.2): stage-mode modal + view-window model + zoom cluster/wheel/pan + minimap + R1 label fix | **done** (`f73f013`) |
| 5 | **feel pass** (§16.3–16.4): short-cue ears, hysteresis snap + guides, grab-lift/spring, draggable playhead, Esc-cancel | next |
| 6 | **waveform lane** (§16.5): pure peaks leaf + canvas + fallback | pending |
| 7 | semiotic parity (LONG/fit-status, split gesture, per-cue play, scaffold, add/delete, keyboard + undo/redo + multi-select) | pending |
| 8 | smart integration: on-bar overflow/OOB/re-splice highlight + one-click apply | pending |
| 9 | trim hooks (in/out markers + cue-shift preview + intent) + polish/a11y/perf | pending |
| 10 | wire + verify + release (notes, version bump, QA sign-off) | pending |

*Ladder revised 2026-07-09 (Sprint-3 QA → design doc §16 "Stage" refinement addendum): zoom/layout/feel/waveform land before parity so later sprints build on the real surface.*

**Verify:** `node scripts/test-timeline-geometry.mjs` (37) · regression (timeline 10, segment-dirty-tracker 11, splice-plan 36, partial-rebake-plan 13, take-manager 31) · `npm run build` · `npx tsc --noEmit`
**QA pending (user):** real-browser — Sprint 3: drag/resize (clamp at neighbors, min 0.5s), Shift = fine control, inspector two-way sync, dirty amber chip, Apply keeps timeline edits. **Sprint 4: Timeline tab expands the modal into the landscape stage (List returns compact); inspector docks right; Ctrl+wheel zooms at the cursor; plain wheel pans when zoomed; zoom cluster (Fit / Sel / − slider + / readout) works; minimap appears when zoomed — lens drag pans, lens edge-drag zooms, strip click jumps; transport ▶ plays the selected cue + timecode tracks the playhead; short/dense cues no longer show garbled overflowing text (R1); reopen modal → zoom reset to fit.**

**Restore:** `git checkout feature/v5.8.0-trim-ui-visual-subtitle-editor && npm install && npm run dev`

## v5.7.0 — Partial Re-bake Splice (Phase 2b) — **TAGGED** `v5.7.0`

**Release notes:** [`docs/release-notes-v5.7.0.md`](docs/release-notes-v5.7.0.md) · **ADR:** [`0005`](docs/architecture/adr/0005-partial-rebake-splice.md) · **Contract:** [`docs/v5.6.0-audio-decoupling.md`](docs/v5.6.0-audio-decoupling.md) §4.2 + §13  
**Package:** `5.7.0` on `main` · **Push:** deferred

Real-browser QA **SIGNED OFF** (2026-07-08, Windows/Chrome): A–E, **C1 AVC + C2 VP9**. `experimental.partialRebakeSplice` **default ON** (opt-out `false`).

| Sprint | Scope | Status |
|--------|-------|--------|
| 1–5 | plan + executor + fidelity + wire + docs | **done** |
| Real-browser QA | §13 A–E, C1+C2 | **PASS** (single machine) |
| Default-on | resolve `!== false` | **done** in `v5.7.0` |

**Then (Phase 3):** trim UI + atomic artifact/cue/raw-WebM integration — own branch.

**Verify:** `node scripts/test-splice-plan.mjs` (36) · `test-partial-rebake-plan.mjs` (13) · `test-browser-composite-plan.mjs` (17) · `npm run build`

**Restore:** `git checkout main && npm install && npm run dev`

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
