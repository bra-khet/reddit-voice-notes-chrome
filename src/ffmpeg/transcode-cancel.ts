import { disposeFfmpeg } from '@/src/ffmpeg/ffmpeg-runner';

/** Offscreen-only registry — cancelled jobs are skipped or interrupted. */
const cancelledJobs = new Set<string>();
let runningJobId: string | null = null;

export function markTranscodeCancelled(jobId: string): void {
  cancelledJobs.add(jobId);
  if (runningJobId === jobId) {
    disposeFfmpeg();
  }
}

export function isTranscodeCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

export function setRunningTranscodeJob(jobId: string | null): void {
  runningJobId = jobId;
}

export function clearTranscodeCancelled(jobId: string): void {
  cancelledJobs.delete(jobId);
}

export function assertTranscodeNotCancelled(jobId: string): void {
  if (!isTranscodeCancelled(jobId)) return;
  throw new DOMException('Transcode cancelled.', 'AbortError');
}