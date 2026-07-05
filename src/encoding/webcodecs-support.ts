/**
 * v5.3.10 — WebCodecs capability detection + alpha-luma calibration probe.
 *
 * Two jobs, one probe:
 *
 * 1. CAPABILITY: VideoEncoder.isConfigSupported answers "does the config
 *    parse", not "will a real encode work on this machine". The probe encodes
 *    two real frames and decodes them back, so a passing probe is a proven
 *    end-to-end round trip — the auto-gate for the whole WebCodecs bake path.
 *
 * 2. CALIBRATION: the overlay alpha channel travels as gray luminance in its
 *    own VP8/VP9 stream. Chrome's canvas→encoder conversion typically produces
 *    limited-range luma (white→~235, black→~16); if the composite treated that
 *    as full range, "fully opaque" text would blend at 235/255 ≈ 92% opacity —
 *    a subtle, global translucency regression. Rather than trust codec
 *    metadata (VP8 barely carries any), the probe encodes a white frame and a
 *    black frame, decodes them, and reads the actual luma bytes back. The
 *    measured mapping decides whether the composite filter graph inserts the
 *    limited→full expansion (overlay-alphamerge-args.ts).
 *
 * Results are cached per codec+dimensions+fps — one ~100 ms probe per session,
 * then free. Any probe failure returns null: the caller falls back to the
 * MediaRecorder pipeline, never a maybe-broken WebCodecs one.
 *
 * Sync: overlay-webcodecs-encoder.ts (consumes the chosen config),
 *       overlay-alphamerge-args.ts (consumes calibration.limitedRange),
 *       subtitle-overlay-webcodecs.ts (gate)
 */

import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import type { IvfFourcc } from '@/src/encoding/ivf';

/** Whole-probe ceiling — a hung encoder must not stall the bake's gate. */
const PROBE_TIMEOUT_MS = 5_000;

/** Measured luma above this is treated as full-range white. */
const FULL_RANGE_WHITE_THRESHOLD = 245;

export interface OverlayWebCodecsCodecCandidate {
  /** WebCodecs codec string. */
  codec: string;
  ivfFourcc: IvfFourcc;
  colorBitsPerSecond: number;
  alphaBitsPerSecond: number;
}

/**
 * VP8 first, deliberately: it is the same encoder family MediaRecorder uses
 * for this overlay today (identical quality character at the same bitrate),
 * the cheapest decode for the single-threaded FFmpeg wasm composite, and the
 * most uniformly supported VideoEncoder codec. VP9 is the quality/size
 * alternative; AV1 is rejected for this phase (encode speed + support
 * variance). Color bitrate matches the MediaRecorder path's
 * OVERLAY_VIDEO_BPS; the alpha stream is smooth grayscale and needs less.
 */
export const OVERLAY_WEBCODECS_CODEC_CANDIDATES: readonly OverlayWebCodecsCodecCandidate[] = [
  { codec: 'vp8', ivfFourcc: 'VP80', colorBitsPerSecond: 1_500_000, alphaBitsPerSecond: 1_000_000 },
  { codec: 'vp09.00.10.08', ivfFourcc: 'VP90', colorBitsPerSecond: 1_200_000, alphaBitsPerSecond: 800_000 },
];

export interface AlphaLumaCalibration {
  /** Decoded luma of an encoded solid-white frame (255 full / ~235 limited). */
  lumaWhite: number;
  /** Decoded luma of an encoded solid-black frame (0 full / ~16 limited). */
  lumaBlack: number;
  /** True when the composite must expand alpha luma to full range. */
  limitedRange: boolean;
}

export interface OverlayWebCodecsSupport {
  candidate: OverlayWebCodecsCodecCandidate;
  calibration: AlphaLumaCalibration;
}

export interface ProbeOverlayWebCodecsInput {
  width: number;
  height: number;
  fps: number;
}

export function buildOverlayEncoderConfig(
  candidate: OverlayWebCodecsCodecCandidate,
  input: ProbeOverlayWebCodecsInput,
  stream: 'color' | 'alpha',
): VideoEncoderConfig {
  return {
    codec: candidate.codec,
    width: input.width,
    height: input.height,
    framerate: input.fps,
    bitrate: stream === 'color' ? candidate.colorBitsPerSecond : candidate.alphaBitsPerSecond,
    latencyMode: 'realtime',
  };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function fillSolidFrameCanvas(width: number, height: number, cssColor: string): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Calibration canvas 2D context unavailable.');
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

async function encodeCalibrationFrames(
  config: VideoEncoderConfig,
  input: ProbeOverlayWebCodecsInput,
): Promise<EncodedVideoChunk[]> {
  const chunks: EncodedVideoChunk[] = [];
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: (error) => {
      encodeError = error;
    },
  });
  try {
    encoder.configure(config);
    const usPerFrame = Math.round(1_000_000 / input.fps);
    const colors = ['#ffffff', '#000000'];
    for (let i = 0; i < colors.length; i += 1) {
      const frame = new VideoFrame(fillSolidFrameCanvas(input.width, input.height, colors[i]), {
        timestamp: i * usPerFrame,
        duration: usPerFrame,
        alpha: 'discard',
      });
      // Both keyframes: each must decode independently for luma readback.
      encoder.encode(frame, { keyFrame: true });
      frame.close();
    }
    await encoder.flush();
  } finally {
    try {
      encoder.close();
    } catch {
      // Already closed by an encoder error.
    }
  }
  if (encodeError) throw encodeError;
  if (chunks.length !== 2) {
    throw new Error(`Calibration encode produced ${chunks.length} chunks (expected 2).`);
  }
  return chunks;
}

async function decodeCalibrationLuma(
  codec: string,
  chunks: EncodedVideoChunk[],
): Promise<{ lumaWhite: number; lumaBlack: number }> {
  const frames: VideoFrame[] = [];
  let decodeError: unknown = null;
  const decoder = new VideoDecoder({
    output: (frame) => frames.push(frame),
    error: (error) => {
      decodeError = error;
    },
  });
  try {
    decoder.configure({ codec });
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();

    if (decodeError) throw decodeError;
    if (frames.length !== 2) {
      throw new Error(`Calibration decode produced ${frames.length} frames (expected 2).`);
    }
    // Decode order matches submission order (VP8/VP9, no reordering) — but
    // sort by timestamp anyway so the white/black assignment cannot flip.
    frames.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    const lumas: number[] = [];
    for (const frame of frames) {
      const size = frame.allocationSize();
      const buffer = new Uint8Array(size);
      const layout = await frame.copyTo(buffer);
      // Plane 0 is luma for every YUV pixel format VideoDecoder emits here.
      lumas.push(buffer[layout[0].offset]);
    }
    return { lumaWhite: lumas[0], lumaBlack: lumas[1] };
  } finally {
    for (const frame of frames) frame.close();
    try {
      decoder.close();
    } catch {
      // Already closed by a decoder error.
    }
  }
}

async function probeCandidate(
  candidate: OverlayWebCodecsCodecCandidate,
  input: ProbeOverlayWebCodecsInput,
): Promise<OverlayWebCodecsSupport | null> {
  const colorSupport = await VideoEncoder.isConfigSupported(
    buildOverlayEncoderConfig(candidate, input, 'color'),
  );
  if (colorSupport.supported !== true) return null;

  const chunks = await encodeCalibrationFrames(
    buildOverlayEncoderConfig(candidate, input, 'alpha'),
    input,
  );
  const { lumaWhite, lumaBlack } = await decodeCalibrationLuma(candidate.codec, chunks);

  // Sanity floor: a white frame must decode meaningfully brighter than a black
  // one, or the round trip is untrustworthy no matter what it "supports".
  if (lumaWhite - lumaBlack < 128) {
    throw new Error(
      `Calibration luma spread implausible (white=${lumaWhite}, black=${lumaBlack}).`,
    );
  }

  return {
    candidate,
    calibration: {
      lumaWhite,
      lumaBlack,
      limitedRange: lumaWhite < FULL_RANGE_WHITE_THRESHOLD,
    },
  };
}

const supportCache = new Map<string, Promise<OverlayWebCodecsSupport | null>>();

/**
 * Probe (cached) for a usable WebCodecs overlay encode config at the given
 * dimensions. Resolves null when WebCodecs is unavailable, no candidate codec
 * passes a real encode→decode round trip, or the probe times out.
 */
export function probeOverlayWebCodecsSupport(
  input: ProbeOverlayWebCodecsInput,
): Promise<OverlayWebCodecsSupport | null> {
  const key = `${input.width}x${input.height}@${input.fps}`;
  const cached = supportCache.get(key);
  if (cached) return cached;

  const probe = (async (): Promise<OverlayWebCodecsSupport | null> => {
    if (
      typeof VideoEncoder === 'undefined' ||
      typeof VideoDecoder === 'undefined' ||
      typeof VideoFrame === 'undefined' ||
      typeof OffscreenCanvas === 'undefined'
    ) {
      return null;
    }
    for (const candidate of OVERLAY_WEBCODECS_CODEC_CANDIDATES) {
      try {
        const support = await withTimeout(
          probeCandidate(candidate, input),
          PROBE_TIMEOUT_MS,
          `WebCodecs probe (${candidate.codec})`,
        );
        if (support) {
          console.log(
            `${EXTENSION_LOG_PREFIX} WebCodecs overlay support: ${candidate.codec} ` +
              `(alpha luma white=${support.calibration.lumaWhite}, ` +
              `black=${support.calibration.lumaBlack}, ` +
              `${support.calibration.limitedRange ? 'limited' : 'full'} range)`,
          );
          return support;
        }
      } catch (error: unknown) {
        console.warn(
          `${EXTENSION_LOG_PREFIX} WebCodecs probe failed for ${candidate.codec}`,
          error,
        );
      }
    }
    return null;
  })();

  supportCache.set(key, probe);
  return probe;
}
