# ADR-0004: Audio decoupling — voice provenance stamp + stream-copy re-apply (no new stores, no new pipelines)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Reflects branch/tag:** `feature/5.6.0-audio-decoupling` (baseline `main` @ `v5.5.1`, commit `e97a0e9`)
- **Deciders:** User strategic direction (contained editing-suite backend) + architecture decision (this record)

## Context

The v5.6.0 mission: make voice effects re-applicable after capture ("Change Voice" without re-recording), as the keystone of turning the Design Studio into a contained A/V + subtitles editing-suite backend.

Code-verified ground truth reframed the problem (docs/v5.6.0-audio-decoupling.md §1): the "clean audio" the initial draft wanted to start storing **already persists** — the capture WebM in `rvnLastRecording` carries raw mic audio (voice is applied by the offscreen FFmpeg *transcode*, `voice-recorder.ts` → `transcodeWebmToMp4(…, prefs.voiceEffect)`), is stamped on the take as `baseRecording`, and is H6-verifiable. What was actually missing:

1. **Provenance** — nothing records which voice a take's `baseMp4` audio carries (`prefs.voiceEffect` is global and mutable).
2. **A re-application mechanism** — no path from raw audio + intent → updated artifacts.

Constraints: single-slot take model (ADR-0002), H6 stamp verification mandatory, Reddit attach contract (ordinary MP4s), chronos honesty, MediaRecorder + drawtext fallback chain untouched, no blobs in the take snapshot.

## Decision

1. **Voice provenance is a take-snapshot field**, not a store: `TakeVoiceStamp { intentKey, config (normalized VoiceEffectConfig), appliedAt, origin: 'capture'|'reapply', revision, fallback? }` on `CurrentTake`, additive and defensively parsed. The recorder stamps `origin:'capture'` when transcode lands; the re-apply pipeline stamps `origin:'reapply'` with `revision+1`.
2. **Re-apply is DSP + pure stream-copy remux on the Studio page**: raw WebM (H6-verified via `src/audio/clean-audio-source.ts`) → `resolveVoiceGraph` + `processAudioWithGraph` (AAC M4A; `forceRender` for voice-off) → `src/audio/audio-remux.ts` copies the existing video packets bit-exact and the new audio packets under them (mediabunny `EncodedVideoPacketSource`/`EncodedAudioPacketSource`) → overwrite `baseMp4` **and** `bakedMp4` (when stamped) → re-stamp atomically. No encoder anywhere in the remux; visuals — including burned-in subtitles — are preserved by construction, so a voice change never forces a visual re-composite.
3. **Single-slot model is kept**, with provenance instead of derived-artifact slots: overwrite + `revision`/`origin` audit trail; rollback = re-apply the previous config (the raw source is the invariant original).

## First-class concern impact

- **Preview ↔ bake:** no new gap — re-apply resolves through the *same* `resolveVoiceGraph` + renderer as the Studio audition, so "Test" is a faithful preview of "Apply".
- **Effect composition:** voice layer only; the visual layers are bit-copied, compositing order untouched.
- **Message contracts:** none added. Everything runs on the Studio page; other contexts learn via the take snapshot (`storage.onChanged`) + the existing `BAKED_MP4_READY_KEY` signal. (Extension-points rule upheld: state → storage; only cross-context work-with-progress earns a pipeline.)
- **State ownership:** two additive snapshot fields (`voice`, `edits`) — TakeManager remains the only door; writers remain the sanctioned three (recorder, background, Studio actions).

## Options considered

1. **Chosen: provenance stamp + stream-copy remux, single slot.** Zero storage growth, zero re-encode, visuals bit-exact, no new contexts/pipelines/stores. Cost: re-apply only works while the current take still owns the single-slot WebM (honest degradation for legacy/superseded takes).
2. **New clean-audio store + derived artifact slots.** Enables multi-take history and rollback copies — but duplicates bytes that already exist, breaks the single-slot invariants H6 was built around, and is a take-library decision that deserves its own ADR when a multi-take model is actually wanted.
3. **Audio-only FFmpeg re-mux (offscreen pipeline).** Reuses the transcode machinery but re-encodes video or pays a second container pass in WASM, needs a new message family + relay, and puts a ~43 s-class wall back on the path ADR-0003 just removed.
4. **Do nothing.** Voice changes keep requiring a full re-record; the editing-suite backend has no audio leg.

## Consequences

- **Positive:** "Change Voice" lands with sub-second remux cost on top of the (already-familiar) DSP render; the same remux primitive is the future seam for any audio-track replacement (music beds, normalization passes). Trim (mediabunny `Conversion`) and partial re-bake planning ride the same page-local, storage-synced pattern.
- **Negative / accepted cost:** a failed save between the base and baked store writes can leave stamps stale until H6 demotes them (writes are last, so consumers never adopt wrong bytes — accepted). Reverb tails are bounded at video end + 1 s (`AUDIO_TAIL_ALLOWANCE_SECONDS`) rather than preserved in full — documented, matches store-cap predictability.
- **Rejected over-engineering:** worker offload of DSP/remux (measure first — the page already hosts full composites); derived-artifact slots (option 2); partial-splice *execution* in this branch (plan + telemetry only — landing splices without the fidelity-harness extension would repeat the v5.3.9.1 lesson).
- **Follow-ups:** Phase 2b splice execution behind `coordinateRebake`; Phase 3 trim-apply integration (artifact update + cue shift, own QA gate); Overlay Lab surface for `VoiceReapplyTiming`; extension-points registry bump (done, v1.5).

## References

- Code: `src/audio/voice-reapply.ts`, `src/audio/audio-remux.ts`, `src/audio/voice-reapply-plan.ts`, `src/audio/clean-audio-source.ts`, `src/session/take-manager.ts` (TakeVoiceStamp/TakeEdits), `src/recorder/voice-recorder.ts` (capture stamp), `src/voice/process-audio.ts` (`forceRender`), `src/editing/*`, `src/timeline/timeline.ts`
- Docs: `docs/v5.6.0-audio-decoupling.md` (living contract; §12 as-built), ADR-0001 §painter seam, ADR-0002 §writers, ADR-0003 §audio passthrough
- Tests: `scripts/test-voice-reapply-plan.mjs`, `test-take-manager.mjs` (v5.6.0 block), `test-timeline.mjs`, `test-segment-dirty-tracker.mjs`, `test-partial-rebake-plan.mjs`
