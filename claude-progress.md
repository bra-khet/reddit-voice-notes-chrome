# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file — focused on the **current milestone (v5.4.0, Design Studio First)** and its immediate `v5.3.10` handoff. Everything before that is preserved verbatim in the archive:

- Full pre-v5.4.0 log: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)
- Superseded branch logs: [`archive/progress/`](archive/progress/) — `dulcet-branch.md`, `eloquent-branch.md`, `pretty-branch.md`

The full prior content is intact in the archive so this file stays small and actionable. Add new session entries above the older milestone sections; run `/docs-archiving` (Refresh) after the next milestone.

## v5.7.0 — Partial Re-bake Splice (Phase 2b) — **IN PROGRESS**

**Branch:** `feature/5.7.0-partial-rebake-splice` (from `main` @ `v5.6.0`)
**Scope:** `coordinateRebake` packet splice execution + fidelity-harness extension. Planner/telemetry landed in v5.6.0.
**Contract:** `docs/v5.6.0-audio-decoupling.md` §4.2 (+ §12 follow-ups). Invariants I1–I9 + chronos honesty + H6 hold throughout.

### Sprint 1 — pure splice-plan layer (2026-07-08) — **DONE (automated)**

The construction-level guarantee layer that must exist *before* any browser encode can claim a partial success (v5.3.9.1 lesson). New pure module `src/editing/splice-plan.ts`:

- **Keyframe alignment:** `alignFrameToKeyframeStart/End` expand the planner's *assumed-2s-grid* spans onto the artifact's **real** keyframe (GOP) boundaries — the crux: an encoder's actual keyframes need not sit on the 2s grid, and a splice may only replace whole GOPs.
- **Region model:** `planSplice()` → contiguous alternating `keep`/`reencode` regions covering `[0, frameCount)` exactly once; adjacent aligned GOP islands merge; honest `full` fallback when aligned coverage > `PARTIAL_REBAKE_MAX_COVERAGE` (0.6) or the keyframe layout is unreadable / doesn't start at frame 0.
- **Two gates:** `validateSplicePlan` (contiguity, alternation, every cut on a real keyframe, reencode ends on keyframe/EOS) and `validateSpliceOutput` ("partial never lies" — `kept + reencoded === output === expected` packet count, ≤1-frame duration drift).
- **Chronos:** distinct stages `partial-splice-{scan,reencode,assemble}` (never reuse `partial-rebake-plan` or `browser-composite-*`); banded progress from real counters (`computeSpliceReencodeRatio`/`computeSpliceAssembleRatio`).
- Frame-native, leaf module, zero behavior change: `coordinateRebake` still executes full and reports `executed: 'full'`.

**Verify:** `node scripts/test-splice-plan.mjs` **23/23** (incl. off-grid keyframe alignment + planner→splice integration) · regression: partial-rebake-plan 9, segment-dirty-tracker 11, timeline 10, browser-composite-plan 17 · `tsc` clean (4 documented pre-existing only) · `npm run build` PASS.

### Remaining Phase 2b sprints

2. **Browser executor** `src/composite/composite-splice.ts` — read existing baked-MP4 packets (keyframe frames via `EncodedPacket.type`), decode/repaint(new cues)/re-encode only `reencode` regions (force keyframe at each region start), copy `keep` packets bit-exact, interleave into one `EncodedVideoPacketSource` in decode order, audio passthrough, `validateSpliceOutput` → throw-or-adopt.
3. **Wire `coordinateRebake`** conditional partial/full with honest `executed: 'partial'`; splice chronos into the bake path.
4. **Fidelity harness** extension: spliced vs full A/B on dirty regions + bit-exact assertion on kept regions (extend `composite-fidelity.ts`).
5. Docs (design doc §4.2 as-built, ADR note), then user QA gate (A/B parity, chronos honesty).

```bash
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
