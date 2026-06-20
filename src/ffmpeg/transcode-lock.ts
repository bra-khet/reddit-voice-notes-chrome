/**
 * One transcode in flight per tab — prevents overlapping client stall timers
 * while another job is still queued/running in the offscreen worker.
 */

let chain: Promise<void> = Promise.resolve();

export async function withTranscodeLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = chain;
  let release!: () => void;
  chain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await work();
  } finally {
    release();
  }
}