/**
 * Serializes Vosk transcription jobs — separate from FFmpeg transcode queue (eloquent-0 decision).
 * Vosk ships its own Web Worker; this queue prevents overlapping inference sessions in one document.
 */

const JOB_SETTLE_MS = 200;

let chain: Promise<void> = Promise.resolve();

function settleGap(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, JOB_SETTLE_MS);
  });
}

export function enqueueTranscribeJob<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(() => job()).finally(() => settleGap());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}