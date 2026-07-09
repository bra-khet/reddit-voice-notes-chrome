# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file — focused on the **current milestone (v5.4.0, Design Studio First)** and its immediate `v5.3.10` handoff. Everything before that is preserved verbatim in the archive:

- Full pre-v5.4.0 log: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)
- Superseded branch logs: [`archive/progress/`](archive/progress/) — `dulcet-branch.md`, `eloquent-branch.md`, `pretty-branch.md`

The full prior content is intact in the archive so this file stays small and actionable. Add new session entries above the older milestone sections; run `/docs-archiving` (Refresh) after the next milestone.

## v5.8.0 — Phase 3 Trim UI: Timeline Visual Subtitle Editor — **IN PROGRESS**

**Branch:** `feature/v5.8.0-trim-ui-visual-subtitle-editor` (from `main` @ `1a8f370`) · **Package:** still `5.7.0` (bump at release) · **Push:** deferred
**Authoritative design:** [`docs/v5.8.0-trim-ui-visual-subtitle-editor.md`](docs/v5.8.0-trim-ui-visual-subtitle-editor.md) · **Scope card:** [`docs/v5.8.0-scope.md`](docs/v5.8.0-scope.md)

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

**Next — Sprint 5 (feel pass, §16.3–16.4 + 16.6):** short-cue outboard "ears" + hit slop, snap **hysteresis** (+6 px exit) + visual snap guides + acquisition flash, grab-lift/spring micro-interactions, draggable playhead cap, Esc cancels gesture. Candidate add: auto-pan when dragging a bar to the window edge (noted during Sprint 4). Then 6 (waveform lane) · 7 (semiotic parity + keyboard/undo/multi-select) · 8 (smart integration) · 9 (trim hooks + polish) · 10 (wire + verify + release).

```bash
git checkout feature/v5.8.0-trim-ui-visual-subtitle-editor && npm install && npm run dev
node scripts/test-timeline-geometry.mjs && npm run build && npx tsc --noEmit
```

---

## v5.7.0 — Partial Re-bake Splice (Phase 2b) — **TAGGED** `v5.7.0`

**Branch:** merged `feature/5.7.0-partial-rebake-splice` → `main` · **Package:** `5.7.0` · **Push:** deferred  
**Release notes:** `docs/release-notes-v5.7.0.md` · **ADR-0005** · **Contract:** `docs/v5.6.0-audio-decoupling.md` §4.2 + §13  
**Flag:** `experimental.partialRebakeSplice` **default ON** (opt-out `false`)

**Scope:** `coordinateRebake` packet splice execution + fidelity gate. Planner/telemetry landed in v5.6.0.

### Sprint 1 — pure splice-plan layer (2026-07-08) — **DONE (automated)**

The construction-level guarantee layer that must exist *before* any browser encode can claim a partial success (v5.3.9.1 lesson). New pure module `src/editing/splice-plan.ts`:

- **Keyframe alignment:** `alignFrameToKeyframeStart/End` expand the planner's *assumed-2s-grid* spans onto the artifact's **real** keyframe (GOP) boundaries — the crux: an encoder's actual keyframes need not sit on the 2s grid, and a splice may only replace whole GOPs.
- **Region model:** `planSplice()` → contiguous alternating `keep`/`reencode` regions covering `[0, frameCount)` exactly once; adjacent aligned GOP islands merge; honest `full` fallback when aligned coverage > `PARTIAL_REBAKE_MAX_COVERAGE` (0.6) or the keyframe layout is unreadable / doesn't start at frame 0.
- **Two gates:** `validateSplicePlan` (contiguity, alternation, every cut on a real keyframe, reencode ends on keyframe/EOS) and `validateSpliceOutput` ("partial never lies" — `kept + reencoded === output === expected` packet count, ≤1-frame duration drift).
- **Chronos:** distinct stages `partial-splice-{scan,reencode,assemble}` (never reuse `partial-rebake-plan` or `browser-composite-*`); banded progress from real counters (`computeSpliceReencodeRatio`/`computeSpliceAssembleRatio`).
- Frame-native, leaf module, zero behavior change: `coordinateRebake` still executes full and reports `executed: 'full'`.

**Verify:** `node scripts/test-splice-plan.mjs` **23/23** (incl. off-grid keyframe alignment + planner→splice integration) · regression: partial-rebake-plan 9, segment-dirty-tracker 11, timeline 10, browser-composite-plan 17 · `tsc` clean (4 documented pre-existing only) · `npm run build` PASS.

### Sprint 2 — browser splice executor (2026-07-08) — **DONE (automated); UNVERIFIED in-browser**

New module `src/composite/composite-splice.ts` — `renderCompositeSplice()`:

- **scan** — buffer the existing baked MP4's video packets (`EncodedPacketSink.packets({verifyKeyPackets:true})`), gate via pure `scanKeyframes` (rejects reordered/VFR/no-leading-keyframe → null → full). Packet index == global frame index by construction.
- **plan** — map dirty spans (seconds → whole-packet frame windows from the packets' OWN timestamps, fps-independent) → `planSplice` → `validateSplicePlan`; non-partial or invalid → null (full fallback).
- **reencode** — per `reencode` region: `VideoSampleSink.samples(startSec,endSec)` decode → draw base + `createOverlayFramePainter`(new cues) → raw `VideoEncoder` (artifact's OWN codec string for max SPS/PPS compat, `avc:{format:'avc'}`), **forced keyframe on the region's first frame**; asserts frame/packet counts + leading keyframe.
- **assemble** — one `EncodedVideoPacketSource` anchored to the ORIGINAL decoder config; walk regions adding `keep` packets bit-exact + re-encoded packets in decode order; audio passthrough unchanged (AAC priming rebase reused); `validateSpliceOutput` (kept+reencoded==output==expected, ≤1-frame drift) → throw-or-adopt.
- **honest fallbacks** — probe fail / no codec string / not splice-friendly / plan=full / plan invalid all return null; mid-run error throws; never adopts a broken result. Chronos `partial-splice-{scan,reencode,assemble}` from real counters. `CompositeSpliceTiming` for the harness.

**KNOWN HAZARD (documented in-file):** an MP4 video track has ONE sample description (avcC). Kept AVC packets use the original config; re-encoded GOPs use a fresh encoder (same codec string, but not proven byte-compatible here). Structural output is validated; **pixel correctness across the splice boundary is only guaranteed by the decode-back fidelity check (sprint 4) + user QA.** VP9 keyframes are self-contained and splice cleanly; AVC needs that proof. ⇒ **ships flag-off; not wired into `coordinateRebake` yet.**

Leaf module (unused until sprint 3). **Verify:** `test-splice-plan` **29/29** (incl. `scanKeyframes` gate) · `tsc` clean (4 pre-existing) · `npm run build` PASS.

### Sprint 3 — splice fidelity gate (2026-07-08) — **DONE (automated); the load-bearing avcC check**

Reordered ahead of wiring (user call) so nothing can invoke the splice without the safety net.

- **Pure** `selectSpliceFidelityAnchors` (splice-plan.ts) — frame-aligned probe timestamps: kept-region samples (pixel-equality probes) + every splice-boundary straddle + clip start/end. Node-tested.
- **Browser** `verifySpliceKeptFrames` (composite-fidelity.ts) — decodes the spliced output at all anchors + the original at kept anchors; **kept-region frames must decode pixel-identical** (mean Δ ≤ 1.5, peak ≤ 24 / 255) between spliced & original — since those packets were copied byte-exact, any difference proves the spliced track's sample description corrupted them (the avcC hazard, caught directly); boundary frames must at least decode. Returns ok/reason (never throws for a miss).
- **Wired** as a mandatory final step in `renderCompositeSplice`: fidelity miss → throw → caller runs the full composite. Log line reports kept/boundary checks + worst mean Δ.

**Verify:** `test-splice-plan` **33/33** (+4 anchor-selection) · regression: partial-rebake-plan 9, browser-composite-plan 17, segment-dirty-tracker 11, timeline 10, take-manager 31 · `tsc` clean (4 pre-existing) · `npm run build` PASS.

### Sprint 4 — wire coordinateRebake + flag + bake-path integration (2026-07-08) — **DONE (automated); flag-off**

- **`coordinateRebake`** now conditional: injected `executePartialSplice` (keeps the module pure); reports `executed:'partial'` ONLY when the splice returns bytes; null / non-abort throw / fidelity reject → full fallback (`'full'`); **AbortError propagates** (no silent full re-render). `test-partial-rebake-plan` **13/13** (+partial-success / null-fallback / throw-fallback / abort-passthrough).
- **Flag** `experimental.partialRebakeSplice` + `resolvePartialRebakeSpliceEnabled` (opt-IN; **default off** — absent from prefs defaults). 
- **Bake-path integration** (`subtitle-bake.ts`): `computePartialRebakePlan` (was telemetry-only) now returns the plan; `bakeWithOptionalSplice` runs the splice when flag-on + plan `'partial'` + a previous baked MP4 exists, else the full composite (`runFullComposite` wraps the I1 fallback chain). Splice chronos (`partial-splice-*`) mapped to user copy in `canvasStageMessage`.
- **Executor correctness fix found during integration:** the splice must re-composite dirty regions from the **CLEAN base** MP4 (the baked frames still carry the OLD burned-in subtitle there); Sprint 2 wrongly decoded from the baked MP4. `renderCompositeSplice` now takes both `bakedMp4` (kept packets) + `baseMp4` (dirty-region source), stamping re-encoded frames with the baked PTS for a seamless splice. Also fixed the pre-existing `subtitle-bake` `base`-null tsc error in passing (now **3** pre-existing, was 4).

**Verify:** `test-splice-plan` 33/33 · `test-partial-rebake-plan` **13/13** · regression (browser-composite-plan 17, dirty-tracker 11, timeline 10, take-manager 31, take-deck 12) · `tsc` clean (3 pre-existing) · `npm run build` PASS (composite-splice now bundled/reachable).

### Sprint 5 — docs + QA checklist (2026-07-08) — **DONE**; code+docs COMPLETE, real-browser QA is the release gate

- **ADR-0005** (`docs/architecture/adr/0005-partial-rebake-splice.md`, Accepted — execution behind flag, default off): keyframe-aligned smart-render, clean-base re-composite, the avcC hazard + self-verifying kept-region pixel-equality gate, honesty via `coordinateRebake`.
- **Design doc** `docs/v5.6.0-audio-decoupling.md` → v2.4: §4.2 Phase 2b as-built + **§13 real-browser QA checklist** (A happy path · B honesty/fidelity-gate incl. forced-rejection · C AVC+VP9 · D honest fallbacks · E downstream attach/download/H6).
- **Architecture README** ADR index synced (0004 + 0005 added; "0006 is next").

**Phase 2b is code + docs complete.** The only remaining item is the **real-browser QA gate** (§13 checklist, flag on) before any default-on decision — no more automated work. Everything ships **dark** (`experimental.partialRebakeSplice` default OFF); production behavior is unchanged.

**Final Phase 2b verification (automated):** `test-splice-plan` 33 · `test-partial-rebake-plan` 13 · regression (browser-composite-plan 17, dirty-tracker 11, timeline 10, take-manager 31, take-deck 12) · `tsc` clean (3 pre-existing) · `npm run build` PASS.

```bash
node scripts/test-splice-plan.mjs && node scripts/test-partial-rebake-plan.mjs
# Real-browser QA: set experimental.partialRebakeSplice:true → docs/v5.6.0-audio-decoupling.md §13
```

### Real-browser QA — Phase 2b (2026-07-08) — **IN PROGRESS · AVC single-machine gate nearly met**

Working checklist (living): [`.ignore/QA-5.7.0/checklist.md`](.ignore/QA-5.7.0/checklist.md) · logs in same folder.

| Section | Result | Notes |
|---------|--------|-------|
| **A** Happy path | **PASS** | A1–A6. `a2-partial-splice.log`: splice applied, fidelity 4/4 ok, worst mean Δ0.00, **avc** |
| **B1** Honesty | **PASS** | `executed`/console only claim partial when a real splice ran |
| **B2** Fidelity reject → full | **PASS** (natural) | `error-1.log`: gate rejected kept frame (mean 1.45, peak 135) → full fallback correct. `b2-fidelty-gate.log` is **not** B2 — it is the scan/`not splice-friendly` gate (still honest full fallback) |
| **B3** Abort mid-splice | **N/A GUI** / unit PASS | No Cancel affordance while baking; `bakeAbort` only on panel dispose. `test-partial-rebake-plan` AbortError passthrough covers honesty |
| **C1** AVC | **PASS** | All composites log `avc`; A2 splice + intermittent avcC reject both correct |
| **C2** VP9 | **OPEN** | Force via temporary `BROWSER_COMPOSITE_VIDEO_CODEC_CANDIDATES = ['vp9','avc']` — steps in checklist |
| **D1–D5** Fallbacks | **PASS** | First bake full; style → allDirty full; coverage 0.8 full (`bake-log-1`); re-record full; flag-off inert |
| **E1–E3** Downstream | **PASS** | Download + Reddit attach OK. Studio reopen resets **plan session** (`lastBakeInputs`) by design; artifact bytes retained |

**Intended behaviors clarified (not bugs):**
- Two-cue edit on ~10 s → `coverageRatio: 0.8` → plan `full` (D3 threshold + keyframe expansion + old/new cue multiset windows).
- Reopen Studio → first re-bake is full (session-local previous-bake cue snapshot); spliced bytes still on the take.
- Intermittent AVC fidelity miss → full composite (avcC hazard self-verifying); product stays correct, just loses the speedup on that attempt.

**Remaining for ideal sign-off:** C2 VP9 once. Single-machine sign-off allows C1 alone. Default-on remains a **separate** decision after formal sign-off.

### Real-browser QA follow-up — B3 + C2 VP9 (2026-07-08) — **CLOSED**

- **B3 PASS:** close Studio mid-splice → abort; prior baked MP4 intact.
- **C2-A1 PASS** (`c2-a1.log`): full composite `vp9`.
- **C2-A2 pre-fix FAIL:** scan gate alt-ref non-monotonic PTS → full (`c2-a2-attempt-1/2`). Fix: VP9 `latencyMode:realtime` + scan diagnostics.
- **C2-A2 post-fix PASS** (`c2-a2-attempt-3.log`): re-encoded 44/680, fidelity 8 kept/6 boundary ok [worst mean Δ0.00], **vp9**, `Partial re-bake splice applied`. User: remaining C2-An visual/play PASS.
- **Sign-off:** A+B+C1+C2+D+E single machine. **Default-on** accepted (residual: second-machine encoder variance → more full fallbacks only).
- **Shipped `v5.7.0`.**

```bash
git checkout main && npm install && npm run dev
node scripts/test-splice-plan.mjs && node scripts/test-partial-rebake-plan.mjs
```

---

## v5.6.0 — Audio Decoupling + Editing-Suite Backend — **TAGGED** `v5.6.0`

**Branch:** merged `feature/5.6.0-audio-decoupling` → `main` (2026-07-08) · **Package:** `5.6.0` · **Push:** deferred
**Contract doc (authoritative, §12 as-built):** `docs/v5.6.0-audio-decoupling.md` · **Decision:** `docs/architecture/adr/0004-audio-decoupling-voice-reapply.md` · **Seam:** extension-points v1.5
**Commits:** `9147a19` (Phase 1: decoupling + re-apply) · `3474828` (Phase 2/3: editing/timeline backend) · `ca10ad4` (docs)

### What shipped (2026-07-07)

- **Ground-truth correction:** clean audio already existed — the raw-mic `baseRecording` WebM (voice is applied at offscreen *transcode*, not capture). Phase 1 therefore costs zero storage.
- **Voice provenance:** `TakeVoiceStamp` (`intentKey` + normalized config + `origin` capture/reapply + `revision`) + non-destructive `edits.trim` on the take snapshot; capture stamps ride the `ready` promotion.
- **Re-apply pipeline (`src/audio/*`):** H6-gated clean-audio door → Dulcet II re-render (AAC M4A; `forceRender` for voice-off) → **pure stream-copy remux** of `baseMp4` AND `bakedMp4` (mediabunny packet sources; visuals bit-exact — voice changes never re-composite) → atomic re-stamp. Studio page only; NO new message family. Studio surface: "Apply voice to current take" in the voice panel.
- **Editing/timeline backend:** `src/timeline/timeline.ts` (global-PTS frame math, `TrimRange`), `src/editing/segment-dirty-tracker.ts` (cue diff → dirty windows → segments), `partial-rebake-coordinator.ts` (keyframe-grid splice **planner**; execution = Phase 2b; bake path emits plan telemetry per bake), `trim.ts` (`planTrim` + intent + mediabunny `Conversion` apply; artifact integration deferred).
- **Chronos:** `voice-reapply-{dsp,remux-base,remux-baked,save}`, real counters only; `partial-rebake-plan` is telemetry-only.

### Verification (automated, 2026-07-07)

`test-take-manager` **31/31** · `test-voice-reapply-plan` **12/12** · `test-timeline` **10/10** · `test-segment-dirty-tracker` **11/11** · `test-partial-rebake-plan` **9/9** · full regression sweep PASS (take-deck 12, composite-plan 17, clip-source 4, webm-preflight 4, encoded-segment 5, chunk-planner 13, bake-chronos 7) · `tsc` clean (4 documented pre-existing) · `npm run build` PASS.

### User QA — Phase 1 (voice re-apply) — **PASS** (2026-07-08)

| Scenario | Result | Notes |
|----------|--------|-------|
| Capture voice A → Apply voice B | **PASS** | Audio changes; visuals bit-identical in every case |
| Reddit attach after re-apply | **PASS** | Both original and reapplied voices attach correctly |
| Voice-off (zero effects) re-apply | **PASS** | Clean extract works |
| All intended Phase 1 flows | **PASS** | User: "operating exactly as expected in all cases" |

**Not in scope for v5.6.0 tag (follow-up branches):** Phase 2b partial-splice *execution*; Phase 3 trim UI + artifact/cue integration. See § "Phase 2b / Phase 3 — what QA means" below.

### Phase 2b / Phase 3 — what QA means (not blocking v5.6.0)

**Phase 2b (partial re-bake splice execution):** NOT shipped. Every bake still runs a **full** composite; `coordinateRebake` always reports `executed: 'full'`. What *is* shipped: a pure planner + console telemetry (`partial-rebake-plan`) on re-bakes within the same Studio session (edit cues → bake again → DevTools console shows strategy/spans/coverage). **No user-facing feature to QA for release.** Optional dev check: confirm console log after a cue-edit re-bake. Real Phase 2b QA (when built): A/B partial vs full composite on identical edits, fidelity harness, chronos must not claim `partial` while doing full work.

**Phase 3 (trim apply integration):** NOT shipped as a product feature. Backend only: `planTrim`, `storeTrimIntent`, `applyTrimToMp4`, `take.edits.trim` field — **no Studio UI**, no artifact overwrite, no subtitle cue shift. **Nothing expected of you in dev or production.** Future QA gate: set trim → apply → duration shrinks, cues shift, attach/download reflect trimmed bytes.

**Tagged `v5.6.0` (2026-07-08).** Release notes: `docs/release-notes-v5.6.0.md`. Next: Phase 2b on `feature/5.7.0-partial-rebake-splice`.

```bash
git checkout feature/5.6.0-audio-decoupling && npm install && npm run dev
node scripts/test-voice-reapply-plan.mjs && node scripts/test-timeline.mjs
```

---

## v5.3.10 — WebCodecs Per-Chunk Encoding — **MERGED & TAGGED** (`v5.3.10`)

**Branch:** merged `feature/v5.3.10-webcodecs-encoding` → `main` (2026-07-05) · **Package:** `5.3.10`  
**Design:** `docs/5.3.10-webcodecs-per-chunk-encoding.md` §0 · **Release notes:** `docs/release-notes-v5.3.10.md`  
**ADR:** `docs/architecture/adr/0001-webcodecs-encoding-backbone.md` · **Push:** deferred (local only)

### What shipped

Dual VP8 `VideoEncoder` per chunk (color + alpha-as-gray IVF) → pure-TS stitch (~4 ms) → `alphamerge` composite. **Normalize eliminated** on WebCodecs path — streams composite-ready by construction (integer global PTS, frame-exact segments, explicit alpha). Encoding layer: `src/encoding/*`; orchestrator: `subtitle-overlay-webcodecs.ts`; paint seam: `createOverlayFramePainter`; flag `experimental.webCodecsBake` (default false). Fallback: webcodecs → mediarecorder-parallel → serial → drawtext.

### User QA (2026-07-05) — **PASS** (`.ignore/sub-QA-5.3.10/`)

| Scenario | WebCodecs (on) | Legacy (off) | Speedup |
|----------|----------------|--------------|---------|
| Render 20 cues / 60 s | 7.4 s (0.12× RT) | 63.9 s | 8.6× |
| Render 232 cues / 60 s | 6.7 s (0.11× RT) | 69.0 s | 10.4× |
| **Full bake 20 cues** | **46.2 s** (0.77× RT) | 228.2 s | 4.9× |
| **Full bake 232 cues** | **49.9 s** (0.83× RT) | 310.4 s | 6.2× |

- `normalizeMs`: **null** on all WebCodecs bakes; legacy pays 146–207 s normalize.
- Visual: **PASS** — indistinguishable from legacy, dense overlapping cues OK.
- Calibration: `vp8 (alpha luma white=234, black=17, limited range)` — top alphamerge tier used.
- Sub-real-time bake goal: **PASS** (~46–50 s for 60 s rich-effects; user accepted as full pass on ≤30 s ballpark).

### Handoff to v5.4.0

Encoding backbone ready: painter, segment metas, IVF concat, per-segment telemetry, worker-portable loop. See design doc §0.8 + `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`. Optional follow-up: enable `experimental.webCodecsBake` in production prefs; composite-stage optimization (~43 s, 88% of WebCodecs bake wall).

```bash
git checkout v5.3.10 && npm install && npm run dev
node scripts/test-ivf.mjs && node scripts/test-overlay-alphamerge-args.mjs
```

---

## v5.4.0 — Design Studio First — **TAGGED** `v5.4.0`

**Roadmap:** `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md` (Phase 0 as-built section is authoritative)  
**Branch:** merged `feature/v5.4.0-standalone-design-studio` → `main` (2026-07-06) · **Package:** `5.4.0`  
**Release notes:** `docs/release-notes-v5.4.0.md` · **Tag:** `v5.4.0` · **Push:** deferred (user will push)  
Studio is the standalone authoring environment; consumes v5.3.10 bake backend as composable layer. Baseline: `main` @ `v5.3.10` pre-merge.

### Handoff summary (2026-07-06)

**Shipped (Phases 0–4 + QA hardening):** TakeManager (`rvn.take.current` + artifact stamps), Current Take deck, Studio-native recording (live WYSIWYG canvas), Reddit attach mode, Studio-first copy, production WebCodecs bake defaults (`bd7d60a`), mid-processing tab-close recovery (`studio-take-recovery.ts`), Reddit panel live-sync during Studio capture.

**User QA:** checklist items **1–11** passed per user sign-off (2026-07-06); item **#4** and **#11** required post-Phase-4 hardening (commits `03e33c0`–`0d70478`).

**Restore:** `git checkout main && npm install && npm run dev`

**Verify:** `node scripts/test-take-manager.mjs` (14) · `node scripts/test-take-deck.mjs` (12) · `npm run build` PASS

**Explicitly deferred (not blocking tag):**
- Demo site (`demo/src/studio/`) standalone capture parity — no pipeline there.
- Composite-stage perf (~43 s alphamerge wall on WebCodecs bakes) — optional follow-up.
- `git push origin main` — per repo convention, when ready.

### Phase 0 — TakeManager foundation **COMPLETE** (2026-07-05)

Single source of truth for the current take across all contexts:

- `src/session/take-manager.ts` — snapshot in `browser.storage.local` (`rvn.take.current`), blobs stay in existing IDB stores, `TakeArtifactStamp` freshness stamps, `storage.onChanged` subscription, stale-transient demotion on read (`normalizeStaleTake`, 2 min), same-context write serialization. **No MSG_TAKE_* family** — storage IS the sync channel (placeholders removed from `messaging/types.ts`).
- `voice-recorder.ts` — owns capture transitions: `beginTake` (stashes prior snapshot) → `processing` → `ready`; discard/error-while-recording restores prior (blobs only written at stop); cancel/error during processing → `draft`. `sessionEpoch` guards sub-second races. `persistTakeOnClose()` = auto-draft hook.
- `recorder-panel.ts` — auto-draft on `close()` + `pagehide`.
- `background.ts` — stamps `baseRecording`/`baseMp4` artifacts after relayed IDB writes; adopts orphan artifacts into a draft.
- `subtitle-bake.ts` — `updateFromBake` → status `baked` (adopts untracked pre-v5.4.0 sessions).
- `mount-clip-studio.ts` — reactive subscription; status strip shows a compact Take row (`buildTakeStatusLine`).
- Tests: `node scripts/test-take-manager.mjs` (12 checks). Suite 21/21 PASS, `tsc` HEAD parity, build PASS.

### Phase 1 — Current Take deck **COMPLETE** (2026-07-05)

- `src/ui/design-studio/current-take-status.ts` — hero "Current Take" deck: 9-slice panel frame, status icons, mono duration/badge chips (DRAFT / BAKED / SUBS PENDING), state headline + hint, **Download MP4 primary CTA** (amber bake-btn language; baked preferred over base, resolved from extension-origin IDB at click time), Record/Re-record secondary (Phase 1: routes to Reddit via `activateRedditTab` + workflow 'capture'; Phase 2 swaps to native), Discard tertiary (snapshot only — single-slot blobs overwrite on next take).
- Hero layout (revised 2026-07-05): Current Take deck nested in profile/status panel (below profile selector, above status strip); hero = profile column then live preview (narrow stack); wide = preview left, profile column right. CSS: `studio-v4-layout.css` § Current Take deck; live states breathe via `prefers-reduced-motion`-guarded blink.
- Status strip take row removed — deck is the single authoritative take display (`buildTakeStatusLine` deleted).
- Tests: `node scripts/test-take-deck.mjs` (11 checks — state → CTA/badge matrix).

### Phase 2 — Studio-native recording + live preview **COMPLETE** (2026-07-05)

- `src/recorder/recorder-host.ts` — **headless** `mountRecorder` host (contract revised from the scaffold): owns session lifecycle + auto-draft; hands over the **WaveformRenderer canvas itself** via `onLiveCanvas` (the exact element `captureStream()` feeds MediaRecorder — zero-copy WYSIWYG, no per-frame callbacks). Each surface renders its own transport chrome.
- `src/ui/design-studio/studio-recorder.ts` — deck-embedded transport (Record ● / Stop ■ / Discard), chronos mono timer + cap track (amber → warning → critical), FFmpeg processing bar; reuses the amber bake-btn family (`--ready` armed, `--baking` pulse while recording). Concurrent-session guard (fresh transient reddit-sourced take → confirm). Workflow phases: 'capture' on record, 'polish' on stop. `pagehide` auto-draft.
- `mount-clip-studio.ts` — live canvas swaps into the hero monitor (`.studio__preview-canvas--live`, static canvas hidden, label → "LIVE MIC", bezel + label glow, faster breath), theme RAF loop paused while live (`auditionActive` guard in `syncPreviewLoop`). Deck morphs into the transport via `.studio-v4__take-deck--audition`.
- `VoiceRecorderSession` runs unmodified on the extension page — relays (`MSG_SAVE_LAST_RECORDING`/base-MP4), transcribe fork, and transcode client are all `runtime.sendMessage`-based, so the entire downstream (voice preview, subtitles, bake) lights up identically to a Reddit capture. Studio edits during audition hot-swap the live canvas via the existing prefs listener — **you can restyle the clip while recording it**.
- Reddit panel path untouched (Phase 0 wiring only); UI unification lands with Phase 3/4 polish.

### Phase 3 — Reddit as output target **COMPLETE** (2026-07-05)

- **Attach mode:** `RecorderPanel.open()` checks the TakeManager first — a completed take (non-transient + MP4 artifact) with a live composer opens the panel as an output target: "Current Studio Take" card (amber signage + mono chronos chip, mirroring the deck), **Attach Studio take** primary, **Record new here** secondary, "Edit in Design Studio" CTA. No mic acquisition until the user chooses to record.
- **Relay generalized:** `MSG_GET_BAKED_MP4_META/_CHUNK` accept `store: 'baked' | 'base'` (default 'baked' — backward compatible); background keeps a per-store byte cache. Never-baked takes attach their base MP4.
- Attach flow: fetch (chunked) → `attachMp4ToComposer` → workflow 'design' on success. "Record new here" runs the classic capture path — TakeManager's prior-snapshot stash means a discarded re-record restores the attachable take intact.
- Voice-note button copy: "attach your Studio take or record here". All shadow-DOM/observer/composer-detection logic untouched.

### Phase 4 — Polish + release prep **COMPLETE** (2026-07-05, QA 2026-07-06)

- Studio-first copy sweep: workflow banner (record-in-Studio primary, "Record on Reddit instead" secondary, "How does Reddit fit in?" explainer), status strip (deck-first hints/blockers), panel 3-phase intro, bake done-message.
- Progressive disclosure: main screen = workflow banner + hero (take deck / profile / preview) + collapsed v4 section cards — unchanged subpanel pattern, no new top-level controls.
- Version **5.4.0** (`package.json` + `version.ts`); release notes `docs/release-notes-v5.4.0.md` incl. **manual QA checklist** (studio recording, recovery, attach mode, regression sweep).
- Verification: take-manager **14/14**, take-deck **12/12**, `npm run build` PASS at merge.
- Demo (`demo/src/studio/`) parity for the standalone flow = future work (no capture pipeline there); noted in release notes.

### v5.4.0 QA — mid-processing tab-close recovery **PASS** (2026-07-06)

User QA checklist item **#4** (close Studio mid-processing → reopen → draft/ready, no lost session): **PASS**.

**Root causes fixed (commits `03e33c0`, `ea03d8a`):**
- Studio `pagehide` called `host.close()` → `dispose()` → aborted offscreen transcode; phantom `processing` snapshot + orphaned audition UI (grayed Record).
- `main.ts` `pagehide` `unmount()` re-ran `closeAudition()` and cancelled transcode again.
- Draft with preserved WebM had no MP4 → Reddit attach mode unavailable until manual recovery.

**As-built recovery path:**
- `src/ui/design-studio/studio-take-recovery.ts` — reconcile phantom `processing`, auto-resume WebM→MP4 from IDB, serialized via recovery chain.
- `entrypoints/background.ts` — `persistOrphanStudioTranscodeResult`, `MSG_QUERY_TRANSCODE_INFLIGHT`.
- `src/session/take-manager.ts` — `reconcileInterruptedProcessing()`.
- `studio-recorder.ts` — `detachAuditionOnPageHide()`; `dispose()` skips teardown during `processing`.
- `recorder-panel.ts` — `resumeDraftTranscodeIfNeeded()` before attach resolution.

### v5.4.0 QA follow-up — Reddit panel live sync during Studio capture (2026-07-06)

**Bug:** Open Reddit composer panel while Studio is recording → legacy mic UI; stays there after Studio take completes until composer close/reopen.

**Fix:** `RecorderPanel.open()` opens attach-waiting chrome when a Studio-sourced transient take exists; `maybePromoteNewerTake()` promotes from mic-ready (not only `stopped`) when TakeManager advances via `storage.onChanged` subscription. **PASS** (user 2026-07-06) · commit `0d70478`.

### v5.4.0 hardening — production WebCodecs bake (2026-07-06)

- **Issue:** Amber "Bake subtitles" button and production builds used legacy MediaRecorder path; Lab toggles worked but prefs default `webCodecsBake: false`.
- **Fix:** `resolveOverlayBakeEncoder` / `resolveParallelBakeEnabled` in `user-preferences.ts`; one-time rollout migration; `subtitle-bake.ts` wired. Commit `bd7d60a`.

### v5.4.0 QA follow-up — hero preview aspect + layout (2026-07-05)

- **Bug:** landscape hero monitor stretched vertically (~4:3 draw window); bezel SVG misaligned.
- **Fix:** preview no longer `grid-row: span 2` (was inheriting right-column height); artboard + `preview-window-frame.svg` aligned to canvas **640×360 (16:9)**; `align-self: start` on preview.
- **Layout (revised):** Current Take deck lives inside the profile/status panel — below profile selector, above status strip (not under live preview). Wide grid: preview left, profile column right. Hero preview centered in its column (`margin-inline: auto`; wide: `justify-self`/`align-self: center`, up to 720px).
- **Files:** `studio-v4-layout.css`, `mount-clip-studio.ts`, `public/assets/design-studio-v4/panels/preview-window-frame.svg`
- **Verify:** `npm run build` PASS


---

## v5.5.1 — Browser composite default-on — **TAGGED** `v5.5.1`

**Package:** `5.5.1` · **Release notes:** `docs/release-notes-v5.5.1.md` · **Push:** deferred
**Change:** `experimental.browserComposite` default **true** + `rvnBrowserCompositeRolloutMigrated` one-time migration. Overlay Lab is dev-only — v5.5.0 opt-in was unreachable in production; R11 two-machine QA justified default flip.

## v5.5.0 — Browser-side Full Composite — **TAGGED** `v5.5.0`

**Branch:** merged `feature/v5.5.0-browser-composite` → `main` (2026-07-07)
**Release notes:** `docs/release-notes-v5.5.0.md`
**Commits:** scaffold `c1a79fe` → hybrid `b00f381` → QA fixes `5e906be` `6dba1c3` `a133320` → gate `8e04c46` → release prep
**Decision:** `docs/architecture/adr/0003-composite-stage-elimination.md` (accepted) · **Execution plan + as-built:** `docs/v5.5.0-browser-composite-migration.md` (§0 authoritative)
**Goal:** eliminate the ~43 s FFmpeg alphamerge+x264 wall (88% of WebCodecs bake) — decode base MP4 in-page, blend `createOverlayFramePainter` at each frame's exact output PTS, encode + mux via `mediabunny@1.50.6` (pinned exact).

### What landed

- `src/composite/composite-plan.ts` — pure core: honest progress model (frame+packet counters, zero creep timers), output validation (frame-exact + ≤1-frame duration drift), R13 size guard, fidelity anchor timestamps. Node-tested.
- `src/composite/browser-composite-support.ts` — probe on the REAL base track: `canDecode()` + first-frame decode round trip + encodable output codec (`avc` → `vp9`), null ⇒ legacy path (R11).
- `src/composite/browser-composite.ts` — orchestrator: `VideoSampleSink` decode → single source-over `drawImage` blend (NO alphamerge/premul machinery on this path; R1/R2 scoped to fallbacks) → `CanvasSource` encode (awaited add = backpressure) → interleaved audio packet passthrough → `Mp4OutputFormat fastStart:'in-memory'`. Validated output or throw; caller owns fallback.
- `src/composite/composite-fidelity.ts` — R9 frame extraction at anchor timestamps (Lab A/B surface = follow-up).
- Wiring: `composite: 'browser' | 'ffmpeg'` on `bakeWithCanvasOverlay` (explicit at both call sites), fall-through chain browser → webcodecs+alphamerge → mediarecorder → drawtext; `experimental.browserComposite` (default **false**) + `resolveOverlayCompositeStrategy`; `canvasStageMessage` copy for the four `browser-composite-*` stages; Lab toggle "Browser composite (v5.5.0)" (OFF = R12 force-legacy sweep); timing schema **v4** (`browserCompositeMs`, never folded into `compositeMs`).

### Verification (automated, 2026-07-07)

`node scripts/test-browser-composite-plan.mjs` **17/17** · `test-take-manager.mjs` **24/24** · `test-segment-editor-clip-source.mjs` **4/4** · `test-webm-preflight.mjs` **4/4** · `npm run build` PASS · `tsc` 4 pre-existing only.

### QA hardening (2026-07-07)

| Issue | Commit | Fix |
|-------|--------|-----|
| Browser composite AAC priming PTS (`-0.0114375s` mux reject) | `5e906be` | Audio passthrough timestamp rebasing in `browser-composite.ts` / `composite-plan.ts` |
| Cue editor false OOB + stale 2s audio preview | `6dba1c3` | TakeManager clip duration + H6 stamp-verified `baseMp4`/`baseRecording` in `segment-editor-clip-source.ts` |
| Background cap-stop: metadata timeout, Processing deck hang, animation freeze | `a133320` | `WaveformRenderer` hidden-tab `setInterval` pump + `flushFrameForCapture()`; structural WebM preflight; `recordArtifact('baseMp4')` promotes `processing`→`ready`; Studio `visibilitychange` reconcile |

### User QA (2026-07-07) — **PASS** (two machines; `.ignore/QA-5.5.0/`)

| Scenario | Result | Notes |
|----------|--------|-------|
| Lab bake, browser composite ON (~119 s / 40 cues) | **PASS** (after `5e906be`) | Fast bake; honest chronos; no AAC mux fallback |
| Browser composite faster when tab focused | **observed** | Expected Chrome throttling; future UX idea: stay-on-page mini-game (not built) |
| Cue editor OOB badges + per-cue preview | **PASS** (after `6dba1c3`) | Bake timing unaffected throughout |
| Cap-stop recording, tab **unfocused** | **PASS** (after `a133320`) | Animation/movement captured; deck reaches ready; user: "perfect fix" |
| R9 side-by-side vs toggle-OFF legacy bake | **PASS** | User: visuals identical; production-grade parity |
| Toggle-OFF legacy sweep (R12) | **PASS** | Legacy paths still work; long-clip timeouts triggered expected fallbacks |
| Post-bake e2e: bake → attach → re-bake | **PASS** | Bake creates MP4; Reddit panel attach; re-bake updates attached video |
| R13 output size at 2:00 cap | **PASS** | Browser composite ~22 MB; legacy same take ~15 MB (30 MB cap comfortable) |
| R11 capability matrix (machine 1) | **PASS** | No throughput cliffs; fallbacks honest on long clips |
| R11 capability matrix (machine 2) | **PASS** | Browser composite + all other strategies work |

### Deferred (not blocking tag)

- **Phase 2 default flip:** `experimental.browserComposite: true` — explicit product decision; R11 matrix now PASS on two machines.
- **Fidelity Lab A/B surface** consuming `composite-fidelity.ts`.

```bash
git checkout main && npm install && npm run dev
node scripts/test-browser-composite-plan.mjs
node scripts/test-webm-preflight.mjs
node scripts/test-segment-editor-clip-source.mjs
```

---

## Where the rest of the history went

Session history from **v5.3.9 and earlier** (down through the v1.0.0 MVP) lives in [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md). See [`docs/HISTORY.md`](docs/HISTORY.md) for the milestone-by-milestone index plus archived release notes and design docs.
