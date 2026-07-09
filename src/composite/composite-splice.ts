/**
 * v5.7.0 Phase 2b — Browser partial re-bake SPLICE executor
 * (docs/v5.6.0-audio-decoupling.md §4.2; branch feature/5.7.0-partial-rebake-splice).
 *
 * Re-composites ONLY the dirty keyframe-aligned regions of an already-baked MP4
 * and splices them back into the existing bitstream, instead of re-compositing
 * the whole clip. For a small cue edit this replaces ~coverage of the frames and
 * copies the rest bit-exact.
 *
 * TWO INPUTS: the previous BAKED MP4 (kept regions are copied from it bit-exact —
 * their cues are unchanged so their burned-in subtitles are already correct) and
 * the CLEAN BASE MP4 (dirty regions are re-composited from its frames + the new
 * cues — the baked frames still carry the OLD burned-in subtitle there and must
 * not be reused). Both share the pipeline's 1:1 frame grid, so a dirty region's
 * baked PTS also indexes the matching clean base frames.
 *
 * PIPELINE (all in the Design Studio page; reuses browser-composite.ts patterns):
 *   Input(bakedMp4) ─ scan: EncodedPacketSink.packets({verifyKeyPackets}) → buffer
 *     │                     packets + real keyframe frame indices (scanKeyframes gate)
 *     ├─ plan:     planSplice(dirty spans → keyframe-bounded regions) + validate
 *     ├─ reencode: for each 'reencode' region → VideoSampleSink(BASE).samples(range)
 *     │            → draw clean base + painter(new cues) → VideoEncoder → EncodedPackets
 *     │            (stamped with the baked region's PTS for a seamless splice)
 *     └─ assemble: EncodedVideoPacketSource ← kept baked packets (bit-exact)
 *                  interleaved with re-encoded packets in decode order; audio
 *                  passthrough (unchanged); Output(Mp4{fastStart:'in-memory'}) → Blob
 *
 * FRAME MODEL: our pipeline MP4s are 1 packet per frame with strictly increasing
 * PTS in decode order (no B-frames) — scanKeyframes rejects anything else, so
 * packet index IS the global frame index and a region [startFrame,endFrame) maps
 * directly to packet indices. Region time bounds come from the buffered packets'
 * OWN timestamps (fps-independent, exact), not a derived fps.
 *
 * KNOWN HAZARD (why this ships flag-off until the fidelity harness lands): an MP4
 * video track carries one sample description (avcC) for the whole track. Kept AVC
 * packets are described by the ORIGINAL decoder config (anchored on the first
 * add); the re-encoded GOPs are produced by a fresh encoder configured with the
 * artifact's OWN codec string (max SPS/PPS compatibility) but are not proven
 * byte-compatible here. Structural output is validated (frame count + duration);
 * PIXEL correctness across the splice boundary is only guaranteed by the
 * decode-back fidelity check (Phase 2b sprint 4) + user QA. VP9 keyframes are
 * self-contained once the stream is splice-friendly (strictly increasing PTS —
 * browser composite forces VP9 latencyMode realtime to avoid alt-ref reorder);
 * AVC relies on that decode-back proof.
 * FAILURE POLICY: any precondition miss returns null (caller runs the full
 * composite); a mid-run error throws. Never a partial/broken result adopted.
 *
 * Sync: editing/splice-plan.ts (scanKeyframes + planSplice + validation + stages),
 *       editing/partial-rebake-coordinator.ts (SpliceSpan intent + coordinateRebake
 *       will call this in sprint 3), composite-plan.ts (AAC rebase helpers,
 *       bitrate/keyframe constants), browser-composite.ts (painter/audio patterns),
 *       browser-composite-support.ts (capability probe)
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import {
  BROWSER_COMPOSITE_VIDEO_BPS,
  computeAudioPassthroughOffset,
  rebaseAudioPassthroughTimestamp,
  shouldSkipAudioPassthroughPacket,
} from '@/src/composite/composite-plan';
import {
  probeBrowserCompositeSupport,
  type BrowserCompositeSupport,
} from '@/src/composite/browser-composite-support';
import {
  PARTIAL_SPLICE_STAGES,
  computeSpliceProgress,
  computeSpliceReencodeRatio,
  computeSpliceAssembleRatio,
  planSplice,
  diagnoseKeyframeScanFailure,
  scanKeyframes,
  selectSpliceFidelityAnchors,
  validateSplicePlan,
  validateSpliceOutput,
  type PartialSpliceStage,
  type SpliceRegion,
} from '@/src/editing/splice-plan';
import { verifySpliceKeptFrames } from '@/src/composite/composite-fidelity';
import type { SpliceSpan } from '@/src/editing/partial-rebake-coordinator';
import {
  createOverlayFramePainter,
  normalizeOverlaySegments,
} from '@/src/transcription/subtitle-overlay-renderer';
import type { SubtitleStyleConfig, TranscriptSegment } from '@/src/transcription/types';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

/** Audio packets are muxed ahead of video no further than this (seconds). */
const AUDIO_INTERLEAVE_WINDOW_SECONDS = 1;
/** Yield to the event loop every N frames/packets so the Studio UI stays live. */
const YIELD_EVERY = 8;

export interface CompositeSpliceTiming {
  outputCodec: string;
  frameCount: number;
  reencodeFrameCount: number;
  keepFrameCount: number;
  reencodeRegionCount: number;
  scanMs: number;
  reencodeMs: number;
  assembleMs: number;
  finalizeMs: number;
  totalMs: number;
  outputBytes: number;
}

export interface CompositeSpliceOptions {
  /**
   * The EXISTING baked MP4 to splice into — kept regions come from here bit-exact
   * (their cues are unchanged, so their burned-in subtitles are already correct).
   */
  bakedMp4: Blob;
  /**
   * The CLEAN base MP4 (no burned subtitles). Dirty regions are re-composited
   * from THESE frames + the new cues — never from the baked frames, which still
   * carry the OLD burned-in subtitle in the edited region.
   */
  baseMp4: Blob;
  /** New prepared cues (post-edit) painted over the dirty regions. */
  segments: TranscriptSegment[];
  style: SubtitleStyleConfig;
  durationSeconds: number;
  /** Grid-snapped dirty spans from planPartialRebake (strategy must be 'partial'). */
  spans: readonly SpliceSpan[];
  themeBarColor?: string;
  signal?: AbortSignal;
  /** ratio is module-local [0,1]; the caller maps it into the bake band. */
  onProgress?: (ratio: number, stage: PartialSpliceStage) => void;
  onTiming?: (timing: CompositeSpliceTiming) => void;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Composite splice cancelled.', 'AbortError');
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

function createSpliceCanvas(
  width: number,
  height: number,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Splice canvas 2D context unavailable.');
  return { canvas, ctx };
}

/**
 * Buffer every video packet (decode order) with verified key flags, plus the
 * lightweight metadata scanKeyframes needs. Bounded by the ≤30 MB baked-MP4
 * store cap — the same in-memory budget the full composite's BufferTarget uses.
 */
async function scanVideoPackets(
  videoTrack: InputVideoTrack,
): Promise<{ packets: EncodedPacket[]; keyframeFrames: number[]; frameCount: number } | null> {
  const packets: EncodedPacket[] = [];
  const sink = new EncodedPacketSink(videoTrack);
  for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: true })) {
    packets.push(packet);
  }
  const metas = packets.map((packet) => ({ timestamp: packet.timestamp, type: packet.type }));
  const scan = scanKeyframes(metas);
  if (!scan) {
    // CHANGED: surface the concrete scan gate (first-not-key vs non-monotonic PTS)
    // WHY: VP9 quality-mode alt-ref reordering was lumped into a generic message;
    //      C2 QA could not tell scan-gate from fidelity-gate without this detail.
    console.warn(
      `${EXTENSION_LOG_PREFIX} Composite splice: scan rejected — ${diagnoseKeyframeScanFailure(metas)}.`,
    );
    return null;
  }
  return { packets, keyframeFrames: scan.keyframeFrames, frameCount: scan.frameCount };
}

/** Exact presentation seconds of a region boundary, read from the buffered packets. */
function regionBoundsSeconds(
  region: SpliceRegion,
  packets: readonly EncodedPacket[],
  frameCount: number,
): { startSeconds: number; endSeconds: number } {
  const startSeconds = packets[region.startFrame].timestamp;
  const last = packets[frameCount - 1];
  const endSeconds =
    region.endFrame >= frameCount
      ? last.timestamp + last.duration
      : packets[region.endFrame].timestamp;
  return { startSeconds, endSeconds };
}

/**
 * Re-composite a reencode region from the CLEAN BASE frames + the new cues, and
 * encode it into fresh EncodedPackets with a FORCED keyframe on the region's
 * first frame (so the region is self-contained and the kept GOP that follows —
 * which begins on a real keyframe by construction — stays independent). Each
 * encoded frame is stamped with the BAKED region's PTS/duration so it splices
 * seamlessly against the kept baked packets on either side.
 */
async function encodeRegion(
  region: SpliceRegion,
  baseBounds: { startSeconds: number; endSeconds: number },
  targetTimestamps: number[],
  targetDurations: number[],
  baseVideoTrack: InputVideoTrack,
  painter: Awaited<ReturnType<typeof createOverlayFramePainter>>,
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: OffscreenCanvas,
  support: BrowserCompositeSupport,
  codecString: string,
  signal: AbortSignal | undefined,
  onFrame: () => void,
): Promise<EncodedPacket[]> {
  const expectedFrames = region.endFrame - region.startFrame;
  const packets: EncodedPacket[] = [];
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      packets.push(EncodedPacket.fromEncodedChunk(chunk));
    },
    error: (error) => {
      encodeError = error;
    },
  });
  encoder.configure({
    codec: codecString,
    width: support.width,
    height: support.height,
    bitrate: BROWSER_COMPOSITE_VIDEO_BPS,
    framerate: support.averageFps,
    // BUG FIX: VP9 quality-mode alt-ref reordering
    // Fix: VP9 uses realtime so decode-order PTS stays strictly increasing
    //      (scanKeyframes / packet-index splice). AVC keeps quality (no B-frames
    //      on our path; already splice-friendly). Offline bake awaits each frame
    //      so realtime "may drop" is not expected under backpressure.
    // Sync: browser-composite.ts CanvasSource latencyMode for VP9
    latencyMode: support.outputCodec === 'vp9' ? 'realtime' : 'quality',
    // Length-prefixed AVC bitstream so mediabunny's MP4 muxer accepts the packets.
    ...(support.outputCodec === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  });

  const sink = new VideoSampleSink(baseVideoTrack);
  let localFrame = 0;
  for await (const sample of sink.samples(baseBounds.startSeconds, baseBounds.endSeconds)) {
    try {
      throwIfAborted(signal);
      if (encodeError) throw encodeError;
      if (localFrame >= expectedFrames) {
        // Base yielded more frames than the baked region — bail (caller → full).
        throw new Error(
          `Splice reencode: base track yielded > ${expectedFrames} frames for region ` +
            `[${region.startFrame},${region.endFrame}).`,
        );
      }
      // Paint at the canonical (baked) global time so the overlay animation phase
      // matches what a full composite would draw.
      const targetTimestamp = targetTimestamps[localFrame];
      sample.draw(ctx, 0, 0);
      painter.paintFrameAt(targetTimestamp);
      ctx.drawImage(painter.canvas, 0, 0);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(targetTimestamp * 1_000_000),
        duration: Math.round(targetDurations[localFrame] * 1_000_000),
      });
      try {
        encoder.encode(frame, { keyFrame: localFrame === 0 });
      } finally {
        frame.close();
      }
    } finally {
      sample.close();
    }
    localFrame += 1;
    onFrame();
    if (localFrame % YIELD_EVERY === 0) await yieldToEventLoop();
  }

  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;

  if (localFrame !== expectedFrames) {
    throw new Error(
      `Splice reencode composited ${localFrame} base frames for region ` +
        `[${region.startFrame},${region.endFrame}) — expected ${expectedFrames}.`,
    );
  }
  if (packets.length !== localFrame) {
    throw new Error(
      `Splice reencode emitted ${packets.length} packets for ${localFrame} frames.`,
    );
  }
  if (packets[0].type !== 'key') {
    throw new Error('Splice reencode did not start the region with a keyframe.');
  }
  return packets;
}

/**
 * Run the partial re-bake splice. Returns the validated spliced MP4, null for an
 * honest fallback to the full composite (path not splice-friendly / plan chose
 * full), or throws — AbortError for deliberate cancels, plain Error otherwise.
 */
export async function renderCompositeSplice(
  options: CompositeSpliceOptions,
): Promise<Blob | null> {
  const startedAt = performance.now();
  throwIfAborted(options.signal);
  const report = (ratio: number, stage: PartialSpliceStage): void => {
    options.onProgress?.(ratio, stage);
  };
  report(0, PARTIAL_SPLICE_STAGES.scan);

  const input = new Input({ source: new BlobSource(options.bakedMp4), formats: ALL_FORMATS });
  const baseInput = new Input({ source: new BlobSource(options.baseMp4), formats: ALL_FORMATS });
  let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
  let painter: Awaited<ReturnType<typeof createOverlayFramePainter>> | null = null;

  try {
    const support = await probeBrowserCompositeSupport(input);
    if (!support) return null;
    throwIfAborted(options.signal);

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;
    const audioTrack = await input.getPrimaryAudioTrack();
    const decoderConfig = await videoTrack.getDecoderConfig();
    if (!decoderConfig?.codec) return null; // no codec string → cannot re-encode compatibly
    const baseDurationSeconds = await videoTrack.computeDuration();

    // Dirty regions re-composite from the CLEAN base — it must exist and decode.
    const baseVideoTrack = await baseInput.getPrimaryVideoTrack();
    if (!baseVideoTrack || !(await baseVideoTrack.canDecode())) {
      console.warn(`${EXTENSION_LOG_PREFIX} Composite splice: clean base not decodable — full composite.`);
      return null;
    }

    // ---- scan ----
    const scanStartedAt = performance.now();
    const scan = await scanVideoPackets(videoTrack);
    if (!scan) {
      // Detail already logged in scanVideoPackets (diagnoseKeyframeScanFailure).
      console.warn(
        `${EXTENSION_LOG_PREFIX} Composite splice: artifact not splice-friendly — full composite.`,
      );
      return null;
    }
    const { packets: videoPackets, keyframeFrames, frameCount } = scan;
    const scanMs = Math.round(performance.now() - scanStartedAt);

    // ---- plan ----
    const spliceSpans = options.spans.map((span) => {
      const startFrame = windowStartFrame(span.startSeconds, videoPackets, frameCount);
      const endFrame = windowEndFrame(span.endSeconds, videoPackets, frameCount);
      return { startFrame, frameCount: Math.max(0, endFrame - startFrame) };
    });
    const plan = planSplice({ spans: spliceSpans, keyframeFrames, frameCount });
    if (plan.strategy !== 'partial') {
      console.log(
        `${EXTENSION_LOG_PREFIX} Composite splice: plan chose full (${plan.reason}).`,
      );
      return null;
    }
    const validation = validateSplicePlan(plan.regions, frameCount, keyframeFrames);
    if (validation) {
      console.warn(`${EXTENSION_LOG_PREFIX} Composite splice: plan invalid — ${validation}`);
      return null;
    }
    report(computeSpliceProgress(PARTIAL_SPLICE_STAGES.scan, 1), PARTIAL_SPLICE_STAGES.scan);

    // ---- reencode (repaint dirty GOPs with the new cues) ----
    const cues = normalizeOverlaySegments(options.segments, options.durationSeconds);
    if (cues.length === 0) throw new Error('No usable subtitle cues for composite splice.');
    painter = await createOverlayFramePainter({
      cues,
      style: options.style,
      globalDurationSeconds: options.durationSeconds,
      width: support.width,
      height: support.height,
      background: 'transparent',
      themeBarColor: options.themeBarColor,
    });
    const { canvas, ctx } = createSpliceCanvas(support.width, support.height);

    const reencodeStartedAt = performance.now();
    const reencodedByRegionStart = new Map<number, EncodedPacket[]>();
    let framesReencoded = 0;
    for (const region of plan.regions) {
      if (region.kind !== 'reencode') continue;
      // Base decode range + the baked PTS/durations to stamp onto the re-encoded
      // frames (base shares the 1:1 grid, so its frames in this range match).
      const bounds = regionBoundsSeconds(region, videoPackets, frameCount);
      const targetTimestamps: number[] = [];
      const targetDurations: number[] = [];
      for (let i = region.startFrame; i < region.endFrame; i += 1) {
        targetTimestamps.push(videoPackets[i].timestamp);
        targetDurations.push(videoPackets[i].duration);
      }
      const regionPackets = await encodeRegion(
        region,
        bounds,
        targetTimestamps,
        targetDurations,
        baseVideoTrack,
        painter,
        ctx,
        canvas,
        support,
        decoderConfig.codec,
        options.signal,
        () => {
          framesReencoded += 1;
          report(
            computeSpliceProgress(
              PARTIAL_SPLICE_STAGES.reencode,
              computeSpliceReencodeRatio(framesReencoded, plan.reencodeFrameCount),
            ),
            PARTIAL_SPLICE_STAGES.reencode,
          );
        },
      );
      reencodedByRegionStart.set(region.startFrame, regionPackets);
    }
    const reencodeMs = Math.round(performance.now() - reencodeStartedAt);

    // ---- assemble (kept packets bit-exact + re-encoded packets, decode order) ----
    const assembleStartedAt = performance.now();
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const videoSource = new EncodedVideoPacketSource(support.outputCodec);
    output.addVideoTrack(videoSource, { frameRate: support.averageFps });
    const audio = await setupAudioPassthrough(audioTrack, output);
    await output.start();

    let outputVideoPackets = 0;
    let keptPackets = 0;
    let reencodedPackets = 0;
    let firstVideoAdd = true;
    let lastVideoEndSeconds = 0;

    const addVideoPacket = async (packet: EncodedPacket): Promise<void> => {
      // Anchor the track's sample description to the ORIGINAL config so the
      // (majority) kept packets are described correctly; re-encoded GOPs rely on
      // codec-string compatibility + the decode-back gate (see header hazard).
      await videoSource.add(packet, firstVideoAdd ? { decoderConfig } : undefined);
      firstVideoAdd = false;
      outputVideoPackets += 1;
      lastVideoEndSeconds = packet.timestamp + packet.duration;
      report(
        computeSpliceProgress(
          PARTIAL_SPLICE_STAGES.assemble,
          computeSpliceAssembleRatio(outputVideoPackets, frameCount),
        ),
        PARTIAL_SPLICE_STAGES.assemble,
      );
      await audio?.drainUpTo(lastVideoEndSeconds + AUDIO_INTERLEAVE_WINDOW_SECONDS);
      if (outputVideoPackets % YIELD_EVERY === 0) await yieldToEventLoop();
    };

    for (const region of plan.regions) {
      throwIfAborted(options.signal);
      if (region.kind === 'keep') {
        for (let i = region.startFrame; i < region.endFrame; i += 1) {
          await addVideoPacket(videoPackets[i]);
          keptPackets += 1;
        }
      } else {
        const regionPackets = reencodedByRegionStart.get(region.startFrame) ?? [];
        for (const packet of regionPackets) {
          await addVideoPacket(packet);
          reencodedPackets += 1;
        }
      }
    }
    videoSource.close();
    await audio?.drainAll();
    const assembleMs = Math.round(performance.now() - assembleStartedAt);

    throwIfAborted(options.signal);
    const finalizeStartedAt = performance.now();
    await output.finalize();
    const finalizeMs = Math.round(performance.now() - finalizeStartedAt);

    const failure = validateSpliceOutput({
      keptPackets,
      reencodedPackets,
      outputVideoPackets,
      expectedVideoPackets: frameCount,
      outputDurationSeconds: lastVideoEndSeconds,
      baseDurationSeconds,
      fps: support.averageFps,
    });
    if (failure) throw new Error(`Composite splice output rejected: ${failure}`);

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength < 256) {
      throw new Error('Composite splice produced an empty MP4 buffer.');
    }
    const splicedBlob = new Blob([buffer], { type: 'video/mp4' });

    // ---- fidelity gate (the load-bearing avcC-hazard check, §header) ----
    // Kept-region frames were copied byte-exact, so they MUST decode
    // pixel-identical to the original under the spliced track's sample
    // description; boundary frames must at least decode. A miss means the
    // splice corrupted the stream → throw so the caller runs the full composite.
    throwIfAborted(options.signal);
    const fidelity = await verifySpliceKeptFrames(
      splicedBlob,
      options.bakedMp4,
      selectSpliceFidelityAnchors(
        plan.regions,
        videoPackets.map((packet) => packet.timestamp),
      ),
    );
    if (!fidelity.ok) {
      throw new Error(`Composite splice fidelity gate rejected the output: ${fidelity.reason}`);
    }

    const totalMs = Math.round(performance.now() - startedAt);
    const timing: CompositeSpliceTiming = {
      outputCodec: support.outputCodec,
      frameCount,
      reencodeFrameCount: plan.reencodeFrameCount,
      keepFrameCount: plan.keepFrameCount,
      reencodeRegionCount: plan.reencodeRegionCount,
      scanMs,
      reencodeMs,
      assembleMs,
      finalizeMs,
      totalMs,
      outputBytes: buffer.byteLength,
    };
    options.onTiming?.(timing);
    console.log(
      `${EXTENSION_LOG_PREFIX} Composite splice: re-encoded ${plan.reencodeFrameCount}/${frameCount} ` +
        `frames in ${plan.reencodeRegionCount} region(s), kept ${keptPackets} packets ` +
        `(scan ${scanMs}ms, reencode ${reencodeMs}ms, assemble ${assembleMs}ms, ` +
        `fidelity ${fidelity.checkedKeep} kept/${fidelity.checkedBoundary} boundary ok ` +
        `[worst mean Δ${fidelity.worstMeanAbsDiff.toFixed(2)}], ` +
        `${support.outputCodec}, ${Math.round(buffer.byteLength / 1024)} KiB).`,
    );

    report(1, PARTIAL_SPLICE_STAGES.assemble);
    return splicedBlob;
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
    painter?.dispose();
    input.dispose();
    baseInput.dispose();
  }
}

// ---------------------------------------------------------------------------
// Map a dirty span's SECONDS onto the artifact's real keyframe frame indices
// using the buffered packet timestamps (fps-independent, exact). These widen a
// dirty window to whole packets before planSplice does its GOP alignment; the
// planner then snaps to enclosing keyframes, so slight fuzz here is absorbed.
// ---------------------------------------------------------------------------

function windowStartFrame(
  startSeconds: number,
  packets: readonly EncodedPacket[],
  frameCount: number,
): number {
  // First frame whose end is past the window start (floor to the frame the
  // window opens inside). Linear scan — frame counts are ≤ a few thousand.
  for (let i = 0; i < frameCount; i += 1) {
    if (packets[i].timestamp + packets[i].duration > startSeconds) return i;
  }
  return frameCount - 1;
}

function windowEndFrame(
  endSeconds: number,
  packets: readonly EncodedPacket[],
  frameCount: number,
): number {
  // One past the last frame whose start is before the window end (ceil).
  for (let i = frameCount - 1; i >= 0; i -= 1) {
    if (packets[i].timestamp < endSeconds) return i + 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Audio passthrough (unchanged track) — same discipline as browser-composite.ts
// ---------------------------------------------------------------------------

interface AudioPassthrough {
  drainUpTo(upToSeconds: number): Promise<void>;
  drainAll(): Promise<void>;
}

async function setupAudioPassthrough(
  audioTrack: InputAudioTrack | null,
  output: Output,
): Promise<AudioPassthrough | null> {
  if (!audioTrack) return null;
  const codec = await audioTrack.getCodec();
  if (!codec) throw new Error('Baked MP4 audio codec unrecognized — cannot passthrough.');
  const decoderConfig = await audioTrack.getDecoderConfig();
  if (!decoderConfig) throw new Error('Baked MP4 audio decoder config unavailable.');
  const source = new EncodedAudioPacketSource(codec);
  output.addAudioTrack(source);

  const packets = new EncodedPacketSink(audioTrack).packets();
  let pending: EncodedPacket | null = null;
  let first = true;
  let done = false;
  let offset: number | null = null;

  const prepare = (packet: EncodedPacket): EncodedPacket | null => {
    if (offset === null) offset = computeAudioPassthroughOffset(packet.timestamp);
    const rebased = rebaseAudioPassthroughTimestamp(packet.timestamp, offset);
    if (shouldSkipAudioPassthroughPacket(rebased, packet.duration)) return null;
    return rebased === packet.timestamp ? packet : packet.clone({ timestamp: rebased });
  };
  const mux = async (packet: EncodedPacket): Promise<void> => {
    const ready = prepare(packet);
    if (!ready) return;
    await source.add(ready, first ? { decoderConfig } : undefined);
    first = false;
  };
  const pull = async (): Promise<EncodedPacket | null> => {
    const next = await packets.next();
    if (next.done) {
      done = true;
      return null;
    }
    return next.value;
  };

  return {
    async drainUpTo(upToSeconds: number): Promise<void> {
      while (!done) {
        if (!pending) pending = await pull();
        if (!pending) return;
        if (pending.timestamp > upToSeconds) return;
        const packet = pending;
        pending = null;
        await mux(packet);
      }
    },
    async drainAll(): Promise<void> {
      if (pending) {
        const packet = pending;
        pending = null;
        await mux(packet);
      }
      while (!done) {
        const packet = await pull();
        if (packet) await mux(packet);
      }
      source.close();
    },
  };
}
