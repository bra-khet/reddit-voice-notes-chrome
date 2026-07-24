# Transcription and Subtitle-Bake Architecture

<!--
CHANGED: Replaced phase chronology and version-specific bake narratives with the current pipeline contract.
WHY: Post-v6 work needs topology, ownership, fallback, and extension rules; historical QA remains archived.
-->

## Archive Notice (Living Document)

The full v6-checkpoint reference—with phase logs, performance measurements, and per-version implementation detail—is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/transcription-architecture.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/transcription-architecture.md). Original design sources are indexed by [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md); milestones live in [`HISTORY.md`](HISTORY.md).

Read this file before changing Vosk, cue ownership, subtitle painting, composite strategy, trim timing, or transcription terminal handling.

## Layer contract

Final media order is:

1. theme/personal background in the record-time canvas;
2. audio-reactive visuals in the same canvas;
3. captions composited after the clean base MP4.

STT always reads a clone of raw capture audio, not voice-processed export audio.

## MV3 execution constraints

| Surface | Relevant capability | Constraint |
|---------|---------------------|------------|
| Extension page / offscreen | Web Audio, extension APIs, `wasm-unsafe-eval` | No `unsafe-eval` or blob-worker Vosk bootstrap |
| Manifest sandbox | `unsafe-eval`, `worker-src blob:` | Opaque/null origin; no extension APIs |
| Background service worker | Durable relay/terminal owner | No DOM; lifecycle-sensitive |
| Reddit content script | Page-isolated UI | Cannot own extension IDB; uses relays |
| Hosted Studio | Shared Studio source on HTTPS | Browser shim + in-page pipeline host |

Vosk-browser must run in `public/vosk-sandbox.html` with its bundled host and blob worker. The parent validates `event.source`; it cannot authenticate the opaque sandbox by matching `event.origin`.

## Transcription pipeline

```text
stopRecording()
  ├─ original WebM → transcode queue → clean base MP4
  └─ cloned WebM → decode to mono PCM → MSG_TRANSCRIBE_START
       → background relay/context
       → offscreen client
       → manifest sandbox + Vosk blob worker
       → MSG_TRANSCRIBE_COMPLETE
       → background terminal normalization/persistence
       → rvnSessionTranscript IDB
       → ready signal after commit
```

Transcode and Vosk have independent serialized queues. Offscreen creation/dispatch is serialized to cover the normal cold-start race.

### Sandbox rules

- Decode WebM to mono PCM outside the sandbox.
- Transfer the PCM `ArrayBuffer`; do not base64 it.
- Parent → sandbox and sandbox → parent use `targetOrigin: '*'` plus strict `event.source` validation.
- Pass an absolute extension model URL; a blob/null worker has no useful relative base.
- Treat Vosk IDBFS failure as non-fatal and use per-session MEMFS.
- Pace waveform chunks, drain inference, and wait for the final result.
- Rebuild `public/vosk-sandbox.js` after changing the host or Vosk dependency.

### Terminal ownership

The background owns transcript terminal state and the watchdog after accepting a job. Closing the initiating tab after ACK must not drop success or timeout. Page teardown detaches; it does not convert pending STT into cancellation. Explicit cancel/supersession retires the job so a late completion cannot overwrite a newer take.

Every outcome persists one explicit state:

- applied transcript;
- no-speech scaffold;
- inference-error scaffold;
- empty-result scaffold;
- timeout scaffold.

Scaffold cue placeholders use the established blank-aware helpers and must bake to no visible text.

## Subtitle edit ownership

- `rvnSessionTranscript` is the durable session transcript.
- Timeline and list views edit one `TranscriptResult` draft.
- Profiles store subtitle enable/style configuration, never session text/timing.
- Cue geometry snaps to the painter frame grid.
- Segment normalization/clamping is shared by preview, rich bake, fallback bake, and QA.
- Trim preview and destructive Apply call the same cue-projection math and shift both transcript copies.

## Bake ladder

Production preserves one ordered strategy ladder:

1. **Eligible verified partial splice** — copy kept packets, repaint dirty GOPs, and prove kept-region pixel fidelity.
2. **Browser full composite** — decode the clean base, call the shared painter at exact PTS, Canvas2D blend, VideoEncoder, and mediabunny mux.
3. **Dual-IVF WebCodecs + FFmpeg alphamerge**.
4. **MediaRecorder overlay + FFmpeg composite** — parallel, then serial, with normalize where required.
5. **Bounded drawtext** with bundled font and degradation tiers.

Any non-abort failure advances to the next strategy; no rich-path failure skips directly past supported intermediate fallbacks.

### Shared painter rules

- `createOverlayFramePainter` is the canonical rich-caption renderer.
- `prepareSegmentsForSubtitleBake` owns blank/scaffold filtering, timing repair, minimum duration, and clip clamping.
- Canvas-only features must be detected explicitly; drawtext does not pretend to render gradient wave, dual border, or animated hue.
- Cue cache keys include cue identity, normalized style, and quantized animation phase.
- MediaRecorder frame pacing uses global timestamps so chunk seams do not change animation phase.
- Render, queue, layer, and timeout budgets remain bounded by the 2:00 clip cap.

## State and modules

| Module | Role |
|--------|------|
| `decode-webm-audio.ts` | WebM → mono PCM |
| `vosk-sandbox-client.ts` | Parent/sandbox bridge |
| `vosk-sandbox-host.ts` | Vosk inference host |
| `transcribe-completion.ts` | Terminal normalization/persistence input |
| `transcript-editing.ts` | Scaffold, cue editing, split, projection |
| `subtitle-overlay-renderer.ts` | Shared painter and MediaRecorder capture |
| `subtitle-overlay-cue-cache.ts` | Bounded cue/phase cache |
| `subtitle-canvas-bake.ts` | Rich-bake orchestration and fallback |
| `src/composite/browser-composite.ts` | Default direct composite |
| `src/composite/composite-splice.ts` | Verified partial re-bake |
| `src/editing/trim-apply.ts` | Atomic base trim and cue shift |
| `src/messaging/types.ts` | Transcribe/burn-in wire contracts |

## Change checklist

Before modifying this subsystem:

1. Check the message, terminal-owner, and hosted-host seams in [`architecture/extension-points.md`](architecture/extension-points.md).
2. Preserve background-owned terminal persistence and cancel/supersession semantics.
3. Preserve one transcript draft and one segment-normalization path.
4. Declare preview/bake and canvas/drawtext behavior for any new visual control.
5. Keep the full fallback ladder and surface honest degradation.
6. Re-run focused pure tests plus real cold-start, tab-close, rich-bake, fallback, timeline, and trim money paths proportional to the change.

Full BUG forensics: [`bug-archive.md`](bug-archive.md).
