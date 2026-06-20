/**
 * Serializes offscreen FFmpeg jobs — the WASM worker shares one virtual FS and must not run concurrently.
 */

let chain: Promise<void> = Promise.resolve();

export function enqueueTranscodeJob<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(() => job());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}