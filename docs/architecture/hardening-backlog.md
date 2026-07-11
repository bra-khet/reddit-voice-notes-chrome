# Hardening Backlog — Reddit Voice Notes

**Version:** v2.4 · **Updated:** 2026-07-11 · **Reflects:** `main` @ `v5.8.0`
**Status:** Ranked hardening items for the v5.4.x standalone-suite direction. Each item cites
evidence, ROI, blast radius, and explicit non-goals. Scored: `(impact × bug_likelihood) ÷ cost`.
**Changelog:** v2.4 (2026-07-11) — refreshed to `main` @ v5.8.0. **H9 SHIPPED** — browser-side full composite is default-on since v5.5.1 (two-machine QA PASS; the ~43 s x264 wall is gone on the primary path). v5.7.0 partial-splice execution introduced the avcC hazard, mitigated **by construction** via the kept-region fidelity gate (I16) → new risk R14 (self-verifying, not an open item). v5.8.0 timeline editor introduced the List/Timeline two-view-over-one-draft coupling → new risk R15 (handled by `captureActiveDraft`; the review checklist for new cue-draft views). **No new OPEN hardening item** from the v5.5→v5.8 arc; H8/H12 remain the carried v5.x patches (H8 may now be subsumable by v5.6.0 `TakeVoiceStamp` — verify before scoping). v2.3 (2026-07-07) — H9 hybrid cut IMPLEMENTED on `feature/v5.5.0-browser-composite` (behind `experimental.browserComposite`, default false; Phase 0 QA gate user-owned before default flip). New R13 (30 MB baked-store cap vs composite bitrate). v2.2 (2026-07-07) — H9 decision recorded: browser-side full composite accepted via ADR-0003 (user directive: performance + extensibility over preview pixel fidelity; v5.3.10 primitives leveraged). Summary table + risk register updated; new R9–R12. v2.1 (2026-07-06) — triage + H6 implemented (user directive): H6 **resolved** (stamp verification shipped + tested), H11 **resolved** (user QA — concurrent recordings work; minor transient display note), H10 **deferred** (user decision), H8/H12 re-filed as v5.4.x patches, H9 stays decision-first (ADR-0003). v2.0 (2026-07-06) — full refresh post-v5.4.0; risk register. v1.0 (2026-06-24) — eloquent-5 era (H1–H5).

Items are updated in place. Add new items here; never fork to `hardening-backlog-v2.md`.

---

## Summary table

| # | Item | ROI | Effort | Status |
|---|------|-----|--------|--------|
| H6 | Artifact-stamp verification at take consumption points | **High** | S | **Resolved (2026-07-06)** |
| H7 | Doc drift: `webCodecsBake` default + storage map | High (cheap) | XS | **Resolved (2026-07-06)** |
| H11 | Concurrent Studio recordings vs single-slot take | Med-Low | — | **Resolved — user QA, no code needed (2026-07-06)** |
| H8 | Recovery re-transcode uses resume-time (not capture-time) voice prefs | Med | S | **v5.4.x patch** |
| H12 | Studio-job progress relay mechanism — verify + document | Med (cheap) | XS | **v5.4.x patch** |
| H10 | Encoder-fallback observability | Med-High | S | **Deferred — user decision** (both paths work; failures hard to reproduce) |
| H9 | Composite-stage elimination (~43 s x264 wall, 88% of WebCodecs bake) | High impact / high cost | L | **SHIPPED** — browser full composite merged v5.5.0, **default-on since v5.5.1** (two-machine QA PASS). ADR-0003 Accepted. Partial-splice (v5.7.0) cuts re-bakes further |
| — | v5.7.0 splice avcC hazard · v5.8.0 timeline two-view | — | — | **Mitigated by design** — fidelity gate I16 (→ R14) + `captureActiveDraft` (→ R15); no open work, see risk register |
| H5 | Binary transport / 3:00 cap restoration (BUG-001 deferred) | Low | XL | Deferred (carried) |
| — | Vosk model re-download (~40 MB/session, BUG-013) | Low | L | Accepted tradeoff (carried) |

---

## H6 — Artifact-stamp verification at take consumption points (RESOLVED 2026-07-06)

**Resolution:** implemented exactly as scoped. `takeArtifactMatchesStore(stamp, storeMeta,
toleranceMs = ARTIFACT_STAMP_TOLERANCE_MS)` pure helper + `clearArtifact(kind, {note})` manager
method in `src/session/take-manager.ts`; verification wired at all three consumption choke points —
`studio-take-recovery.ts` `resumeDraftTranscodeInner` (before adopting the WebM),
`recorder-panel.ts` `attachStudioTake` (stamp vs new meta-only relay query `fetchBakedMp4Meta`
in `baked-mp4-fetch.ts`, before pulling chunks), and `current-take-status.ts` Download CTA
(stamp vs resolved snapshot meta). Mismatch → stamp demoted + honest note
("Recording superseded — re-record"), never silent adoption. Header contract in
`take-manager.ts` updated from "can cross-check" to "MUST cross-check".
**Bonus fix in the touched region:** recovery resume read `recording.durationSeconds`
(nonexistent — TS2339, always undefined) instead of `recording.meta.durationSeconds`,
so resumed base MP4s were saved with duration 0.
**Verified:** `test-take-manager.mjs` 20/20 (6 new H6 checks), `test-take-deck.mjs` 12/12,
`tsc` improved 6 → 4 pre-existing errors, `npm run build` PASS.

<details><summary>Original scoping (for the record)</summary>

- **Item / class it kills:** stale-blob adoption — a take snapshot that survived a crash
  pointing at single-slot IDB blobs that a *different* capture has since overwritten.
  Recovery would then transcode/attach the wrong take's bytes with full confidence.
- **Evidence:** `src/session/take-manager.ts:46-49` documents the contract ("consumers
  comparing the two can detect a snapshot that survived a crash while blobs moved on");
  **no consumer implements it** — `src/ui/recorder-panel.ts:662-663` uses stamps for
  freshness *ordering* only; `studio-take-recovery.ts:44-70` checks blob size ≥ 256 bytes,
  never stamp↔store-meta. Architecture map I15 (Low confidence).
- **Invariant it protects:** state ownership — I9/I15; the take snapshot must never lie
  about which blobs it owns.
- **Surgical change:** one pure helper in `take-manager.ts` —
  `takeArtifactMatchesStore(stamp, storeMeta, toleranceMs)` (compare `savedAt` within relay
  latency; `byteLength` when both present) + call it at the three consumption choke points:
  1. `studio-take-recovery.ts` `resumeDraftTranscodeInner` (before adopting the WebM),
  2. `recorder-panel.ts` attach resolution (before chunked fetch),
  3. `current-take-status.ts` Download MP4 CTA (resolve-at-click already exists; add the check).
  Mismatch → demote artifact stamp (drop it from the snapshot) + honest deck note
  ("Recording superseded — re-record"), never silent adoption. Node tests in
  `scripts/test-take-manager.mjs` (pure helper).
- **Blast radius:** Studio page + content script consumers; no message/protocol change;
  no background change (stamps already carry `savedAt`/`byteLength`).
- **Verification hook:** `node scripts/test-take-manager.mjs` (new checks);
  manual: record take A → kill Studio mid-processing → record take B on Reddit →
  reopen Studio → deck must NOT offer A's draft over B's blobs.
- **Out of scope / Non-goals:** multi-take history store (single-slot model stays —
  that's a product decision, not hardening); content hashing of blobs (savedAt+bytes is
  sufficient for a single-user local store); changing store meta shape.

</details>

## H7 — Doc drift fixes (RESOLVED 2026-07-06)

- **Evidence:** `transcription-architecture.md` §gating said `webCodecsBake` default false —
  code default true since `bd7d60a` (`user-preferences.ts:191`); `design-studio.md` §3.2
  storage map lacked `rvn.take.current`.
- **Resolution (2026-07-06):** both canonical docs updated in place; extension-points
  overlay-backbone gotcha updated; ADR-0001 left untouched (immutable record — its
  "follow-ups: flip default after QA" is now satisfied and noted here).

## H8 — Recovery re-transcode uses resume-time voice prefs (v5.4.x patch)

- **Item / class it kills:** silent semantic drift — a draft recovered after tab close is
  re-transcoded with `prefs.voiceEffect` *as of resume time*
  (`studio-take-recovery.ts:62-68`), not the effect active at capture. If the user changed
  voice settings between capture and recovery, the resumed MP4 sounds different from what
  they recorded, with no indication.
- **Evidence:** `studio-take-recovery.ts:62-68` (`loadUserPreferences()` at resume);
  `CurrentTakeMeta` has no voice provenance field.
- **Invariant it protects:** preview↔bake — what was auditioned at capture is what the
  take produces.
- **Surgical change:** stamp the resolved voice-intent key (the existing id-free
  `voiceEffectUserIntentKey`) into `CurrentTakeMeta` at `beginTake`; on resume, compare
  with current prefs — if different, surface a one-line deck note ("Voice settings changed
  since capture — applied current settings") rather than blocking. ~15 lines.
- **Blast radius:** `voice-recorder.ts` (one meta field), `studio-take-recovery.ts`,
  deck note rendering. Snapshot field is optional → forward/backward compatible.
- **Verification hook:** capture with effect A → close mid-processing → switch to effect B
  → reopen → note appears; `test-take-manager.mjs` parse round-trip with the new field.
- **Out of scope / Non-goals:** re-rendering with capture-time settings automatically
  (would require persisting the full graph snapshot per take — not warranted for a
  single-slot session tool); blocking recovery on mismatch.

## H9 — Composite-stage elimination (Accepted — browser-side full composite via ADR-0003)

**Decision (2026-07-07):** Browser-side full composite chosen (ADR-0001 option 4, full variant — not the hybrid). VideoDecoder on base MP4 + canvas blend via the existing shared `createOverlayFramePainter` (global frame indices) + VideoEncoder + JS mux (Mediabunny). The FFmpeg alphamerge/x264 composite is bypassed for the primary WebCodecs path only.

**Rationale (tied to investment):** Realizes the explicit follow-up in ADR-0001; the v5.3.10 segment/painter/IVF/constructed-stream foundation was built for exactly this. Largest architectural win: composite cost drops from ~43 s single-thread WASM x264 to browser decode/encode throughput. Enables rich future features without FFmpeg as the bottleneck. Per user direction: preview↔bake pixel fidelity is relaxed in favor of performance, rich canvas effects, and extensibility.

**Key constraints preserved:**
- MediaRecorder + drawtext fallback chain end-to-end (alphamerge tiers and burn-in client remain for fallbacks).
- Honest chronos (new distinct stages with frame-derived ratios; no fudging — R8 closed by decision + implementation rule).
- Output lands in `rvnLastBakedMp4` + TakeManager stamps exactly as before (TakeManager / attach / Download / recovery / H6 verification unaffected).

**Dep:** `mediabunny` (tree-shakable, WebCodecs-native, ~5 kB gz core; cost accepted). See ADR-0003 for full consequences, phases (spike → hybrid cut → full), new risks R9–R12, and verification harness strategy (global-frame fidelity checks, alpha edges, A/V, honest telemetry).

**Out of scope / Non-goals:** pixel-identical output with prior alphamerge; removing FFmpeg from the project; workerizing the composite loop in the first cut; user codec knobs. Implementation will live in new module(s) under `src/encoding/` or `src/composite/` (autonomy granted).

**Verification hook:** fidelity harness exercising planner global indices; `node scripts/test-*.mjs` (existing + new); multi-machine visual + timing; end-to-end take/attach after new-path bakes.

**Implementation status — SHIPPED (v5.5.0 → v5.5.1).** Browser full composite merged v5.5.0
(`src/composite/*` plan/probe/orchestrator/fidelity, `composite: 'browser' | 'ffmpeg'` through
`subtitle-canvas-bake.ts`, Lab A/B toggle, timing schema v4, `test-browser-composite-plan.mjs`
17 checks). Phase 0 QA passed on **two machines** (R9 side-by-side, R12 legacy sweep, take/attach
e2e); `experimental.browserComposite` flipped **default-on in v5.5.1** with a one-time rollout
migration. The ~43 s x264 wall is eliminated on the primary path; **v5.7.0 partial-splice** cuts
re-bakes further (only dirty GOPs re-encoded — see R14). As-built:
`docs/v5.5.0-browser-composite-migration.md`; `archive/docs/release-notes-v5.5.1.md`.

## H10 — Encoder-fallback observability (DEFERRED — user decision 2026-07-06)

**Deferral note (user):** not worried — both encoder paths work, and the failure cases this
would instrument are hard to reproduce in practice. Revisit only if a real-world silent
fallback is observed (symptom: a bake that should take ~50 s takes 4–5 minutes with no
explanation). Original scoping below remains valid if that day comes.

<details><summary>Original scoping (for the record)</summary>

- **Item / class it kills:** silent 5–6× bake slowdowns. With `webCodecsBake` default TRUE,
  any calibration-probe failure, encoder error, or hardware quirk silently falls back to the
  MediaRecorder path (+normalize, 228–310 s vs 46–50 s on QA clips). The user sees only
  "bake is slow today", support sees nothing.
- **Evidence:** fallback chain `webcodecs → mediarecorder-parallel → serial → drawtext`
  (`transcription-architecture.md` §gating); default flipped in `bd7d60a`; Overlay Lab
  timing JSON records strategy but the production bake UI does not surface *why* a
  fallback happened.
- **Invariant it protects:** observability principle — honest failure states
  (`engineering-principles.md`); semantic health of the chronos ETA (a MediaRecorder bake
  has a completely different time profile).
- **Surgical change:** thread a `strategyReason` (chosen strategy + fallback cause enum)
  through `subtitle-canvas-bake.ts` into (a) the existing timing log entry and (b) one
  muted line under the bake chronos meter ("WebCodecs unavailable on this device —
  using compatibility path"). No new UI surface.
- **Blast radius:** Studio page only; strings + one field on existing telemetry.
- **Verification hook:** Overlay Lab: force `webCodecsBake:false` → line appears with
  reason `disabled-by-pref`; probe-failure path exercised via lab toggle if available.
- **Out of scope / Non-goals:** remote telemetry (privacy-first product — logs stay local);
  retry orchestration changes; exposing encoder knobs to users.

</details>

## H11 — Concurrent Studio recordings (RESOLVED — user QA 2026-07-06, no code)

**User test results:** two simultaneous recordings work correctly — both capture visual
and audio even when overlapping; processing is sequential; the first take stays
downloadable while the second is still processing, and clicking Download on the first
succeeds. The Reddit recorder panel reflects Design Studio state as intended. The
freshness-precedence design (`takeFreshnessMs` / `isNewerTakeThan` + same-context write
serialization) holds under real concurrent use.

**Known minor edge (accepted, no code change):** in the short gap after the first take
finishes processing but before the second does, the profile/status display briefly shows
the *second* take's length while the first take is the one actually available for
download. Once the second finishes it correctly takes precedence. Transient,
display-only, self-corrects — logged here so a future session doesn't re-diagnose it as
data corruption (it is not; blobs and downloads resolve correctly throughout).

## H12 — Studio-job progress relay mechanism (v5.4.x patch — verify + document)

- **Item / class it kills:** building future features on an unverified assumption. Studio-
  initiated transcode works (QA PASS), but *how* PROGRESS reaches an extension page with
  no `sender.tab` (late-bind fallback? runtime broadcast? skip-relay registry?) was not
  re-read this session — and the relay registry's late-bind fallback targets "active
  Reddit tab", which is wrong for a Studio job if that's the path taken.
- **Evidence:** architecture map §6 open question 1; `relay-registry.ts` late-bind note
  (v1 map); v5.4.0 Phase 2 "transcode client is runtime.sendMessage-based".
- **Surgical change:** read `background.ts` `rememberRelayTab`/broadcast paths for the
  no-tab case; document the answer in architecture-map §3.3 (one paragraph); fix only if
  the late-bind fallback can misroute Studio progress to a Reddit tab.
- **Out of scope / Non-goals:** relay refactor; unifying pipeline transports.

## Carried deferrals

- **H5 — Binary transport / 3:00 cap** (BUG-001 class): unchanged rationale — spans every
  context, 2:00 cap stable and sufficient. Revisit only with a concrete product pull.
- **Vosk model re-download** (~40 MB/session, BUG-013): accepted until an extension-origin
  Vosk migration is justified.

---

## Risk register — WebCodecs / canvas / splice paths (through v5.8.0)

| # | Risk | Likelihood | Impact | Mitigation in place | Residual action |
|---|------|-----------|--------|--------------------|-----------------|
| R1 | Alpha luma calibration differs on other hardware/drivers (probe measured `white=234, black=17, limited` on ONE machine) | Med | Wrong alpha → visible matte fringing | Probe is per-path gate (I13); any failure → MediaRecorder fallback | H10 surfaces when it fires; collect timing JSONs from a second machine before pushing the tag |
| R2 | Premultiply round-trip precision at very low alpha (glow tails) | Low | Subtle edge halos on dark backgrounds | QA-passed on rich-effects clips 2026-07-05 | Keep the compare harness in Overlay Lab; re-check after any FFmpeg core upgrade |
| R3 | `VideoEncoder` VP8 support removed/altered by a Chrome release | Low | Whole fast path dark → silent 5–6× slowdown | Capability probe + full fallback chain | Accepted residual — H10 deferred by user decision; symptom to watch: multi-minute bakes with no explanation |
| R4 | MediaRecorder fallback path rots now that it's off the hot path | Med | Fallback fires and *also* fails → drawtext-only quality | v5.3.9 tests still in suite (`test-chunk-planner`, `test-overlay-concat-args`) | Add "force MediaRecorder" to the periodic QA sweep (Lab toggle exists) |
| R5 | Stale take snapshot adopts overwritten single-slot blobs after crash | ~~Med~~ **Mitigated** | Wrong audio/video attached to Reddit | **H6 shipped 2026-07-06**: `takeArtifactMatchesStore` verification at all three consumption points; mismatch → stamp demoted + honest note | Closed — watch for false-positive demotions near the 5 s tolerance |
| R6 | Recovery triple-channel coupling (snapshot + inflight query + orphan persistence) drifts under future edits | Med | Phantom processing / doubled transcode returns | Recovery chain serialization; QA #4 pass | Money-path trace B in the map is the review checklist for any edit touching one channel |
| R7 | Dual-encode + IVF buffers memory pressure on long clips (2:00 cap) at 640×360 | Low | OOM/abort mid-bake | Segment model bounds working set; 360p; cap | Watch `EncodedOverlaySegmentMeta` cost telemetry on long-clip QA |
| R8 | Composite stage (~43 s) perceived as regression once users compare with render-only timings | Med (UX) | Trust in progress UI | **ADR-0003 accepted (browser full composite)**; implementation must use distinct honest chronos stages with real frame/encoder-derived ratios (no fudging). Legacy fallback paths unchanged. | Closed by decision + strict stage-label rule in ADR-0003. |
| R9 | Browser canvas blend + VideoEncoder produces visible differences from alphamerge (glow tails, subpixel, premul) | Med | Edge quality regression on rich effects | Shared global-frame painter; deterministic indices for comparison harness; canvas premul discipline matches overlay encoder; fallback preserved | New dedicated fidelity harness (see ADR-0003); document "production-grade, not bit-identical" |
| R10 | Audio passthrough mux drifts timing or loses channels vs FFmpeg | Low | A/V desync or corrupt baked MP4 | Sample-accurate demux + same PTS math as planner; harness duration + alignment asserts | Duration/container validation in bake tests + harness |
| R11 | VideoDecoder/Encoder capability or perf varies widely vs FFmpeg path | Med | Slow/failed bakes on some hardware (silent fallback risk) | Extend existing probe to decode+encode roundtrip; full fallback chain; honest surfacing | **Two-machine capability matrix PASS (v5.5.0 QA); default-on v5.5.1.** Residual = long-tail hardware → honest fallback |
| R12 | New dep + composite surface increases maintenance / breakage surface | Low | Future Chrome/dep breakage | Small tree-shaken dep (mediabunny **1.50.6 pinned exact**); all core logic (painter/segments) in-repo; FFmpeg composite path is permanent fallback | ~~Pin dep~~ done; "force legacy composite" Lab toggle **shipped** (browser-composite toggle OFF) |
| R13 | 30 MB `rvnLastBakedMp4` cap silently drops oversized composite output (`saveLastBakedMp4` returns without saving; take stamp would still update) | Low (bitrate pinned) | Bake "succeeds" but Download/attach serve the PREVIOUS artifact | Composite video bitrate pinned 1.5 Mbps (`composite-plan.ts`, ≈24.5 MB worst case at 2:00 cap incl. AAC); pre-encode size-estimate warning; Node test asserts ≥10% headroom | Verify real output size at the 2:00 cap during Phase 0 QA; consider a save-failure surface for ALL bake paths (pre-existing class) |
| R14 | A splice's re-encoded GOP uses a fresh encoder whose avcC / sample-description differs from the kept AVC packets → corrupt decode across the boundary | Med | Garbled frames at the splice seam | **Self-verifying** `verifySpliceKeptFrames` decodes kept-region anchors and requires pixel-equality with the original → any mismatch throws → full composite (I16); VP9 keyframes are self-contained | Second-machine encoder variance may raise the *full-fallback* rate (never a wrong pixel); collect splice logs from a 2nd machine |
| R15 | Timeline/List two-view edits desync — an edit in one view lost because the other's stale DOM is read on Apply (dirty-state collapse) | Med | Silent loss of a cue edit | `captureActiveDraft()` reads the List DOM only when List is active; Timeline writes straight to `modalDraft` (Sprint-3 fix, QA PASS) | Any NEW view onto the cue draft must route through the same capture discipline — the review checklist for editor changes |

---

## Resolved items (archive)

### v2.0 session (2026-07-06)
| Item | Resolution |
|------|-----------|
| H7: `webCodecsBake` default drift in `transcription-architecture.md` | Fixed in place (§gating) |
| H7: `rvn.take.current` missing from `design-studio.md` §3.2 storage map | Row + take-lifecycle note added |
| Stale ADR reference (`adr/0001-voice-recorder-prefs-transcriptconfig.md`, never created; number reused by WebCodecs ADR) | Dropped — the `transcriptConfig` optionality concern did not recur across 5.3.x; ADR numbering now: 0001 WebCodecs, 0002 TakeManager, 0003 composite stub |

### v1.0 era (eloquent-5, 2026-06-24)
| Item | Sprint | Resolution |
|------|--------|-----------|
| H1: `subtitle-effects.ts` undefined arg to `normalizeHexColor` | eloquent-5 | Guarded with default on argument side |
| H2: `voice-recorder.ts` dead `phase === 'error'` branch | eloquent-5 | Dead comparison removed |
| H3: `vosk-sandbox-host.ts` ModelMessage union narrowing | eloquent-5 | Discriminant guards on `message.event` |
| H4: Relay registry SW-restart resilience | eloquent-5 | `clearAllRelayTabs()` on boot; connection-failure cleanup in all three relay broadcasts |
| Timeout UX lockout; `burnInLogIndicatesFailure` needle; font loader SPOF; `canBakeNow()` lockout | eloquent-3/5 | See v1 archive in git history of this file |

---

## Resume in a new chat (carry-forward)

```
Hardening backlog v2.4 (2026-07-11), main @ v5.8.0.
DONE: H6 stamp verification SHIPPED; H7 doc drift fixed; H11 closed by user QA;
H9 SHIPPED — browser full composite default-on since v5.5.1 (two-machine QA PASS;
~43 s x264 wall gone on the primary path). v5.7.0 partial-splice execution: avcC
hazard mitigated BY CONSTRUCTION via the kept-region fidelity gate (I16) = R14.
v5.8.0 timeline two-view source-of-truth = R15 (handled by captureActiveDraft).
OPEN (carried v5.x patches): H8 recovery voice-prefs provenance — MAY be subsumed by
v5.6.0 TakeVoiceStamp, VERIFY before scoping; H12 verify Studio-job progress relay.
DEFERRED: H10 fallback observability (user decision).
Risks live: R1 (now fallback-tier only — browser composite has no alphamerge), R14
splice avcC (mitigated), R15 timeline two-view. NO new OPEN item from the v5.5–v5.8 arc.
Next feature likely: atomic trim APPLY (edits.trim intent is INERT until then) — own branch + QA.
```
