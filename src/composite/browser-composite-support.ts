/**
 * v5.5.0 — Browser composite capability probe (ADR-0003 / R11).
 *
 * The existing overlay probe (webcodecs-support.ts) answers "can we ENCODE the
 * overlay streams" — this probe answers the composite path's two extra
 * questions against the REAL base MP4 the bake is about to consume:
 *
 * 1. DECODE: can this browser decode the base track? `track.canDecode()`
 *    checks the actual decoder config (codec string + description bytes from
 *    the demuxed container), then a real first-frame decode round trip proves
 *    the pipeline end-to-end on representative content — isConfigSupported
 *    answers "does the config parse", not "will bytes decode on this machine"
 *    (the same lesson the v5.3.10 probe encodes).
 * 2. ENCODE: which output codec candidate can the browser encode at the
 *    composite dimensions/bitrate (mediabunny canEncodeVideo — a real
 *    isConfigSupported against the resolved WebCodecs config).
 *
 * Any failure resolves null and the caller falls back to the legacy composite
 * (FFmpeg alphamerge) — never a maybe-broken browser path. Results are cached
 * per Input instance only for the duration of one bake; the decode half is
 * content-dependent, so unlike the overlay probe there is no session-level
 * cache keyed on dimensions.
 *
 * Sync: composite-plan.ts (candidates/bitrate), browser-composite.ts (gate),
 *       docs/v5.5.0-browser-composite-migration.md §Phase 0 QA gate
 */

import {
  canEncodeVideo,
  VideoSampleSink,
  type Input,
  type InputVideoTrack,
} from 'mediabunny';
import {
  BROWSER_COMPOSITE_VIDEO_BPS,
  BROWSER_COMPOSITE_VIDEO_CODEC_CANDIDATES,
  type BrowserCompositeVideoCodec,
} from '@/src/composite/composite-plan';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';

/** Whole-probe ceiling — a hung decoder must not stall the bake's gate. */
const PROBE_TIMEOUT_MS = 8_000;

export interface BrowserCompositeSupport {
  /** Chosen output codec (mediabunny id). */
  outputCodec: BrowserCompositeVideoCodec;
  /** Base video dimensions from the demuxed track. */
  width: number;
  height: number;
  /** Frame count + average fps measured from the container (exact packet stats). */
  frameCount: number;
  averageFps: number;
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

async function probeInner(
  videoTrack: InputVideoTrack,
): Promise<BrowserCompositeSupport | null> {
  if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') {
    return null;
  }

  if (!(await videoTrack.canDecode())) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} Browser composite probe: base track not decodable ` +
        `(codec ${await videoTrack.getCodec()}).`,
    );
    return null;
  }

  const width = await videoTrack.getCodedWidth();
  const height = await videoTrack.getCodedHeight();

  // Real first-frame decode round trip on the actual base content (R11).
  const sink = new VideoSampleSink(videoTrack);
  const firstTimestamp = await videoTrack.getFirstTimestamp();
  const firstSample = await sink.getSample(firstTimestamp);
  if (!firstSample) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} Browser composite probe: first-frame decode produced no sample.`,
    );
    return null;
  }
  firstSample.close();

  let outputCodec: BrowserCompositeVideoCodec | null = null;
  for (const candidate of BROWSER_COMPOSITE_VIDEO_CODEC_CANDIDATES) {
    if (await canEncodeVideo(candidate, { width, height, bitrate: BROWSER_COMPOSITE_VIDEO_BPS })) {
      outputCodec = candidate;
      break;
    }
  }
  if (!outputCodec) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} Browser composite probe: no encodable output codec ` +
        `among [${BROWSER_COMPOSITE_VIDEO_CODEC_CANDIDATES.join(', ')}] at ${width}x${height}.`,
    );
    return null;
  }

  const stats = await videoTrack.computePacketStats();
  if (stats.packetCount <= 0) {
    console.warn(`${EXTENSION_LOG_PREFIX} Browser composite probe: base track has no packets.`);
    return null;
  }

  return {
    outputCodec,
    width,
    height,
    frameCount: stats.packetCount,
    averageFps: stats.averagePacketRate,
  };
}

/**
 * Probe the composite path against a demuxed base MP4. Resolves null whenever
 * the path cannot proceed safely; the caller must then use the legacy
 * composite. Never throws (probe errors are downgraded to null + warn — a
 * broken probe must not break the bake).
 */
export async function probeBrowserCompositeSupport(
  input: Input,
): Promise<BrowserCompositeSupport | null> {
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      console.warn(`${EXTENSION_LOG_PREFIX} Browser composite probe: base MP4 has no video track.`);
      return null;
    }
    return await withTimeout(probeInner(videoTrack), PROBE_TIMEOUT_MS, 'Browser composite probe');
  } catch (error: unknown) {
    console.warn(`${EXTENSION_LOG_PREFIX} Browser composite probe failed`, error);
    return null;
  }
}
