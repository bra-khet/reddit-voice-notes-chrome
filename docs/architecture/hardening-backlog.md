# Hardening Backlog — Reddit Voice Notes

**Version:** v2.13 · **Updated:** 2026-07-13 · **Reflects:** `feature/v5.11.0-prefs-storage-refactor` @ package `5.11.0` · **browser QA PASS**
**Status:** Ranked hardening items for the current standalone editing suite. Each item cites
evidence, ROI, blast radius, and explicit non-goals. Scored: `(impact × bug_likelihood) ÷ cost`.
**Changelog:** v2.13 (2026-07-13) — **v5.11 prefs browser QA PASS**; R18 residual gate closed (merge-ready). v2.12 (2026-07-13) — **H8 browser QA PASS** recorded (user confirmed A→B hard-reload mid-transcode → mutate/nuke resume-time prefs → recovery still uses capture-time voice). Docs had left “re-run pending” after code land; no re-test required for v5.11 (prefs IDB is orthogonal to take-owned `captureVoiceIntent`). v2.11 (2026-07-12) — v5.11 full-IDB preferences adds R18; browser matrix remains the residual gate for prefs only. v2.10 (2026-07-12) — H8 RESOLVED in code. Earlier history remains in git.

Items are updated in place. Add new items here; never fork to `hardening-backlog-v2.md`.

---

## Summary table

| # | Item | ROI | Effort | Status |
|---|------|-----|--------|--------|
| H6 | Artifact-stamp verification at take consumption points | **High** | S | **Resolved (2026-07-06)** |
| H7 | Doc drift: `webCodecsBake` default + storage map | High (cheap) | XS | **Resolved (2026-07-06)** |
| H11 | Concurrent Studio recordings vs single-slot take | Med-Low | — | **Resolved — user QA, no code needed (2026-07-06)** |
| H13 | Artifact-store writes must acknowledge persistence before stamps/signals | **High** | S | **Resolved (2026-07-12)** |
| H14 | Transcribe terminal state must survive initiating-tab teardown (BUG-038) | **High** | S | **Resolved (2026-07-12) · browser QA PASS · merged** |
| H8 | Recovery re-transcode uses resume-time (not capture-time) voice prefs | Med | S | **Resolved (2026-07-12) · browser QA PASS** |
| H12 | Studio-job progress relay mechanism — verify + document | Med (cheap) | XS | **Resolved (2026-07-11) — direct runtime broadcast** |
| H10 | Encoder-fallback observability | Med-High | S | **Deferred — user decision** (both paths work; failures hard to reproduce) |
| H9 | Composite-stage elimination (~43 s x264 wall, 88% of WebCodecs bake) | High impact / high cost | L | **SHIPPED** — browser full composite merged v5.5.0, **default-on since v5.5.1** (two-machine QA PASS). ADR-0003 Accepted. Partial-splice (v5.7.0) cuts re-bakes further |
| — | v5.7 splice avcC · v5.8 two-view · v5.9–v5.10 trim multi-store window | — | — | **Mitigated / monitored** — I16 (R14), `captureActiveDraft` (R15), superseded guard + H6 + raw-leg demote (R16) |
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

## H8 — Recovery re-transcode uses resume-time voice prefs (RESOLVED 2026-07-12 · browser QA PASS)

**Resolution:** added optional `CurrentTake.captureVoiceIntent` (normalized config + id-free
intent key), parsed as an independent dependency-free additive field. `voice-recorder.ts`
writes it in the initial `beginTake` snapshot and refreshes it in an awaited, atomic
stop-time `processing` patch before passing the same config to the first transcode.
`resumeDraftTranscodeInner` now prefers that captured config, promotes a capture-origin
`TakeVoiceStamp` including `voiceEffectFallback`, and consults current prefs only for
legacy drafts. That legacy fallback writes a visible ready-deck note. No blob/store/key,
message family, history model, or retry UI was added.

**Verified (automated):** `test-take-manager.mjs` 37/37 (intent parse + merge coverage),
`test-take-deck.mjs` 13/13, and `npm run build` PASS.

**Verified (browser QA PASS — user, post-code land):** hard-reload mid-transcode (first job
dies incomplete) → edit/nuke resume-time voice prefs in DevTools → reopen Design Studio →
recovered MP4 still uses **capture-time** voice (A), not mutated prefs (B). Confirmed even
when recovered prefs were completely nuked. **No re-run required for v5.11** — prefs full-IDB
migration does not change take-owned `captureVoiceIntent` or recovery preference of that field.

- **Item / class it kills:** silent semantic drift — a draft recovered after tab close is
  re-transcoded with `prefs.voiceEffect` *as of resume time*
  (`studio-take-recovery.ts:62-68`), not the effect active at capture. If the user changed
  voice settings between capture and recovery, the resumed MP4 sounds different from what
  they recorded, with no indication.
- **Evidence (re-verified v5.9.0):** `studio-take-recovery.ts` loads
  `prefs.voiceEffect` immediately before resume transcode. v5.6 added
  `CurrentTake.voice: TakeVoiceStamp`, but capture writes it only with the successful
  `ready` promotion (`voice-recorder.ts`); the interrupted draft this path handles has
  not completed that promotion and normally has no voice stamp. Recovery also ignores
  the transcode outcome's voice stamp/fallback. Therefore v5.6 did **not** subsume H8.
- **Invariant it protects:** preview↔bake — what was auditioned at capture is what the
  take produces.
- **Surgical change:** add an optional JSON-safe `captureVoiceIntent` (normalized config +
  id-free intent key) to take metadata at `beginTake`; recovery uses that config for the
  resumed transcode and promotes the returned `TakeVoiceStamp` with `ready`. Pre-v5.10
  drafts without the field keep today's current-prefs behavior plus an honest note. Keep
  parsing additive and dependency-free in TakeManager. One focused sprint.
- **Blast radius:** `voice-recorder.ts` (one meta field), `studio-take-recovery.ts`,
  deck note rendering. Snapshot field is optional → forward/backward compatible.
- **Verification hook:** capture with effect A → close mid-processing → switch to effect B
  → reopen → note appears; `test-take-manager.mjs` parse round-trip with the new field.
- **Out of scope / Non-goals:** storing auxiliary FFmpeg inputs or rendered audio in the
  snapshot; a multi-take voice-history store; blocking recovery when a legacy draft lacks
  provenance. The normalized config is small JSON, not a blob.

## H13 — Artifact-store writes must acknowledge persistence before stamps/signals (RESOLVED 2026-07-12)

**Resolution:** implemented exactly as scoped, on `feature/h13-persist-before-stamp`. All
three single-slot artifact save functions — `saveLastBaseMp4`, `saveLastBakedMp4`,
`saveLastRecording` — now **throw** on an unpersistable size (bounds exported:
`LAST_BASE_MP4_MIN/MAX_BYTES`, `LAST_BAKED_MP4_MIN/MAX_BYTES`, joining the v5.10
`LAST_RECORDING_MIN/MAX_BYTES`), **propagate** IDB failures, and **return the authoritative
persisted meta** (`savedAt` / `byteLength` / `mimeType` / `durationSeconds`; non-finite
duration normalized to 0 so stamps stay JSON-safe). The four mutation choke points
stamp/signal only from that returned meta:
1. `background.ts` — `MSG_SAVE_LAST_BASE_MP4` + `MSG_SAVE_LAST_RECORDING` handlers (a failed
   save now yields `ok:false`, no stamp, no `LAST_RECORDING_READY` fire) and
   `persistOrphanStudioTranscodeResult` (no stamp/`ready` promotion on failure),
2. `subtitle-bake.ts` — `BAKED_MP4_READY_KEY` + take promotion publish only from the returned
   meta, carried through the new optional `TakeBakeResult.savedAt` into `updateFromBake`,
3. `voice-reapply.ts` — both commit stamps built from returned metas,
4. `trim-apply.ts` — base stamp from returned meta; a raw-leg **save** failure (the
   IDB-failure half I19's size pre-check could not cover) now demotes to the honest v5.9
   stamp-drop and never fails the trim.
On any failure the OLD stamp keeps describing the OLD record (IDB transactions roll back),
so **H6 verification of the prior artifact still passes — reads unchanged**. Stamps built
from returned meta now match store `savedAt` exactly instead of within the 5 s tolerance.
**Bonus fix in the touched region:** the orphan-persist path passed `number | undefined`
into `saveLastBaseMp4` (one of the 3 documented pre-existing `tsc` errors) — closed.
**Verified:** new `scripts/test-artifact-store-writes.mjs` **28/28** (size boundaries ×3
stores, meta-authority vs the written record, stamp-from-meta passes
`takeArtifactMatchesStore`, injected IDB write-failure rejects AND leaves the prior
record + stamp verifiable); full Node sweep green (take-manager 34, timeline 22, take-deck
12, all others unchanged); `tsc` improved 3 → 2 pre-existing; `npm run build` PASS.
Real-browser release regression (bake / voice re-apply / trim apply / attach / recovery)
is the user QA gate before merge/tag.

<details><summary>Original scoping (for the record)</summary>

- **Item / class it kills:** false-success artifact publication — callers claim a fresh
  base/baked MP4 even though the single-slot IDB rejected or failed the write, causing a
  stale blob behind a new stamp/signal and delayed, confusing H6 demotion.
- **Partial progress (v5.10.0, not a full close):** `last-recording-db.ts` exports
  `LAST_RECORDING_MIN_BYTES` / `LAST_RECORDING_MAX_BYTES`; `trim-apply.ts` refuses to
  stamp a trimmed WebM outside those bounds and demotes to `rawAudio: 'dropped'` instead
  (map I19). This is a **caller-side pre-check at one choke point**, not the general
  store-return-meta contract. Base/baked saves and other callers remain unchanged.
- **Evidence:** `saveLastBakedMp4` returns `void` without writing for blobs `<256` or
  `>30 MB`; `saveLastBaseMp4` does the same outside `256..25 MB` and catches/logs IDB
  failures without rethrowing. Callers then publish success: `subtitle-bake.ts` fires
  `BAKED_MP4_READY_KEY` + `updateFromBake`; `background.ts` records `baseMp4` after the
  awaited save; `voice-reapply.ts` and `trim-apply.ts` still manufacture base stamps after
  save (recording path is the only pre-checked leg). R13 already named the baked-size
  instance; the full-pass audit found the class spans every artifact mutation.
- **Invariant it protects:** I15/state ownership — a take stamp and ready signal must
  describe bytes that were durably persisted, never merely intended.
- **Surgical change:** make base/baked save functions reject invalid sizes and IDB errors
  and return the authoritative persisted meta (`savedAt`, byteLength, duration). Update
  the four mutation choke points (background relay, subtitle bake, voice re-apply, trim
  apply) to stamp/signal only from that returned meta. Add pure size-gate tests plus one
  injected write-failure test; keep existing H6 reads unchanged.
- **Blast radius:** storage modules + four callers in background/Studio; no schema,
  message, key, UI-layout, or container change. Failure copy already exists at callers.
- **Verification hook:** Node size-boundary tests; forced IDB rejection must leave the old
  stamp/signal untouched; release regression for bake, voice re-apply, trim, attach.
- **Out of scope / Non-goals:** multi-slot history, transactional IDB across databases,
  content hashing, quota management UI, or changing bitrate/caps. This hardens the success
  contract; it does not redesign storage.

</details>

## H14 — Transcribe terminal state must survive initiating-tab teardown (RESOLVED 2026-07-12 · browser QA PASS)

- **Item / class it kills:** disposable terminal owner — accepted background/offscreen work completes, but the only consumer that can persist success/failure and emit timeout lived in a closable page.
- **Evidence:** H13 QA item 7 + local logs: offscreen `Transcribe job finished` with 2 segments / 59 chars while Studio never received a row or timeout. BUG-026/032/034 show this relay boundary has repeated race history.
- **Invariant it protects:** I20/messages+state — after ACK, every non-cancelled terminal outcome must land in `rvnSessionTranscript` before the ready signal regardless of initiating-tab lifetime.
- **Surgical change:** optional `durationSeconds` on `TranscribeStartRequest`; background job context + 125 s watchdog; pure terminal normalizer; background IDB commit; fail-loud transcript save; page becomes an observer/local cache only.
- **Blast radius:** transcribe START/COMPLETE lifecycle, background relay, session transcript writer. No new context, message family, store, key, take writer, or visual surface.
- **Verification:** `test-transcribe-failure.mjs` 12/12; production build PASS; **real-browser H13 item 7 close/reopen PASS (2026-07-12)** — transcript survives tab teardown; merged to `main` with H13 (no version bump).
- **Out of scope / Non-goals:** no user Retry button, Vosk model/cache changes, transcript/take schema ownership, or transcode recovery refactor. Retry was rejected because Vosk succeeded; it would duplicate healthy work while leaving the owner defect intact.

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

## H12 — Studio-job progress relay mechanism (RESOLVED 2026-07-11)

**Resolution:** no code change required. `transcoder.ts` installs a
`browser.runtime.onMessage` listener in the initiating Studio page. Offscreen
PROGRESS/COMPLETE broadcasts therefore reach Studio directly. `background.ts`
`registerTranscodeTab` recognizes `chrome-extension://` / `moz-extension://` senders and
sets `transcodeSkipTabRelayByJobId`; `relayTranscodeBroadcast` skips only the
`tabs.sendMessage` copy while still performing completion cleanup/orphan persistence.
Burn-in and transcribe use the same `*SkipTabRelayByJobId` pattern. A normal Studio tab
has `sender.tab.id`, so the no-tab active-Reddit late-bind branch is not its delivery path.

**Documented in:** architecture map v2.6 §2.5/§3.3 and extension-points v1.8.
**Out of scope / Non-goals:** transport unification or relay refactoring; the existing
direct-runtime/content-tab split is intentional and working.

## Carried deferrals

- **H5 — Binary transport / 3:00 cap** (BUG-001 class): unchanged rationale — spans every
  context, 2:00 cap stable and sufficient. Revisit only with a concrete product pull.
- **Vosk model re-download** (~40 MB/session, BUG-013): accepted until an extension-origin
  Vosk migration is justified.

---

## Risk register — current architecture (through v5.11.0 implementation)

| # | Risk | Likelihood | Impact | Mitigation in place | Residual action |
|---|------|-----------|--------|--------------------|-----------------|
| R1 | Alpha luma calibration differs on hardware/drivers (fallback overlay tier) | Med | Wrong alpha → visible matte fringing | Real encode→decode calibration is cached per codec+dimensions+fps for the session (I13); failure → MediaRecorder | Accepted fallback-tier residual; H10 would surface fallback cause if revived |
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
| R13 | Base/baked store cap or IDB error silently leaves the previous artifact while callers publish success | ~~Low~~ **Mitigated** | Bake/trim/re-apply appears successful; later H6 demotes or old bytes survive | **H13 shipped 2026-07-12:** saves throw on size/IDB failure and return persisted meta; all four choke points stamp/signal only from it — a failed write reaches the caller's existing failure surface and the old stamp stays H6-valid | Closed — bitrate pins (composite-plan) keep normal outputs under caps; watch for new save callers bypassing the returned meta |
| R14 | A splice's re-encoded GOP uses a fresh encoder whose avcC / sample-description differs from the kept AVC packets → corrupt decode across the boundary | Med | Garbled frames at the splice seam | **Self-verifying** `verifySpliceKeptFrames` decodes kept-region anchors and requires pixel-equality with the original → any mismatch throws → full composite (I16); VP9 keyframes are self-contained | Second-machine encoder variance may raise the *full-fallback* rate (never a wrong pixel); collect splice logs from a 2nd machine |
| R15 | Timeline/List two-view edits desync — an edit in one view lost because the other's stale DOM is read on Apply (dirty-state collapse) | Med | Silent loss of a cue edit | `captureActiveDraft()` reads the List DOM only when List is active; Timeline writes straight to `modalDraft` (Sprint-3 fix, QA PASS) | Any NEW view onto the cue draft must route through the same capture discipline — the review checklist for editor changes |
| R16 | Another take begins during trim apply's final multi-store commit; base (and optional raw WebM) writes are H6-safe but the single-slot transcript has no `takeId` ownership | Low | New take may briefly inherit shifted cues from the prior take; trim caller may report success after `expectId` returns null | Long transform happens before a superseded guard; remaining race is base-save → (optional recording-save) → transcript-save → take-patch; H6 prevents wrong base/recording adoption; raw-leg size pre-check avoids unpersistable stamps (I19) | Keep explicit; if concurrency expands or reproduces, add transcript ownership/CAS. Do not invent cross-database transactions preemptively |
| R17 | A closable page is the only owner of a pipeline's terminal save/timeout | ~~High~~ **Mitigated** | Worker reports success but durable state never lands; UI remains Pending | **H14 / BUG-038:** background owns transcribe terminal context, commit, ready publication, and watchdog; cancel/supersession retires context | Closed for transcribe. Apply the message-v3 terminal-owner rule to any future recoverable pipeline |
| R18 | Preferences split across migration state, coordinator notification, or a host-origin content-script DB | ~~Med~~ **Mitigated** | Recorder/Studio observe different profiles or the legacy copy is removed before durable v2 data exists | **ADR-0006 / I21:** all truth in one extension-IDB transaction; coordinator written last; v1 removed last; failed migration retains v1; Reddit wrappers call background direct helpers; 12 focused checks | **Browser matrix PASS 2026-07-13** (fresh/upgrade/hot-swap/relay/Export-Import/DevTools). §3 force-fail PARTIAL accepted (fallback + Node inject). Closed for release; watch new writers bypassing `enqueuePrefsOp` |

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
Hardening backlog v2.13 (2026-07-13), feature/v5.11.0-prefs-storage-refactor @ package 5.11.0.
v5.11 prefs browser QA PASS — merge-ready.
DONE: H6 stamp verification; H7 doc drift; H9 browser composite default-on;
H11 concurrent capture QA; H12 Studio progress = direct runtime broadcast;
H13 persist-before-stamp — all three saveLast* throw on size/IDB failure and return
  persisted meta; four choke points stamp/signal only from it; H6 reads untouched;
  test-artifact-store-writes.mjs 28; browser QA PASS.
H14 / BUG-038 — background terminal transcript persistence + 125s watchdog; Node 12/12,
  build PASS; real-browser H13 item 7 close/reopen PASS (transcript survives).
H8 RESOLVED + browser QA PASS — captureVoiceIntent is durable before transcode; recovery
  reuses it, promotes TakeVoiceStamp, and visibly discloses current-prefs fallback for
  legacy drafts. Node 37/37 + 13/13; user A→B hard-reload + mutate/nuke prefs confirmed
  capture-time voice. No H8 re-run for v5.11 (prefs IDB orthogonal).
DEFERRED: H10 fallback observability (user decision); H5 binary/cap restoration.
Mitigated risks: R13 by H13; R14 by I16; R15 by captureActiveDraft; R17 by H14;
  R18 by ADR-0006/I21 + browser QA PASS 2026-07-13.
R16: narrow 3–4 store trim commit window; H6 protects base/recording; transcript lacks takeId.
Editing arc closed; next product candidate: v6 visual maturity after v5.11.0 merge.
v5.11 adds ADR-0006, one structured IDB class, signal-only coordinator, and two bounded DB requests; no context/progress pipeline.
```
