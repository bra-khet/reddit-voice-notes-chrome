/**
 * Relay-boundary validation, shared by every host that accepts a `*_START`
 * request and re-dispatches it as `*_OFFSCREEN`.
 *
 * Extracted from entrypoints/background.ts (v6.0 Track D Phase 1) so the hosted
 * Design Studio's in-page relay enforces the SAME payload contract rather than a
 * lookalike. These checks are the reason a truncated base64 payload fails at the
 * relay with a precise byte/char count instead of surfacing as an inscrutable
 * FFmpeg error three layers down; a second host with a weaker copy would lose
 * that diagnosis exactly where it is hardest to recover.
 *
 * Pure by construction: no `browser.*`, no DOM, no I/O. Host-neutral (F3).
 */

import { expectedBase64CharLength } from '@/src/messaging/binary-verify';
import type {
  BurnInStartRequest,
  TranscodeStartRequest,
  TranscribeStartRequest,
} from '@/src/messaging/types';

/** Tolerance for base64 padding differences between encoders. */
const BASE64_CHAR_SLACK = 4;

/**
 * True for messages already addressed to the offscreen worker.
 *
 * A relay must ignore these or it will re-relay its own dispatch. In the
 * extension that is a loop across contexts; in the single-context web host it is
 * an immediate infinite recursion.
 */
export function isOffscreenTarget(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'target' in message &&
    (message as { target: string }).target === 'offscreen'
  );
}

/*
 * `relay` varies per family ('relay' | 'burn-in relay' | 'transcribe relay') and
 * is NOT cosmetic: these strings surface verbatim in user-visible failure text
 * and in the QA checklists, and they are how an operator tells which of the
 * three families rejected a payload. Extraction preserved them exactly.
 */
function assertBase64Length(
  byteLength: number,
  chars: number,
  payload: string,
  relay: string,
): void {
  const expectedChars = expectedBase64CharLength(byteLength);
  if (Math.abs(chars - expectedChars) > BASE64_CHAR_SLACK) {
    throw new Error(
      `${payload} base64 length mismatch at ${relay} (bytes=${byteLength}, chars=${chars}, expected≈${expectedChars}).`,
    );
  }
}

export function validateTranscodeStartRequest(request: TranscodeStartRequest): void {
  if (!request.jobId) {
    throw new Error('Transcode request missing jobId.');
  }
  if (!request.webmBase64 || request.webmByteLength <= 0) {
    throw new Error(`WebM payload missing at background relay (bytes=${request.webmByteLength}).`);
  }
  assertBase64Length(request.webmByteLength, request.webmBase64.length, 'WebM', 'relay');
}

export function validateBurnInStartRequest(request: BurnInStartRequest): void {
  if (!request.jobId) {
    throw new Error('Burn-in request missing jobId.');
  }
  if (!request.mp4Base64 || request.mp4ByteLength <= 0) {
    throw new Error(`MP4 payload missing at burn-in relay (bytes=${request.mp4ByteLength}).`);
  }
  if (!request.segmentsJson?.trim()) {
    throw new Error('Subtitle segments JSON missing at burn-in relay.');
  }
  if (!request.styleJson?.trim()) {
    throw new Error('Subtitle style JSON missing at burn-in relay.');
  }
  assertBase64Length(request.mp4ByteLength, request.mp4Base64.length, 'MP4', 'burn-in relay');
}

export function validateTranscribeStartRequest(request: TranscribeStartRequest): void {
  if (!request.jobId) {
    throw new Error('Transcribe request missing jobId.');
  }
  if (!request.webmBase64 || request.webmByteLength <= 0) {
    throw new Error(`WebM payload missing at transcribe relay (bytes=${request.webmByteLength}).`);
  }
  assertBase64Length(request.webmByteLength, request.webmBase64.length, 'WebM', 'transcribe relay');
}
