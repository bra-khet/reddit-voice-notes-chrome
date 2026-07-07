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
