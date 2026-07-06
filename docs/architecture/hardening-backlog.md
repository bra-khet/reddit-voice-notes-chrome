# Hardening Backlog — Reddit Voice Notes

**Version:** v2.0 · **Updated:** 2026-07-06 · **Reflects:** `main` @ package `5.4.0` (tag deferred)
**Status:** Ranked hardening items for the v5.4.x standalone-suite direction. Each item cites
evidence, ROI, blast radius, and explicit non-goals. Scored: `(impact × bug_likelihood) ÷ cost`.
**Changelog:** v2.0 (2026-07-06) — full refresh post-v5.4.0; v1 items archived below; risk register added.
v1.0 (2026-06-24) — eloquent-5 era (H1–H5).

Items are updated in place. Add new items here; never fork to `hardening-backlog-v2.md`.

---

## Summary table

| # | Item | ROI | Effort | Status |
|---|------|-----|--------|--------|
| H6 | Artifact-stamp verification at take consumption points | **High** | S (~1 sprint) | **Open — top priority** |
| H7 | Doc drift: `webCodecsBake` default + storage map | High (cheap) | XS | **Resolved this session** |
| H8 | Recovery re-transcode uses resume-time (not capture-time) voice prefs | Med | S | Open |
| H9 | Composite-stage elimination (~43 s x264 wall, 88% of WebCodecs bake) | High impact / high cost | L (multi-sprint) | **Deferred → ADR-0003 stub** |
| H10 | Encoder-fallback observability (honest failure states post-default-flip) | Med-High | S | Open |
| H11 | Concurrent Studio tabs vs single-slot take (dual-session guard) | Med-Low | S (investigate first) | Open — investigate |
| H12 | Studio-job progress relay mechanism — verify + document | Med (cheap) | XS | Open — verify |
| H5 | Binary transport / 3:00 cap restoration (BUG-001 deferred) | Low | XL | Deferred (carried) |
| — | Vosk model re-download (~40 MB/session, BUG-013) | Low | L | Accepted tradeoff (carried) |

---

## H6 — Artifact-stamp verification at take consumption points (TOP)

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

## H7 — Doc drift fixes (RESOLVED this session)

- **Evidence:** `transcription-architecture.md` §gating said `webCodecsBake` default false —
  code default true since `bd7d60a` (`user-preferences.ts:191`); `design-studio.md` §3.2
  storage map lacked `rvn.take.current`.
- **Resolution (2026-07-06):** both canonical docs updated in place; extension-points
  overlay-backbone gotcha updated; ADR-0001 left untouched (immutable record — its
  "follow-ups: flip default after QA" is now satisfied and noted here).

## H8 — Recovery re-transcode uses resume-time voice prefs

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

## H9 — Composite-stage elimination (DEFERRED → ADR-0003)

- **Item / class it kills:** the last super-linear wall in the bake — ~43 s of a ~46–50 s
  WebCodecs bake (88%) is the single x264 composite pass in single-threaded WASM.
- **Evidence:** v5.3.10 QA timing (`.ignore/sub-QA-5.3.10/`, `claude-progress.md` §v5.3.10);
  ADR-0001 option 4 named this follow-up explicitly.
- **Decision needed first:** browser-side composite (VideoDecoder on base MP4 + canvas
  blend + VideoEncoder + MP4 mux) vs WASM x264 tuning vs accept — see ADR-0003 stub.
  Do NOT start this as a "quick optimization"; it changes where the final MP4 is authored.
- **Out of scope / Non-goals (now):** anything in the v5.4.0 tag window. The bake is
  sub-real-time and user-accepted; this is a v5.5+ feature-scale effort with an MP4-demuxer
  dependency decision inside it.

## H10 — Encoder-fallback observability (honest failure states)

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

## H11 — Concurrent Studio tabs vs single-slot take (INVESTIGATE)

- **Item / class it kills:** two Design Studio tabs both mounting `recorder-host` and
  writing `rvn.take.current` — `sessionEpoch` guards races *within* one session;
  same-context write serialization guards one page; nothing examined guards two pages.
- **Evidence:** architecture map §6 open question 2; `take-manager.ts` same-context
  serialization comment; the concurrent-session guard covers Reddit-vs-Studio, not
  Studio-vs-Studio (`claude-progress.md` v5.4.0 Phase 2).
- **Surgical change (investigate first, ~half sprint):** reproduce with two Studio tabs;
  if broken, cheapest guard is `takeFreshnessMs`/`isNewerTakeThan` precedence already in
  the manager + a "recording is active in another Studio tab" deck lock keyed off the
  transient snapshot's `source`+freshness (no new storage).
- **Out of scope / Non-goals:** tab leases/heartbeat locks, BroadcastChannel coordination —
  only if the reproduction shows real corruption, and then still prefer the existing
  freshness precedence.

## H12 — Studio-job progress relay mechanism (VERIFY + document)

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

## Risk register — WebCodecs + canvas paths (v5.4.0 tag window)

| # | Risk | Likelihood | Impact | Mitigation in place | Residual action |
|---|------|-----------|--------|--------------------|-----------------|
| R1 | Alpha luma calibration differs on other hardware/drivers (probe measured `white=234, black=17, limited` on ONE machine) | Med | Wrong alpha → visible matte fringing | Probe is per-path gate (I13); any failure → MediaRecorder fallback | H10 surfaces when it fires; collect timing JSONs from a second machine before pushing the tag |
| R2 | Premultiply round-trip precision at very low alpha (glow tails) | Low | Subtle edge halos on dark backgrounds | QA-passed on rich-effects clips 2026-07-05 | Keep the compare harness in Overlay Lab; re-check after any FFmpeg core upgrade |
| R3 | `VideoEncoder` VP8 support removed/altered by a Chrome release | Low | Whole fast path dark → silent 5–6× slowdown | Capability probe + full fallback chain | H10 (observability) is the real mitigation |
| R4 | MediaRecorder fallback path rots now that it's off the hot path | Med | Fallback fires and *also* fails → drawtext-only quality | v5.3.9 tests still in suite (`test-chunk-planner`, `test-overlay-concat-args`) | Add "force MediaRecorder" to the periodic QA sweep (Lab toggle exists) |
| R5 | Stale take snapshot adopts overwritten single-slot blobs after crash | Med | Wrong audio/video attached to Reddit | Stale-transient demotion (I14); size floor | **H6 — top backlog item** |
| R6 | Recovery triple-channel coupling (snapshot + inflight query + orphan persistence) drifts under future edits | Med | Phantom processing / doubled transcode returns | Recovery chain serialization; QA #4 pass | Money-path trace B in the map is the review checklist for any edit touching one channel |
| R7 | Dual-encode + IVF buffers memory pressure on long clips (2:00 cap) at 640×360 | Low | OOM/abort mid-bake | Segment model bounds working set; 360p; cap | Watch `EncodedOverlaySegmentMeta` cost telemetry on long-clip QA |
| R8 | Composite stage (~43 s) perceived as regression once users compare with render-only timings | Med (UX) | Trust in progress UI | Chronos stage labels are honest per stage | ADR-0003 decision; do not "fix" by fudging the meter |

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
Hardening backlog v2.0 (2026-07-06), main @ 5.4.0 (tag deferred).
Top open: H6 stamp verification (take-manager.ts:46 contract unimplemented at
recorder-panel.ts:662 / studio-take-recovery.ts / Download CTA) — one pure helper + 3 call sites.
Then: H8 voice-prefs provenance on recovery, H10 fallback observability, H12 verify Studio
progress relay, H11 investigate dual Studio tabs. H9 composite wall → ADR-0003 (decision first).
Risk register R1–R8 above; R5 is H6, R3/R4 are H10.
```
