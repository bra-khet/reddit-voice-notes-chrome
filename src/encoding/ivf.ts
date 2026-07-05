/**
 * v5.3.10 — Minimal IVF container muxer/parser (pure bytes, no DOM, no FFmpeg).
 *
 * WHY IVF: WebCodecs VideoEncoder emits raw VP8/VP9 bitstream chunks with no
 * container. FFmpeg's IVF demuxer ingests them natively, and the format is
 * trivial enough (32-byte header + 12-byte per-frame headers) that muxing AND
 * segment concatenation happen in pure TypeScript — the v5.3.10 stitch step
 * costs microseconds and never touches FFmpeg, compared to the v5.3.9
 * MediaRecorder path where even the fast stream-copy stitch is an FFmpeg exec.
 *
 * PTS convention: timebase is 1/fps (scale=1, rate=fps), so PTS values are
 * global frame indices — exact integers, no rounding, no drift. Chunk encoders
 * write global PTS directly (startFrame + i), which makes concatenation a pure
 * append with continuity validation rather than a timestamp-rebasing pass.
 *
 * Layout reference (all little-endian):
 *   header: 0 'DKIF' | 4 u16 version=0 | 6 u16 headerSize=32 | 8 fourcc
 *           | 12 u16 width | 14 u16 height | 16 u32 timebaseRate(den)
 *           | 20 u32 timebaseScale(num) | 24 u32 frameCount | 28 u32 unused
 *   frame:  u32 payloadSize | u64 pts | payload
 *
 * Sync: overlay-webcodecs-encoder.ts (producer), subtitle-overlay-webcodecs.ts
 *       (concat), overlay-alphamerge-args.ts (FFmpeg-side consumption),
 *       scripts/test-ivf.mjs
 */

export const IVF_HEADER_BYTES = 32;
export const IVF_FRAME_HEADER_BYTES = 12;

export type IvfFourcc = 'VP80' | 'VP90';

export interface IvfFrame {
  /** Raw encoded bitstream payload (one EncodedVideoChunk's bytes). */
  data: Uint8Array;
  /** PTS in timebase units — global frame index under the 1/fps convention. */
  ptsFrames: number;
}

export interface IvfStreamParams {
  fourcc: IvfFourcc;
  width: number;
  height: number;
  /** Timebase denominator — fps under the 1/fps convention. */
  timebaseRate: number;
  /** Timebase numerator — 1 under the 1/fps convention. */
  timebaseScale: number;
}

export interface ParsedIvf extends IvfStreamParams {
  frameCount: number;
  frames: IvfFrame[];
}

function writeFourcc(view: DataView, offset: number, fourcc: string): void {
  for (let i = 0; i < 4; i += 1) {
    view.setUint8(offset + i, fourcc.charCodeAt(i));
  }
}

function readFourcc(view: DataView, offset: number): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

/** Serialize frames into a complete IVF byte stream. */
export function buildIvf(params: IvfStreamParams, frames: IvfFrame[]): Uint8Array {
  let payloadBytes = 0;
  for (const frame of frames) {
    payloadBytes += IVF_FRAME_HEADER_BYTES + frame.data.byteLength;
  }

  const out = new Uint8Array(IVF_HEADER_BYTES + payloadBytes);
  const view = new DataView(out.buffer);

  writeFourcc(view, 0, 'DKIF');
  view.setUint16(4, 0, true);
  view.setUint16(6, IVF_HEADER_BYTES, true);
  writeFourcc(view, 8, params.fourcc);
  view.setUint16(12, params.width, true);
  view.setUint16(14, params.height, true);
  view.setUint32(16, params.timebaseRate, true);
  view.setUint32(20, params.timebaseScale, true);
  view.setUint32(24, frames.length, true);
  view.setUint32(28, 0, true);

  let offset = IVF_HEADER_BYTES;
  for (const frame of frames) {
    view.setUint32(offset, frame.data.byteLength, true);
    // PTS is u64; frame indices stay far below 2^32, so the high word is 0.
    view.setUint32(offset + 4, frame.ptsFrames >>> 0, true);
    view.setUint32(offset + 8, 0, true);
    out.set(frame.data, offset + IVF_FRAME_HEADER_BYTES);
    offset += IVF_FRAME_HEADER_BYTES + frame.data.byteLength;
  }

  return out;
}

/** Parse an IVF byte stream (validation + tests + concat input). */
export function parseIvf(bytes: Uint8Array): ParsedIvf {
  if (bytes.byteLength < IVF_HEADER_BYTES) {
    throw new Error('IVF stream shorter than its 32-byte header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readFourcc(view, 0) !== 'DKIF') {
    throw new Error('IVF stream missing DKIF signature.');
  }
  const headerSize = view.getUint16(6, true);
  if (headerSize !== IVF_HEADER_BYTES) {
    throw new Error(`Unsupported IVF header size ${headerSize}.`);
  }
  const fourcc = readFourcc(view, 8);
  if (fourcc !== 'VP80' && fourcc !== 'VP90') {
    throw new Error(`Unsupported IVF fourcc '${fourcc}'.`);
  }

  const declaredFrameCount = view.getUint32(24, true);
  const frames: IvfFrame[] = [];
  let offset = IVF_HEADER_BYTES;
  while (offset + IVF_FRAME_HEADER_BYTES <= bytes.byteLength) {
    const size = view.getUint32(offset, true);
    const ptsLo = view.getUint32(offset + 4, true);
    const ptsHi = view.getUint32(offset + 8, true);
    const payloadStart = offset + IVF_FRAME_HEADER_BYTES;
    if (payloadStart + size > bytes.byteLength) {
      throw new Error('IVF frame payload extends past end of stream.');
    }
    frames.push({
      data: bytes.subarray(payloadStart, payloadStart + size),
      ptsFrames: ptsHi * 0x1_0000_0000 + ptsLo,
    });
    offset = payloadStart + size;
  }
  if (offset !== bytes.byteLength) {
    throw new Error('IVF stream has trailing bytes after the last frame.');
  }
  if (frames.length !== declaredFrameCount) {
    throw new Error(
      `IVF frame count mismatch: header declares ${declaredFrameCount}, found ${frames.length}.`,
    );
  }

  return {
    fourcc,
    width: view.getUint16(12, true),
    height: view.getUint16(14, true),
    timebaseRate: view.getUint32(16, true),
    timebaseScale: view.getUint32(20, true),
    frameCount: frames.length,
    frames,
  };
}

/**
 * Concatenate per-segment IVF streams into one stream. Segments must share
 * stream params, and PTS must be strictly increasing across the whole
 * concatenation — under the global-PTS convention that means the segments are
 * already in timeline order with no overlap and no gap-tolerant lying: any
 * violation indicates an encoder bug, so this throws rather than "fixing" it
 * (the caller's fallback is the MediaRecorder path, never a silently broken
 * timeline).
 */
export function concatIvfSegments(segments: Uint8Array[]): Uint8Array {
  if (segments.length === 0) {
    throw new Error('IVF concat requires at least one segment.');
  }

  const parsed = segments.map(parseIvf);
  const head = parsed[0];
  const frames: IvfFrame[] = [];
  let lastPts = -1;

  for (const segment of parsed) {
    if (
      segment.fourcc !== head.fourcc ||
      segment.width !== head.width ||
      segment.height !== head.height ||
      segment.timebaseRate !== head.timebaseRate ||
      segment.timebaseScale !== head.timebaseScale
    ) {
      throw new Error('IVF concat segments disagree on stream parameters.');
    }
    for (const frame of segment.frames) {
      if (frame.ptsFrames <= lastPts) {
        throw new Error(
          `IVF concat PTS not strictly increasing (${frame.ptsFrames} after ${lastPts}).`,
        );
      }
      lastPts = frame.ptsFrames;
      frames.push(frame);
    }
  }

  return buildIvf(
    {
      fourcc: head.fourcc,
      width: head.width,
      height: head.height,
      timebaseRate: head.timebaseRate,
      timebaseScale: head.timebaseScale,
    },
    frames,
  );
}
