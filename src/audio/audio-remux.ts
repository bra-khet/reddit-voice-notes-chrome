/**
 * v5.6.0 — Audio-replace remux (docs/v5.6.0-audio-decoupling.md §3.4).
 *
 * Replaces an MP4's audio track with a freshly rendered voice track by PURE
 * STREAM COPY on both sides: video packets are copied bit-exact (burned-in
 * subtitles, composite output — every visual pixel untouched, invariant I6),
 * and the DSP output is already AAC-in-MP4 (process-audio.ts renders M4A), so
 * its packets copy straight across too. No encoder is constructed anywhere in
 * this module.
 *
 * PIPELINE (Design Studio page, mirrors browser-composite.ts discipline):
 *   Input(video MP4) → EncodedPacketSink → EncodedVideoPacketSource ┐
 *   Input(voice M4A) → EncodedPacketSink → EncodedAudioPacketSource ┼→
 *     Output(Mp4OutputFormat{fastStart:'in-memory'}) → Blob
 *
 * Audio timestamps go through the same AAC priming rebase as the composite
 * passthrough (composite-plan.ts helpers); tail packets past the video end +
 * allowance are dropped so reverb rings cannot balloon the container
 * (voice-reapply-plan.ts tail rule). Output is validated before the Blob is
 * returned; failures throw and the caller leaves stores untouched (I7).
 *
 * Sync: voice-reapply.ts (consumer), voice-reapply-plan.ts (validation +
 *       progress), composite-plan.ts (rebase helpers)
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  type EncodedPacket,
} from 'mediabunny';
import {
  computeAudioPassthroughOffset,
  rebaseAudioPassthroughTimestamp,
  shouldSkipAudioPassthroughPacket,
} from '@/src/composite/composite-plan';
import {
  computeRemuxProgress,
  shouldDropTailAudioPacket,
  validateAudioRemuxOutput,
} from '@/src/audio/voice-reapply-plan';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

/** Audio packets are muxed ahead of video no further than this (seconds). */
const AUDIO_INTERLEAVE_WINDOW_SECONDS = 1;

/** Yield to the event loop every N video packets so the Studio UI stays live. */
const YIELD_EVERY_PACKETS = 64;

export interface ReplaceAudioOptions {
  /** MP4 whose video track is kept bit-exact (base or baked artifact). */
  video: Blob;
  /** Rendered voice track — AAC in an MP4/M4A container (process-audio output). */
  audio: Blob;
  signal?: AbortSignal;
  /** Module-local [0,1] ratio from real packet counters. */
  onProgress?: (ratio: number) => void;
}

export interface ReplaceAudioResult {
  blob: Blob;
  videoPackets: number;
  audioPackets: number;
  videoDurationSeconds: number;
  /** End of the last muxed audio packet on the rebased timeline. */
  audioEndSeconds: number;
  elapsedMs: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Audio remux cancelled.', 'AbortError');
  }
}

async function yieldToEventLoop(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) {
    await sched.yield();
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Run the audio-replace remux. Returns the validated MP4 Blob or throws —
 * AbortError for deliberate cancels, plain Error otherwise. Never returns a
 * partial result.
 */
export async function replaceAudioTrack(
  options: ReplaceAudioOptions,
): Promise<ReplaceAudioResult> {
  const startedAt = performance.now();
  throwIfAborted(options.signal);

  const videoInput = new Input({ source: new BlobSource(options.video), formats: ALL_FORMATS });
  const audioInput = new Input({ source: new BlobSource(options.audio), formats: ALL_FORMATS });
  let output: Output<Mp4OutputFormat, BufferTarget> | null = null;

  try {
    const videoTrack = await videoInput.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('Remux input has no video track.');
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error('Rendered voice track has no audio track.');

    const videoCodec = await videoTrack.getCodec();
    if (!videoCodec) throw new Error('Remux video codec unrecognized — cannot stream-copy.');
    const videoDecoderConfig = await videoTrack.getDecoderConfig();
    if (!videoDecoderConfig) throw new Error('Remux video decoder config unavailable.');

    const audioCodec = await audioTrack.getCodec();
    if (!audioCodec) throw new Error('Voice track audio codec unrecognized — cannot stream-copy.');
    const audioDecoderConfig = await audioTrack.getDecoderConfig();
    if (!audioDecoderConfig) throw new Error('Voice track decoder config unavailable.');

    const videoStats = await videoTrack.computePacketStats();
    const audioStats = await audioTrack.computePacketStats();
    const expectedVideoPackets = videoStats.packetCount;
    const videoDurationSeconds = await videoTrack.computeDuration();
    throwIfAborted(options.signal);

    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoSource);
    const audioSource = new EncodedAudioPacketSource(audioCodec);
    output.addAudioTrack(audioSource);
    await output.start();

    let videoPackets = 0;
    let audioPackets = 0;
    let audioEndSeconds = 0;

    const emitProgress = (): void => {
      options.onProgress?.(
        computeRemuxProgress(
          videoPackets,
          audioPackets,
          expectedVideoPackets,
          audioStats.packetCount,
        ),
      );
    };

    // ---- audio pull (rebased + tail-bounded), drained in step with video ----
    const audioPacketIterator = new EncodedPacketSink(audioTrack).packets();
    let pendingAudio: EncodedPacket | null = null;
    let audioDone = false;
    let audioFirst = true;
    let audioTimestampOffset: number | null = null;

    const muxAudioPacket = async (packet: EncodedPacket): Promise<void> => {
      if (audioTimestampOffset === null) {
        // Same AAC priming rebase as the composite passthrough (BUG FIX 5e906be class).
        audioTimestampOffset = computeAudioPassthroughOffset(packet.timestamp);
      }
      const rebased = rebaseAudioPassthroughTimestamp(packet.timestamp, audioTimestampOffset);
      if (shouldSkipAudioPassthroughPacket(rebased, packet.duration)) return;
      if (shouldDropTailAudioPacket(rebased, videoDurationSeconds)) {
        // Reverb/convolution ring past clip end — bounded by design (§3.4).
        audioDone = true;
        return;
      }
      const ready = rebased === packet.timestamp ? packet : packet.clone({ timestamp: rebased });
      await audioSource.add(ready, audioFirst ? { decoderConfig: audioDecoderConfig } : undefined);
      audioFirst = false;
      audioPackets += 1;
      audioEndSeconds = Math.max(audioEndSeconds, rebased + packet.duration);
    };

    const drainAudioUpTo = async (upToSeconds: number): Promise<void> => {
      while (!audioDone) {
        if (!pendingAudio) {
          const next = await audioPacketIterator.next();
          if (next.done) {
            audioDone = true;
            return;
          }
          pendingAudio = next.value;
        }
        if (pendingAudio.timestamp > upToSeconds) return;
        const packet = pendingAudio;
        pendingAudio = null;
        await muxAudioPacket(packet);
      }
    };

    // ---- video stream copy (decode order; PTS carried on each packet) ----
    const videoPacketIterator = new EncodedPacketSink(videoTrack).packets();
    let videoFirst = true;
    let videoTimestampOffset: number | null = null;
    for await (const packet of videoPacketIterator) {
      throwIfAborted(options.signal);
      if (videoTimestampOffset === null) {
        // Defensive: our pipeline MP4s start at 0, but the muxer rejects
        // negative PTS — apply the same rebase rule as audio if ever needed.
        videoTimestampOffset = computeAudioPassthroughOffset(packet.timestamp);
      }
      const rebased = rebaseAudioPassthroughTimestamp(packet.timestamp, videoTimestampOffset);
      const ready = rebased === packet.timestamp ? packet : packet.clone({ timestamp: rebased });
      await videoSource.add(ready, videoFirst ? { decoderConfig: videoDecoderConfig } : undefined);
      videoFirst = false;
      videoPackets += 1;
      emitProgress();
      await drainAudioUpTo(rebased + AUDIO_INTERLEAVE_WINDOW_SECONDS);
      if (videoPackets % YIELD_EVERY_PACKETS === 0) {
        await yieldToEventLoop();
      }
    }
    videoSource.close();

    // Remaining audio up to the tail bound, then close.
    await drainAudioUpTo(Number.POSITIVE_INFINITY);
    audioSource.close();
    emitProgress();

    throwIfAborted(options.signal);
    await output.finalize();

    const failure = validateAudioRemuxOutput({
      videoPacketsMuxed: videoPackets,
      audioPacketsMuxed: audioPackets,
      expectedVideoPackets,
      videoDurationSeconds,
      audioEndSeconds,
    });
    if (failure) throw new Error(`Audio remux output rejected: ${failure}`);

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength < 256) {
      throw new Error('Audio remux produced an empty MP4 buffer.');
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(
      `${EXTENSION_LOG_PREFIX} Audio remux: ${videoPackets} video + ${audioPackets} audio ` +
        `packets stream-copied in ${elapsedMs}ms (${Math.round(buffer.byteLength / 1024)} KiB).`,
    );

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      videoPackets,
      audioPackets,
      videoDurationSeconds,
      audioEndSeconds,
      elapsedMs,
    };
  } catch (error: unknown) {
    if (output) {
      try {
        await output.cancel();
      } catch {
        // Already finalized or errored — nothing to release.
      }
    }
    throw error;
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}
