/**
 * v5.6.0 — Voice re-apply plan helpers (pure logic, no DOM, no WASM).
 *
 * The deterministic core of the audio-decoupling pipeline
 * (docs/v5.6.0-audio-decoupling.md §3): chronos stage labels, the honest
 * progress model, remux output validation, and the clean-audio availability
 * vocabulary. Everything here is Node-testable
 * (scripts/test-voice-reapply-plan.mjs) — browser-only orchestration lives in
 * voice-reapply.ts / audio-remux.ts.
 *
 * Sync: voice-reapply.ts (consumer), audio-remux.ts (validation + tail rule),
 *       clean-audio-source.ts (availability reasons),
 *       composite-plan.ts (the pattern this module mirrors; AAC rebase
 *       helpers are imported from there, not duplicated)
 */

// ---------------------------------------------------------------------------
// Chronos stages (v5.3.9.1 rule: distinct work never shares a stage string)
// ---------------------------------------------------------------------------

export const VOICE_REAPPLY_STAGES = {
  /** Dulcet II graph render (ffmpeg.wasm) — the dominant leg. */
  dsp: 'voice-reapply-dsp',
  /** Stream-copy remux of the new audio under the base MP4's video track. */
  remuxBase: 'voice-reapply-remux-base',
  /** Same audio under the baked MP4's video track (only when one is stamped). */
  remuxBaked: 'voice-reapply-remux-baked',
  /** IDB store writes + take re-stamp (discrete ticks). */
  save: 'voice-reapply-save',
} as const;

export type VoiceReapplyStage =
  (typeof VOICE_REAPPLY_STAGES)[keyof typeof VOICE_REAPPLY_STAGES];

/**
 * Progress bands inside the pipeline's [0,1] ratio space. DSP dominates wall
 * time (full ffmpeg.wasm render); the remux legs are stream-copy and fast; the
 * save leg is discrete. When there is no baked artifact, the base remux leg
 * absorbs the baked band so the meter never idles through a phantom stage.
 */
const DSP_BAND_END = 0.62;
const REMUX_BASE_BAND_END = 0.82;
const REMUX_BAKED_BAND_END = 0.95;
const SAVE_BAND_START = 0.95;

export function voiceReapplyStageBand(
  stage: VoiceReapplyStage,
  hasBakedLeg: boolean,
): { start: number; end: number } {
  switch (stage) {
    case VOICE_REAPPLY_STAGES.dsp:
      return { start: 0, end: DSP_BAND_END };
    case VOICE_REAPPLY_STAGES.remuxBase:
      return {
        start: DSP_BAND_END,
        end: hasBakedLeg ? REMUX_BASE_BAND_END : REMUX_BAKED_BAND_END,
      };
    case VOICE_REAPPLY_STAGES.remuxBaked:
      return { start: REMUX_BASE_BAND_END, end: REMUX_BAKED_BAND_END };
    case VOICE_REAPPLY_STAGES.save:
      return { start: SAVE_BAND_START, end: 1 };
  }
}

/** Map a stage-local ratio into the pipeline's overall [0,1] space (clamped). */
export function computeVoiceReapplyProgress(
  stage: VoiceReapplyStage,
  stageRatio: number,
  hasBakedLeg: boolean,
): number {
  const band = voiceReapplyStageBand(stage, hasBakedLeg);
  const clamped = Math.min(1, Math.max(0, stageRatio));
  return band.start + clamped * (band.end - band.start);
}

// ---------------------------------------------------------------------------
// Remux progress (real packet counters, mirroring computeBrowserCompositeProgress)
// ---------------------------------------------------------------------------

/**
 * Combined remux ratio from the two real packet counters. Both tracks weigh by
 * their expected packet counts; clamped so stats-vs-stream mismatches can never
 * push the meter past 1 or backwards. Unknown totals (≤0) contribute nothing.
 */
export function computeRemuxProgress(
  videoPacketsMuxed: number,
  audioPacketsMuxed: number,
  expectedVideoPackets: number,
  expectedAudioPackets: number,
): number {
  const expectedTotal =
    Math.max(0, expectedVideoPackets) + Math.max(0, expectedAudioPackets);
  if (expectedTotal <= 0) return 0;
  const done = Math.max(0, videoPacketsMuxed) + Math.max(0, audioPacketsMuxed);
  return Math.min(1, done / expectedTotal);
}

// ---------------------------------------------------------------------------
// Remux output validation
// ---------------------------------------------------------------------------

/**
 * Reverb/convolution fragments may ring past the clip end; the remux drops
 * audio packets whose (rebased) start lies beyond video end + this allowance,
 * so the output duration stays bounded and store caps stay predictable.
 */
export const AUDIO_TAIL_ALLOWANCE_SECONDS = 1;

/**
 * Audio may legitimately end slightly short of the video (AAC priming trim +
 * frame granularity). Anything beyond this is a broken render.
 */
export const AUDIO_UNDERRUN_TOLERANCE_SECONDS = 0.35;

/** True when a (rebased) audio packet starts beyond the allowed tail window. */
export function shouldDropTailAudioPacket(
  rebasedTimestampSeconds: number,
  videoDurationSeconds: number,
): boolean {
  return rebasedTimestampSeconds >= videoDurationSeconds + AUDIO_TAIL_ALLOWANCE_SECONDS;
}

export interface AudioRemuxCheckInput {
  videoPacketsMuxed: number;
  audioPacketsMuxed: number;
  /** From the input video track's computePacketStats — must be copied exactly. */
  expectedVideoPackets: number;
  videoDurationSeconds: number;
  /** End of the last muxed audio packet (rebased timeline). */
  audioEndSeconds: number;
}

/**
 * Post-mux sanity gate: any failure means the artifact must NOT be adopted —
 * the caller aborts and leaves every store and stamp untouched (I7).
 */
export function validateAudioRemuxOutput(input: AudioRemuxCheckInput): string | null {
  if (input.videoPacketsMuxed !== input.expectedVideoPackets) {
    return (
      `Video stream copy wrote ${input.videoPacketsMuxed} packets but the ` +
      `source track has ${input.expectedVideoPackets}.`
    );
  }
  if (input.audioPacketsMuxed <= 0) {
    return 'Remux produced no audio packets.';
  }
  const underrun = input.videoDurationSeconds - input.audioEndSeconds;
  if (underrun > AUDIO_UNDERRUN_TOLERANCE_SECONDS) {
    return (
      `Audio ends ${underrun.toFixed(3)}s before the video ` +
      `(> ${AUDIO_UNDERRUN_TOLERANCE_SECONDS}s tolerance).`
    );
  }
  const overrun = input.audioEndSeconds - input.videoDurationSeconds;
  if (overrun > AUDIO_TAIL_ALLOWANCE_SECONDS + AUDIO_UNDERRUN_TOLERANCE_SECONDS) {
    return (
      `Audio overruns the video by ${overrun.toFixed(3)}s ` +
      `(tail allowance ${AUDIO_TAIL_ALLOWANCE_SECONDS}s).`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clean-audio availability vocabulary (clean-audio-source.ts)
// ---------------------------------------------------------------------------

export type CleanAudioUnavailableReason =
  | 'no-take'
  | 'no-stamp'
  | 'store-empty'
  | 'stamp-mismatch';

/** Honest user-facing copy per unavailability reason (deck/panel hint text). */
export function cleanAudioUnavailableMessage(reason: CleanAudioUnavailableReason): string {
  switch (reason) {
    case 'no-take':
      return 'No current take — record a clip first.';
    case 'no-stamp':
      return 'This take predates voice re-apply — re-record to enable it.';
    case 'store-empty':
      return 'The original recording is no longer stored — re-record to change the voice.';
    case 'stamp-mismatch':
      return 'A newer recording replaced this take’s audio — re-record to change the voice.';
  }
}

// ---------------------------------------------------------------------------
// Timing telemetry (harness capture, mirrors BrowserCompositeTiming)
// ---------------------------------------------------------------------------

export interface VoiceReapplyTiming {
  /** Dulcet II render wall time (ffmpeg.wasm). */
  dspMs: number;
  /** Base MP4 remux wall time. */
  remuxBaseMs: number;
  /** Baked MP4 remux wall time (null when no baked artifact existed). */
  remuxBakedMs: number | null;
  /** Store writes + take re-stamp wall time. */
  saveMs: number;
  totalMs: number;
  /** Rendered voice track bytes (AAC M4A). */
  audioBytes: number;
  baseBytes: number;
  bakedBytes: number | null;
}
