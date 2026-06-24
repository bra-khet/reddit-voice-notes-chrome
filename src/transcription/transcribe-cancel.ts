import { disposeVoskSandbox } from './vosk-sandbox-client';

/** Offscreen-only registry — cancelled jobs are skipped before inference starts. */
const cancelledJobs = new Set<string>();
let runningJobId: string | null = null;

export function markTranscribeCancelled(jobId: string): void {
  cancelledJobs.add(jobId);
  if (runningJobId === jobId) {
    void disposeVoskSandbox();
  }
}

export function isTranscribeCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

export function setRunningTranscribeJob(jobId: string | null): void {
  runningJobId = jobId;
}

export function clearTranscribeCancelled(jobId: string): void {
  cancelledJobs.delete(jobId);
}

export function assertTranscribeNotCancelled(jobId: string): void {
  if (!isTranscribeCancelled(jobId)) return;
  throw new DOMException('Transcription cancelled.', 'AbortError');
}