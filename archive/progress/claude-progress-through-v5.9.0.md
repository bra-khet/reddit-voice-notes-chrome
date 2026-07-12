> **ARCHIVED SNAPSHOT — do not edit.**
> Captured **2026-07-11**, after **v5.9.0 (Atomic Trim Apply)** shipped and was tagged, by the second `/docs-archiving` **Refresh**.
> This is the complete, immutable session progress log for the **v5.8.0 → v5.9.0 timeline-and-trim arc**, including real-browser QA and post-QA fixes.
> Earlier detail is in [`claude-progress-pre-v5.8.0.md`](claude-progress-pre-v5.8.0.md) and [`claude-progress-pre-v5.4.0.md`](claude-progress-pre-v5.4.0.md).
> The slim living progress file is at [`claude-progress.md`](../../claude-progress.md); the milestone index is [`docs/HISTORY.md`](../../docs/HISTORY.md).

---

# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file — focused on the **current milestone (v5.8.0, Timeline Visual Subtitle Editor)** plus a compact handoff to the editing-suite backend it builds on (v5.6.0–v5.7.0). Everything earlier is preserved verbatim in the archive:

- Superseded editing-suite arc (v5.7.0 → v5.4.0, incl. v5.5.x / v5.3.10 handoff): [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- Full pre-v5.4.0 log (v5.3.10 → v1.0.0 MVP): [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)
- Superseded branch logs: [`archive/progress/`](archive/progress/) — `dulcet-branch.md`, `eloquent-branch.md`, `pretty-branch.md`

The full prior content is intact in the archive so this file stays small and actionable. Add new session entries above the older milestone sections; run `/docs-archiving` (Refresh) after the next milestone.

## v5.9.0 — Atomic Trim Apply — **SHIPPED / TAGGED `v5.9.0` (2026-07-11)**

**Branch:** merged `feature/v5.9.0-trim-apply` → `main` · **Package:** `5.9.0` · **Push:** deferred (user pushes)
**Authoritative design (as-built §10):** [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.9.0.md`](docs/release-notes-v5.9.0.md)

**Goal:** make v5.8.0's inert `edits.trim` intent actually cut — `applyTrimToMp4` wired to artifacts, automatic cue shift, H6 re-stamp. Completes the v5.6→v5.9 editing arc.

### Phase 0 — alignment + cue-shift helper (2026-07-11) — **DONE**

Roadmap verified claim-by-claim against live code; **four gaps folded in** (commit `7dd88be`): §3H dual-copy transcript shift (`rvnSessionTranscript` keeps original+edited — shifting only the working copy would let "revert" restore pre-trim times) + undo-stack reset · §3I baseRecording stamp cleared on apply (voice re-apply would desync full-length raw audio under the short video — voice locks in, honest clean-audio failure) · §3C corrected ("cue shift makes partial re-bake safe" was wrong-but-lucky: `computePartialRebakePlan`'s duration guard forces the full composite; `BAKED_MP4_READY_KEY` must NOT fire — no baked bytes) · §3G no-restore reality (single-slot stores) → two-click confirm. Placement: orchestrator in NEW `trim-apply.ts` (keeps `trim.ts` Node-bundleable), `shiftCuesForTrim` in `trim.ts` mirroring `projectCueThroughTrim` **exactly** (half-open, 1e-6 epsilon, NO cue-time frame-snap — preview=apply). `test-timeline` **10 → 16** (commit `bc9aab3`).

### Phase 1 — orchestrator + Apply UI (2026-07-11) — **DONE (automated)**

Commit `c2354e1`:
- **`src/editing/trim-apply.ts`** (NEW, parallels `voice-reapply.ts`): H6 base verify (mismatch demotes stamp) → `planTrim` gate vs the base **store meta** duration → mediabunny trim (progress) → dual transcript shift in memory (LIVE draft is the edited source) → superseded guard → commit-last: `saveLastBaseMp4` + `replaceSessionTranscriptResults` + ONE `updateCurrentTake` (`expectId`): new stamp · duration · `edits.trim=null` · `bakedMp4`/`baseRecording` stamp **deletes** · `baked→ready` · honest note.
- **`take-manager.ts`**: `CurrentTakePatch.artifacts` accepts `null` = delete (atomic add+drop in one write; also fixes explicit-undefined clobber). Tests **31 → 33**.
- **`session-transcript-db.ts`**: `replaceSessionTranscriptResults` (both copies; keeps jobId/capturedAt/error/isScaffolded; stamps confirmedAt).
- **`subtitle-timeline-editor.ts`**: **Apply trim** in the trim strip — two-click confirm (armed = negate palette, `Cut N.Ns — confirm`; marker edit / Esc disarms, capture-phase so the modal never closes under a pending confirm), `Cutting… N%`, markers inert mid-apply. New dep `onApplyTrim`.
- **`subtitle-segment-editor.ts`**: host impl — `captureActiveDraft` → orchestrator → full re-seed (voskOriginal/edited/savedBaseline/drafts) · undo cleared · caches invalidated · `resetView` · re-render/notify · `onSaveEdits` re-invoked **fire-and-forget** (awaiting would paint stale veils before trim-mode exit) · `loadRecordingSource` picks up trimmed audio via the fresh stamp cache key.

### Phase 2 — docs + release prep (2026-07-11) — **DONE; QA HANDOFF**

Baked-consumer sweep: all four `loadLastBakedMp4` readers safe post-stamp-drop (Download per-stamp H6; voice-reapply skips absent baked leg AND dies first at cleared baseRecording; background relay gated panel-side; splice duration-guarded) — no code needed. Docs: **architecture-map v2.5** (changelog, `edits.trim` consumed, confidence row, carry-forward) · **extension-points v1.7** (trim-apply entry, preview=APPLY, voice-lock + full-composite gotchas) · release notes · version bump **5.8.0 → 5.9.0** (package.json + lockfile + `src/utils/version.ts` — the v5.8 drift lesson) · TODO/progress refresh.

**Verify (release sweep):** timeline **16** · take-manager **33** · dirty **11** · splice **36** · partial-rebake **13** · geometry **48** · waveform-peaks **10** · take-deck **12** · browser-composite-plan **17** · `npm run build` PASS @ 5.9.0 · `tsc` clean (3 documented pre-existing).

### Real-browser QA + post-QA fixes (2026-07-11) — **PASS → merge/tag**

User sign-off (Windows/Chrome) covers roadmap §7 / release-notes table:

| Row | Verdict |
|-----|---------|
| Apply happy path (duration + cues vs ghosts) | **PASS** |
| Bake after apply = full composite + subs on new timeline | **PASS** |
| Change Voice after apply | **PASS (accepted UX)** — button grays out + same re-record path as no-valid-clip; no desync. Not trim-specific copy (design note for later UI; no code change) |
| Revert / Ctrl+Z honesty | **PASS** |
| Deck / Download / attach trimmed base | **PASS** |
| 1s min keep + all-cues-removed | **PASS** |
| Recovery after apply + close | **PASS** |
| Editor + untrimmed voice re-apply regression | **PASS** |

**Post-QA commits on the feature branch:** Reddit panel same-take attach promote aborting transcription (`751da08`); trim OUT forced to whole-second floored meta (`24066bc` — stop stamps precise duration; trim uses max(meta, decoded); `clampTrimRange` keeps true clip end).

**Merge:** `feature/v5.9.0-trim-apply` → `main` · **Tag:** `v5.9.0`.

---

## v5.8.0 — Phase 3 Trim UI: Timeline Visual Subtitle Editor — **TAGGED** `v5.8.0`

**Branch:** merged `feature/v5.8.0-trim-ui-visual-subtitle-editor` → `main` (2026-07-10) · **Package:** `5.8.0` · **Push:** deferred (user pushes)
**Authoritative design (as-built):** [`docs/v5.8.0-trim-ui-visual-subtitle-editor.md`](docs/v5.8.0-trim-ui-visual-subtitle-editor.md) · **Scope card:** [`docs/v5.8.0-scope.md`](docs/v5.8.0-scope.md) · **Release notes:** [`docs/release-notes-v5.8.0.md`](docs/release-notes-v5.8.0.md)

**Goal:** replace the flat cue-list modal with a timeline-centric visual editor (draggable/resizable bars, playhead scrub, on-bar suggestion highlighting) that keeps EVERY current semiotic affordance and wires edits into the already-live dirty→partial-rebake pipeline (v5.7.0, default-on). Backend is done; this phase is the surface.

**Committed architecture (design §3):** DOM + CSS-transform bars (not canvas) for free semiotic/a11y parity · timeline primary + List toggle (lossless, same draft) · `SegmentEditorHandle` preserved verbatim (mount untouched) · all frame snapping via `timeline.ts` (frame-exact = preview=bake, I11) · no new message/storage/take-writer seam · reuse every existing pure module. Palette = Cividis indigo→amber (`studio-palette.css`), color always paired with icon/label (CVD-safe).

### Sprint 1 — docs redraft + committed architecture (2026-07-09) — **DONE**

Redrafted both v5.8.0 docs to project standard; folded the user's authoritative decisions (CSS-containment scaling + virtualization escape hatch, 16px hit-test + fight-priority + pointer re-acquisition + sticky-break, snap magnetism priority neighbor>playhead>tick>frame, rove-select/nudge-timing keyboard, trim overhang behavior, palette rules). Commits `04e803d` (redraft) + `be1c7be` (decision fold).

### Sprint 2 — timeline foundation (read-only + view toggle) (2026-07-09) — **DONE (automated); real-browser QA pending**

- **`src/ui/design-studio/timeline-geometry.ts`** (NEW, pure, Node-tested) — seconds↔px (+ degenerate guards), bar layout (min visible width + honest rawWidth), nice-interval ruler ticks, 16px edge-handle hit-testing with deterministic nearest-boundary fight-priority (ties→start-handle), and `resolveSnap` on the authoritative magnetism priority with `snapTimeToFrame` ALWAYS applied last (Shift disables magnetism only). Frame math delegated to `timeline.ts` — geometry never invents its own.
- **`src/ui/design-studio/subtitle-timeline-editor.ts`** (NEW, UI) — DOM+CSS-transform substrate: renders ruler, cue bars (`translateX`/width), clip-end marker, playhead, read-only selected-cue inspector strip. Cividis state classes (normal indigo / selected amber / scaffold muted-dashed / oob red end-cap / playing amber glow). Playhead driven by cuePlayer via elapsed-time sweep (player has no `currentTime`) + ruler pointer scrub. Click-select. ResizeObserver re-layout. **Host owns the draft; the component never mutates it.**
- **`subtitle-segment-editor.ts`** — mounts the timeline; Timeline/List toggle (entering timeline captures in-flight list edits from the DOM → lossless); selection + timeline playback state; timeline re-render piggybacks every list re-render; teardown. Contract unchanged.
- **`style.css`** — `.studio__cue-timeline*` block on palette tokens; `content-visibility`/`contain`/`will-change` per the scaling decision; reduced-motion substitutes.

**Verify (automated):** `test-timeline-geometry` **18/18** · regression (timeline 10, segment-dirty-tracker 11, splice-plan 36, partial-rebake-plan 13) · `npm run build` PASS · `tsc` clean (3 documented pre-existing only). Commits `be1c7be` + `f1f3d16`.

### Sprint 3 — drag/resize + magnetism + inspector sync (2026-07-09) — **DONE (automated); real-browser QA pending**

Decisions confirmed by user: resize policy = **clamp to nearest neighbor edge** (bars touch, never overlap); magnetism neighbor 12px > playhead/tick 8px (QA-tune later); implement recommended defaults elsewhere. Sprint 2 dev-QA'd by user (renders, palette "exactly what I wanted").

- **`timeline-geometry.ts`** (+5 tests → **23**) — `constrainResizeStart`/`constrainResizeEnd`/`constrainMove`: the clamp-to-neighbor policy (touch-not-overlap), `MIN_CUE_DURATION_SECONDS` 0.5, degenerate bars pin to floor.
- **`subtitle-timeline-editor.ts`** — body-drag move (duration preserved) + edge-handle resize; pointer-capture + click-slop (drag vs select) + vertical-tolerance suspend/re-acquire ([[project_slider_vertical_dropoff]] pattern); magnetism (neighbor 12 / soft 8, Shift disables, `snapTimeToFrame` always last). **Editable inspector** (Start/End inputs + text + ▶) with live **two-way sync** (drag→fields, type→bar); targeted DOM updates during interaction (no full re-render); dirty cue = amber number-chip.
- **`subtitle-segment-editor.ts`** — the load-bearing **two-view source-of-truth fix**: `captureActiveDraft()` reads the list DOM only when List is active; Timeline keeps `modalDraft` current (edits write straight to it). Without it, a timeline edit + Apply would read stale list values and be lost. New deps: `getFps`, `onCommitTiming`, `onCommitText` (mirrors blank→soft-hyphen), `isDirtyIndex`.
- **`style.css`** — `--dirty` amber chip, editable-inspector inputs, grab cursor, `touch-action:none`.

**Verify:** `test-timeline-geometry` **23** · regression (timeline 10, dirty 11, splice-plan 36, partial-rebake-plan 13, take-manager 31) · `npm run build` PASS · `tsc` clean (3 pre-existing). Commit `e24eb96`.

### Refinement design pass — the "Stage" direction (2026-07-09) — **DONE (docs)**

Sprint-3 user QA verdict: modal cramped, short cues un-grabbable, snap fight-y, no zoom, no waveform, bar-label overflow glitch (defect **R1**). Folded the full refinement brief into the authoritative design doc as **§16** (+ scope card + revised ladder): **16.1** stage-mode landscape modal (animated expand, inspector docks right) · **16.2** log-zoom view window (fit/selection/Ctrl-wheel/pan + minimap lens; px-derived snap tolerances now scale with zoom) · **16.3** short-cue outboard "ears" + hit slop · **16.4** hysteresis snapping + snap guides + Esc-cancel · **16.5** waveform lane (additive `getDecodedBuffer()` on cuePlayer + pure `waveform-peaks.ts` Node-tested + one canvas backdrop, repaint only on window change) · **16.6** materials/type/micro-interaction spec (grab-lift/spring, tabular mono, label fade-mask = R1 fix) · **16.7** undo/redo + multi-select. No implementation code this sprint.

### Sprint 4 — stage mode + view-window zoom (2026-07-09) — **DONE (automated); real-browser QA pending**

User approved the §16 mockup verbatim ("we'll go with something just like that").

- **`timeline-geometry.ts`** (+14 tests → **37**) — `TimelineWindow` view model: `fitWindow`/`clampWindow`/`minWindowSeconds` (max(0.5 s, 4 frames) zoom cap), **anchored** `zoomWindowAt` (time under cursor stays put), `panWindow`, `windowForSpan` (zoom-to-selection), `windowFromZoomFactor` + log slider mapping, `WindowViewport` px mapping (`windowSecondsToPx` unclamped/culling, `windowPxToSeconds` clamped/pointer), `layoutBarsInWindow` (culls off-window, **original indices preserved**), `generateRulerTicksInWindow` (absolute labels), minimap lens math.
- **`subtitle-timeline-editor.ts`** — all sec↔px through the window viewport (snap tolerances too → **magnetism precision scales with zoom for free**); new shell: lanes (ruler/track/minimap) + transport bar (▶-selected + amber mono timecode + zoom cluster Fit/Sel/−/slider/+/N.N×) + inspector in the right rail with select-hint; Ctrl+wheel anchored zoom (captures pinch), plain wheel pans when zoomed, minimap lens drag=pan / edge-drag=zoom / strip-click=jump; playhead + clip-end hide when off-window; `resetView()` on the handle.
- **`subtitle-segment-editor.ts`** — `.studio__transcript-modal--stage` toggle in `applyViewMode` (Timeline expands the dialog, List compact) + `resetView()` on `openModal` (no stale zoom across takes). Neighbor clamp bounds stay FULL-timeline — zoom never changes edit constraints.
- **`style.css`** — stage dialog expansion `min(1240px, 100vw−48px)` w/ 300 ms settle (reduced-motion → none); stage grid (main + 264 px rail; single column ≤960 px); lanes/minimap/transport/zoom styling on palette tokens. **BUG FIX R1:** bar text ends in a gradient fade mask (no mid-glyph clip); floored-width bars (`--tiny`) hide label/text.

**Verify:** `test-timeline-geometry` **37** · regression (timeline 10, dirty 11, splice-plan 36, partial-rebake-plan 13, take-manager 31) · `npm run build` PASS · `tsc` clean (3 pre-existing). Commits `f581eb5` (design fold) + `f73f013` (code).

### Sprint 5 — feel pass (2026-07-09) — **DONE (automated); real-browser QA pending**

User approved Sprint 4 + the auto-pan candidate, and requested one addition: the selected cue's minimap block highlighted amber ("where am I" in the overview).

- **`timeline-geometry.ts`** (+5 tests → **42**) — `resolveSnapSticky`: **hysteresis** snapping (acquire at enter tolerance, break only past release = enter + 6 px; returns held magnet + `acquired` flag for the flash; Shift bypasses; frame quantization always last).
- **`subtitle-timeline-editor.ts`** — **ears** (§16.3): bars < 44 px move trim handles outboard as always-visible 8 px tabs (whole inner width = body/move; works down to the 12 px floor); ±3 px hit slop on all handles. **Sticky drag snap** with per-kind release radii + **snap guide** (1 px line, violet = neighbor/tick, amber = playhead) + one-shot acquisition **flash**. **Auto-pan** (28 px edge zone, depth-scaled RAF, stops at clip edges; `panAccumSeconds` carries the cue with the sliding window; wheel-zoom ignored mid-drag). **Esc cancels** the gesture (capture-phase keydown so it never closes the modal). **Grab lift** via `--grabbed` (in `barStateClasses` so auto-pan re-renders preserve it). **Playhead cap** teardrop in the ruler (re-appended by `renderRuler`; ruler owns the scrub). **Minimap selected-cue amber highlight** (user-requested).
- **`style.css`** — ears/lift/guide/cap/minimap blocks; lift transitions `top`/`box-shadow` ONLY (never `transform` — drags stay 1:1); spring settle `cubic-bezier(0.34,1.56,0.64,1)`; reduced-motion disables lift transition + flash.

**Verify:** `test-timeline-geometry` **42** · regression (timeline 10, dirty 11, splice-plan 36, partial-rebake-plan 13, take-manager 31) · `npm run build` PASS · `tsc` clean (3 pre-existing). Commit `a382d74`.

### Sprint 6 — waveform lane (2026-07-09) — **DONE (automated); real-browser QA pending**

Sprints 3–5 real-browser QA **PASSED** (user, 2026-07-09).

- **`segment-cue-player.ts`** — additive `getDecodedBuffer()` (non-breaking): the waveform reads the SAME decoded `AudioBuffer` the ▶ preview plays — zero extra decode.
- **`waveform-peaks.ts`** (NEW pure leaf, zero imports; `test-waveform-peaks.mjs` **10/10**) — `computeRangePeaks` (min/max bins, **time-aligned**: out-of-range bins silent, never stretched — lane stays honest against the ruler past clip end), `computeWaveformPyramid` (one 50 bins/s full-clip pass per source), `resamplePeaks` (extrema-preserving fractional downsample; impulses survive).
- **`subtitle-timeline-editor.ts`** — 36 px canvas lane between ruler and track; DPR-aware; mirrored min/max fill `--studio-indigo-accent` + brighter `--studio-accent-bars` centerline (tokens via `getComputedStyle`); two-path peaks (pyramid resample at low zoom / exact range peaks at deep zoom where the window is small); **repaints only when the paint key (source gen + window + size + dpr) changes** — never per pointermove; playhead DOM echo above the canvas (cap → waveform → track = one line); quiet-centerline fallback in element mode; new dep `getDecodedAudioBuffer()`.
- **`subtitle-segment-editor.ts`** — dep wired; `loadRecordingSource()` re-renders the timeline when the decode lands. **`style.css`** — lane block (`pointer-events: none` so wheel zoom/pan falls through) + playhead echo.

**Verify:** `test-waveform-peaks` **10** (NEW) · `test-timeline-geometry` **42** · regression (timeline 10, dirty 11, splice-plan 36, partial-rebake-plan 13, take-manager 31) · `npm run build` PASS · `tsc` clean (3 pre-existing). Commit `905e718`.

### Waveform contrast fix (2026-07-10) — **DONE**

User QA on Sprint 6: fill too dim + lane too short. Fix (`300bd84`, same indigo axis): figure/ground swap (fill = bright `--studio-accent-bars` @0.9, baseline = dim muted silence reference UNDERNEATH — alone it stays the element-mode fallback) · **view-only display gain** normalizing peaks to the clip's own max (capped 4×; voice takes rarely peak past ~0.4) · lane 36→48 px on a darker ground.

### Sprint 7 — semiotic parity + keyboard + undo/redo + multi-select (2026-07-10) — **DONE (automated); real-browser QA pending**

- **Parity (§7):** ⚠ LONG warning-tint + pill on bars and ⚠ OOB pill (same `cueFitCache`/heuristic as list rows via `getCueFitState`); live fit-status line in the inspector (canvas/estimate + tier colors); ✂ Split + 🗑 delete in the inspector action row (same >1-chunk rule); **"+ Cue" adds at the playhead** (inserted in start order, 2 s clamped to next neighbor, selected). Timeline text edits drive the same heuristic→canvas fit pipeline via new index-based `scheduleCueFitMeasureForDraft` (the row-bound twin validates against the STALE list DOM); async results land via `handle.refreshCueState` — **targeted updates only, never a rebuild** (rebuild would steal textarea focus).
- **Keyboard (§6.4):** ←/→ rove (pans the cue into view when zoomed) · ↑/↓ nudge ±1 frame (×4 after ~8 held repeats) · Space play/stop · Enter → cue text · Del deletes selection · `aria-live` announcements + `.studio__sr-only`.
- **Undo/redo (§16.7, host):** bounded 50-deep snapshot stack, modal-session scoped, pushed at **discrete gesture starts** (drag first-move, field focus either view, nudge burst, structural ops) so one undo = one action; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; equal-top dedupe.
- **Multi-select:** Ctrl-click toggle + Shift-click range (resolved on pointerUP — Shift-drag stays fine-control, Ctrl never drags); batch nudge (ordered so neighbors vacate) + batch delete; zoom-to-selection frames the whole selection; minimap highlights all selected.

**Verify:** geometry **42** · waveform-peaks **10** · regression (timeline 10, dirty 11, splice 36, partial-rebake 13, take-manager 31) · build PASS · tsc clean (3 pre-existing). Commits `300bd84` (contrast) + `b0afad9` (sprint 7).

### List-view scrollbar regression fix (2026-07-10) — **DONE**

Sprint 7 real-browser QA **PASSED** (user) — including the waveform contrast fix. One regression reported: **List view lost its vertical scrollbar** (tab-focus force-scrolled the clipped dialog, hiding the header/close). Root cause: Sprint 2 wrapped `.studio__transcript-segments` in the unstyled `.studio__transcript-list-view` toggle container, demoting it from a direct flex child of the `overflow: hidden` dialog — the wrapper couldn't shrink below its content (`min-height: auto`), so the list clipped instead of scrolling. Fix (`a5a2a3f`): the wrapper is now a flex conduit (`flex: 1; min-height: 0;` column flex + `[hidden]` override), restoring the inner `flex:1/overflow-y:auto` scroll.

### Sprint 8 — smart integration (2026-07-10) — **DONE (automated); real-browser QA pending**

Suggestions surface *where the problem is* (design §8), reusing existing pure detectors only — `findOverflowingIndicesFromDraft` (cache-aware), `segmentHasOutOfBoundsEnd`, `collectMinimalFixProposals`; no new generation logic.

- **Host suggestion engine:** lazy stale-flagged `Map<index, CueSuggestionState>` — kind `overflow|oob`, **global priority ranking** (one-word-shift-fixable overflow first, then the rest in time order; OOB ranks with LONG), `hasMinimalFix`, human title (the proposal's own title when a fix exists). `syncSuggestionBars()` diff-refreshes only bars whose suggestion moved (fixing cue A renumbers cue B — targeted `refreshCueState`, never a rebuild). Invalidation at every draft/fit mutation; `currentCueSuggestions` never caches the hidden-modal empty result (openModal renders before unhiding).
- **On-bar:** `--suggested` state = static amber-action halo (matches the Smart Adjust attention affordance, §4.1 — the doc's stale §8 "cyan-ready" line corrected) + outboard **priority dot** (number + tooltip; always-in-DOM pill pattern; survives `--tiny`; suggested bars adopt the browser-proven eared overflow model so the dot paints outboard; centered above eared bars).
- **Inspector callout:** suggestion copy + **⚡ Apply minimal fix** (hidden when no one-click fix exists) + **Smart Adjust…**. Apply re-derives the proposal **fresh per click** (never a cached proposal against a moved draft; returns false when stale → honest aria-live) and flows through the existing `applySmartAdjustProposal` path (undo snapshot + apply + re-validate). Smart Adjust opens **pre-contextualized**: the bar's cue's minimal fixes lead the list; re-splice stays on top (recommended stays recommended).
- **Validate all paints onto bars** (§7 row 12): fresh canvas verdicts drive LONG tint + suggestion dots on every bar, not just list rows.

**Verify:** geometry **42** · waveform-peaks **10** · regression (timeline 10, dirty 11, splice 36, partial-rebake 13, take-manager 31) · build PASS · tsc clean (3 pre-existing). Commits `a5a2a3f` (scrollbar fix) + `7dafb30` (sprint 8).

### Sprint 8 real-browser QA notes (2026-07-10) — **partial; behavior matches design**

Screenshots `.ignore/QA-5.8.0/img/sprint8-1-revised.png` + `sprint8-2.png`:

- **On-bar:** LONG cue selected with amber treatment + priority dots on suggested bars — **PASS**.
- **Inspector callout:** selected overflow cue shows amber callout copy `Cue N overflows — try ✂ Split or Smart Adjust` + **Smart Adjust…** only — **PASS / expected**. **⚡ Apply minimal fix is correctly hidden** when `collectMinimalFixProposals` has no per-cue word-shift (this take: long multi-word overflow that neighbors cannot absorb). Not a missing control.
- **Smart Adjust from callout:** modal opens; **Recommended** re-splice stays on top; preserve re-splice second; no minimal-fix rows when none exist — **PASS** (pre-contextualization of word-shifts only applies when those proposals exist).
- **Still optional for full §8 sign-off:** construct a cue where a one-word shift fits both sides → confirm ⚡ appears, applies, renumbers, Ctrl+Z; Validate-all → bars; OOB drag → halo/dot; List scrollbar.

**BUG-037 (fixed same day):** pasting a PNG into `.ignore/…` crashed `wxt` on Windows (`EBUSY` on Vite FSWatcher). Dev-only; `wxt.config.ts` now ignores `.ignore` / `terminals` / `agent-tools` / `mcps`. See `docs/bug-archive.md` BUG-037.

**Sprint 8 QA close-out (2026-07-10):** user confirmed **full PASS** — Sprint 8 + the List-scrollbar fix, all remaining checklist items included.

### Sprint 9 — trim hooks + polish (2026-07-10) — **DONE (automated + real-browser QA PASS)**

Design §10 — **non-destructive trim**: markers are view state; only an explicit Save stores intent (`edits.trim` via the existing `planTrim` gate). Atomic apply stays a follow-up — nothing is cut this phase.

- **`timeline-geometry.ts`** (+6 tests → **48**) — pure `projectCueThroughTrim`: overhang classification (`none|clipped|removed`) + the cue-shift preview math (surviving span in post-trim seconds; half-open semantics, inverted spans normalized).
- **`subtitle-timeline-editor.ts`** — **✂ Trim** transport toggle (disabled without an honest clip duration) → trim mode: full-height warning **markers** with ✂ In/Out flags · **veils** (warning stripes over dimmed ground) on the cut regions · **ghost bars** previewing every surviving cue at its post-trim position (under the real bars; live during both marker AND cue drags via targeted `renderTrim` — never a full render per pointermove) · **overhang cues** get a dashed amber outline + breathing pulse (reduced-motion → static; outline not shadow, stacks with the suggestion halo). Marker drags: cue-edge magnetism (Shift disables) + frame snap + min-keep clamp; **Esc cancels**; keyboard — markers are `role=slider`, ←/→ nudges a frame (Shift ×10) with `aria-value*` + announcements. **Pending trim boundaries join the strong snap magnets for cue drags** — a cue edge locked to a trim point needs the deliberate hysteresis pull to escape (§10 locked feel, reusing `resolveSnapSticky`). Trim strip: mono readout (`Keep N.Ns · Δ −N.Ns`) + **Save trim / Clear** with an honest status line; Save adopts the authoritative frame-snapped range `planTrim` returns.
- **`trim.ts`** — additive `loadTrimIntent()` (reads `edits.trim` off the current take). **`subtitle-segment-editor.ts`** — trim deps: session cache of stored intent (loaded async on modal open) + `onSaveTrimIntent` through `planTrim` (validation errors surface in the strip) + `onClearTrimIntent`.
- **Polish pass (§12 row 9):** a11y audit of the new surface (sliders/pressed states/announcements/aria-hidden chrome), reduced-motion guard on the only new animation, all trim updates targeted. Windowizing stays un-built per §3B.1 (no profiling evidence demands it).

**Verify:** geometry **48** · waveform-peaks **10** · regression (timeline 10, dirty 11, splice 36, partial-rebake 13, take-manager 31) · build PASS · tsc clean (3 pre-existing). Commit `0260e9a` (+ docs `0e622df`).

### Sprint 9 real-browser QA (2026-07-10) — **PASS / SIGNED OFF**

User (Windows/Chrome, Design Studio, recorded take with known clip duration). Extension hard-reload required after Sprint 9 pull (stale bundle had no ✂ Trim in transport).

| Check | Result |
|-------|--------|
| ✂ Trim on Timeline transport (between + Cue and Fit) | **PASS** — present after reload; needs clip duration (disabled without) |
| Enter trim mode → markers at 0/clip; veils; Keep/Δ readout | **PASS** |
| Drag In/Out — control feels solid; snap / can't-cross / min keep | **PASS** (user: “decent control”) |
| **Save trim** stores intent; status “Saved… nothing cut yet” | **PASS** |
| Intent survives modal close/reopen (markers re-seed) | **PASS** |
| **Clear** removes stored intent | **PASS** |
| Bake after save (e.g. ~20s → ~15s keep) — duration/media **unchanged** | **PASS / expected** — intent only; no Apply control this phase |
| Atomic apply / shorter baked output | **Out of scope** — deferred follow-up (`applyTrimToMp4` exists, unwired); not Sprint 10 |

**Honesty contract confirmed with user:** Save = `edits.trim` on the take only. Revert path today = **Clear** (media never left the original state). When apply ships later, QA becomes: keep duration matches bake/download + cue shift + restore story for pre-apply artifacts.

### Sprint 10 — wire + verify + release (2026-07-10) — **DONE · TAGGED `v5.8.0`**

Release path only (per the Sprint-9 handoff note — no `applyTrimToMp4` wiring).

- **Integration check:** branch diff vs `main` confirms `subtitle-controls.ts` (the `SegmentEditorHandle` mount) untouched — §3F contract preserved verbatim; no message/storage-layer files changed; `trim.ts` +7 (additive read helper) and `segment-cue-player.ts` +10 (additive `getDecodedBuffer`) are the only non-UI src changes.
- **Version bump:** package.json + lockfile **5.7.0 → 5.8.0**; caught **stale `src/utils/version.ts`** still at `5.6.0` (missed in the v5.7.0 release; manifest reads package.json so shipped builds were unaffected) → now `5.8.0`. Built manifest verified `5.8.0`.
- **Release notes:** [`docs/release-notes-v5.8.0.md`](docs/release-notes-v5.8.0.md) — headline, what-shipped by area (stage/zoom/feel/waveform · parity/keyboard/undo/multi-select · smart · trim intent), fixes (R1, List scrollbar, waveform contrast, BUG-037, version drift), unchanged contracts, per-sprint QA table, verify commands, deferred list.
- **Docs close-out:** design doc + scope card headers flipped to **SHIPPED (as-built)**; scope card's stale "cividis cyan" suggestion wording corrected to the authoritative §4.1 amber (matches the doc-§8 fix from Sprint 8).
- **Full verify sweep (release):** geometry **48** · waveform-peaks **10** · timeline **10** · dirty-tracker **11** · splice-plan **36** · partial-rebake **13** · take-manager **31** · browser-composite-plan **17** · take-deck **12** · `npm run build` PASS @ 5.8.0 · `tsc` clean (3 documented pre-existing).
- **Merged** `feature/v5.8.0-trim-ui-visual-subtitle-editor` → `main` + tag **`v5.8.0`** (2026-07-10). **Push deferred** (user pushes `main` + tags).

**Follow-ups (own branches):** atomic trim **apply** (`applyTrimToMp4` + cue shift + H6 re-stamp + its own QA gate) · optional `/docs-archiving` Refresh now that the milestone closed.

```bash
git checkout main && npm install && npm run dev
node scripts/test-timeline-geometry.mjs && npm run build && npx tsc --noEmit
```

---

## Handoff context — editing-suite backend (v5.6.0 → v5.7.0)

v5.8.0's timeline editor sits on top of the editing / voice backend shipped in the two milestones just before it. Full sprint-by-sprint detail is archived ([`claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)); the essentials the current surface depends on:

- **v5.7.0 — Partial re-bake splice (Phase 2b)** · tag `v5.7.0` · release notes (living): [`docs/release-notes-v5.7.0.md`](docs/release-notes-v5.7.0.md) · [ADR-0005](docs/architecture/adr/0005-partial-rebake-splice.md). `experimental.partialRebakeSplice` **default ON**. Cue edits → dirty windows → keyframe-aligned GOP splice that re-encodes only the changed regions from the **CLEAN base**, gated by a self-verifying kept-region pixel-equality check (the avcC hazard). This is the pipeline v5.8.0's cue edits feed.
- **v5.6.0 — Audio decoupling + editing backend** · tag `v5.6.0` · release notes (living): [`docs/release-notes-v5.6.0.md`](docs/release-notes-v5.6.0.md) · [ADR-0004](docs/architecture/adr/0004-audio-decoupling-voice-reapply.md). Clean audio (raw `baseRecording`), `TakeVoiceStamp` provenance + stream-copy voice re-apply (visuals bit-exact), and the pure editing primitives `timeline.ts` / `segment-dirty-tracker.ts` / `partial-rebake-coordinator.ts` / `trim.ts` (`planTrim` + `edits.trim` intent) that the timeline UI reuses. No new message/storage seam.
- **Contract doc (authoritative, living):** [`docs/v5.6.0-audio-decoupling.md`](docs/v5.6.0-audio-decoupling.md) — §4.2 splice as-built, §13 real-browser QA checklist.
- **Older milestones** (v5.5.x browser composite · v5.4.0 Design Studio First · v5.3.10 WebCodecs) — see the archive snapshot + [`docs/HISTORY.md`](docs/HISTORY.md).

**Open follow-up (own branch):** atomic trim **apply** — wire `applyTrimToMp4` + automatic cue/transcript shift + H6 re-stamp behind its own QA gate. The `edits.trim` intent v5.8.0 stores stays inert until then.

---

## Where the rest of the history went

- **v5.7.0 → v5.4.0** — editing-suite arc, browser composite, Design Studio First: [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- **v5.3.10 → v1.0.0 MVP**: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- **Milestone-by-milestone index** (living + archived doc pointers): [`docs/HISTORY.md`](docs/HISTORY.md)
