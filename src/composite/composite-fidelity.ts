/**
 * v5.5.0 — Fidelity-harness frame extraction (ADR-0003 R9 verification gate).
 *
 * Decodes reference frames from a baked MP4 at the deterministic anchor
 * timestamps produced by selectCompositeFidelityTimestamps
 * (composite-plan.ts). Running this against BOTH composite paths' outputs for
 * the same take yields index-identical frame pairs for side-by-side review of
 * glow tails, dual-border edges, and semi-transparent layers — the ADR-0003
 * "identical planner indices" comparison contract.
 *
 * Browser-only (WebCodecs + mediabunny). The anchor selection itself is pure
 * and Node-tested; this module is the thin extraction layer on top.
 *
 * Sync: composite-plan.ts selectCompositeFidelityTimestamps (anchors),
 *       docs/v5.5.0-browser-composite-migration.md §Fidelity harness
 */

import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import type { SpliceFidelitySelection } from '@/src/editing/splice-plan';

export interface CompositeFidelityFrame {
  /** The anchor timestamp that was requested (seconds). */
  requestedTimestamp: number;
  /** The decoded frame's actual presentation timestamp (seconds). */
  actualTimestamp: number;
  bitmap: ImageBitmap;
}

/**
 * Extract one decoded frame per anchor timestamp. Timestamps must be sorted
 * ascending (selectCompositeFidelityTimestamps output already is) — the sink
 * then decodes each packet at most once. Anchors with no decodable frame are
 * skipped rather than failing the whole extraction.
 *
 * Callers own the returned bitmaps (close() when done).
 */
export async function extractCompositeFidelityFrames(
  mp4: Blob,
  timestamps: number[],
): Promise<CompositeFidelityFrame[]> {
  const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('Fidelity extraction: MP4 has no video track.');
    }
    const sink = new VideoSampleSink(videoTrack);
    const frames: CompositeFidelityFrame[] = [];
    let index = 0;
    for await (const sample of sink.samplesAtTimestamps(timestamps)) {
      const requestedTimestamp = timestamps[index];
      index += 1;
      if (!sample) continue;
      try {
        const canvas = new OffscreenCanvas(sample.codedWidth, sample.codedHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Fidelity extraction canvas 2D context unavailable.');
        sample.draw(ctx, 0, 0);
        frames.push({
          requestedTimestamp,
          actualTimestamp: sample.timestamp,
          bitmap: canvas.transferToImageBitmap(),
        });
      } finally {
        sample.close();
      }
    }
    return frames;
  } finally {
    input.dispose();
  }
}

// ---------------------------------------------------------------------------
// v5.7.0 Phase 2b — splice fidelity gate (the load-bearing avcC-hazard check)
// ---------------------------------------------------------------------------

/** Kept frames were copied byte-exact; benign decoder rounding only. */
const DEFAULT_MAX_MEAN_ABS_DIFF = 1.5;
const DEFAULT_MAX_PEAK_ABS_DIFF = 24;

export interface SpliceFidelityThresholds {
  /** Max mean absolute per-channel difference for a kept frame (0–255). */
  maxMeanAbsDiff?: number;
  /** Max single-channel difference for a kept frame (0–255). */
  maxPeakAbsDiff?: number;
}

export interface SpliceFidelityResult {
  ok: boolean;
  reason?: string;
  /** Kept-region frames compared spliced-vs-original for pixel equality. */
  checkedKeep: number;
  /** Boundary-straddling frames confirmed decodable in the spliced output. */
  checkedBoundary: number;
  /** Worst mean-abs-diff observed on any kept frame (0 = perfect). */
  worstMeanAbsDiff: number;
}

function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Splice fidelity canvas 2D context unavailable.');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/** Mean + peak absolute per-channel difference, or null on a dimension mismatch. */
function pixelDiff(a: ImageData, b: ImageData): { mean: number; peak: number } | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  const pa = a.data;
  const pb = b.data;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < pa.length; i += 1) {
    const d = Math.abs(pa[i] - pb[i]);
    sum += d;
    if (d > peak) peak = d;
  }
  return { mean: sum / pa.length, peak };
}

/**
 * Prove a spliced MP4 did not corrupt any copied packet. Kept-region frames MUST
 * decode pixel-identical between the spliced output and the original artifact
 * (the packets are byte-exact, so a difference means the spliced track's sample
 * description mis-describes them — the avcC hazard). Boundary frames must at
 * least decode. Any failure ⇒ the caller must discard the splice and run the
 * full composite. Never throws for a fidelity miss — returns ok:false with a
 * reason (only a genuinely broken decode pipeline throws).
 */
export async function verifySpliceKeptFrames(
  spliced: Blob,
  original: Blob,
  selection: SpliceFidelitySelection,
  thresholds: SpliceFidelityThresholds = {},
): Promise<SpliceFidelityResult> {
  const maxMean = thresholds.maxMeanAbsDiff ?? DEFAULT_MAX_MEAN_ABS_DIFF;
  const maxPeak = thresholds.maxPeakAbsDiff ?? DEFAULT_MAX_PEAK_ABS_DIFF;

  const splicedFrames = await extractCompositeFidelityFrames(spliced, selection.allAnchors);
  const originalFrames = await extractCompositeFidelityFrames(original, selection.keepAnchors);
  const splicedByTs = new Map(splicedFrames.map((f) => [f.requestedTimestamp, f.bitmap]));
  const originalByTs = new Map(originalFrames.map((f) => [f.requestedTimestamp, f.bitmap]));

  try {
    let checkedBoundary = 0;
    for (const timestamp of selection.boundaryAnchors) {
      if (!splicedByTs.has(timestamp)) {
        return {
          ok: false,
          reason: `boundary frame at ${timestamp.toFixed(3)}s did not decode in the spliced output`,
          checkedKeep: 0,
          checkedBoundary,
          worstMeanAbsDiff: 0,
        };
      }
      checkedBoundary += 1;
    }

    let checkedKeep = 0;
    let worstMeanAbsDiff = 0;
    for (const timestamp of selection.keepAnchors) {
      const splicedBitmap = splicedByTs.get(timestamp);
      const originalBitmap = originalByTs.get(timestamp);
      if (!splicedBitmap || !originalBitmap) {
        return {
          ok: false,
          reason: `kept frame at ${timestamp.toFixed(3)}s did not decode on both sides`,
          checkedKeep,
          checkedBoundary,
          worstMeanAbsDiff,
        };
      }
      const diff = pixelDiff(bitmapToImageData(splicedBitmap), bitmapToImageData(originalBitmap));
      if (!diff) {
        return {
          ok: false,
          reason: `kept frame at ${timestamp.toFixed(3)}s changed dimensions`,
          checkedKeep,
          checkedBoundary,
          worstMeanAbsDiff,
        };
      }
      worstMeanAbsDiff = Math.max(worstMeanAbsDiff, diff.mean);
      if (diff.mean > maxMean || diff.peak > maxPeak) {
        return {
          ok: false,
          reason:
            `kept frame at ${timestamp.toFixed(3)}s differs (mean ${diff.mean.toFixed(2)}, ` +
            `peak ${diff.peak}) — the spliced sample description corrupted a copied packet`,
          checkedKeep,
          checkedBoundary,
          worstMeanAbsDiff,
        };
      }
      checkedKeep += 1;
    }

    return { ok: true, checkedKeep, checkedBoundary, worstMeanAbsDiff };
  } finally {
    for (const frame of splicedFrames) frame.bitmap.close();
    for (const frame of originalFrames) frame.bitmap.close();
    if (splicedFrames.length + originalFrames.length === 0) {
      console.warn(`${EXTENSION_LOG_PREFIX} Splice fidelity gate decoded no frames.`);
    }
  }
}
