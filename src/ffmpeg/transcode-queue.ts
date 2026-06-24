/**
 * Serializes offscreen FFmpeg jobs — the WASM worker shares one virtual FS and must not run concurrently.
 */

const JOB_SETTLE_MS = 350;

let chain: Promise<void> = Promise.resolve();

function settleGap(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, JOB_SETTLE_MS);
  });
}

export function enqueueTranscodeJob<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(() => job()).finally(() => settleGap());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Resolves when the FFmpeg queue has no in-flight or queued jobs (eloquent-1 memory gate). */
export function whenTranscodeQueueIdle(): Promise<void> {
  return chain;
}