export interface PcmStats {
  frameCount: number;
  sampleRate: number;
  durationSec: number;
  peak: number;
  rms: number;
}

export function analyzePcm(samples: Float32Array, sampleRate: number): PcmStats {
  let peak = 0;
  let sumSq = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSq += value * value;
  }

  return {
    frameCount: samples.length,
    sampleRate,
    durationSec: sampleRate > 0 ? samples.length / sampleRate : 0,
    peak,
    rms: samples.length > 0 ? Math.sqrt(sumSq / samples.length) : 0,
  };
}

export function formatPcmStats(stats: PcmStats): string {
  return `${stats.frameCount} frames @ ${stats.sampleRate}Hz (${stats.durationSec.toFixed(1)}s, peak=${stats.peak.toFixed(3)}, rms=${stats.rms.toFixed(4)})`;
}

/** Throws when decoded/relayed PCM cannot produce speech recognition output. */
export function assertPcmUsable(samples: Float32Array, sampleRate: number, minDurationSec = 0.2): PcmStats {
  const stats = analyzePcm(samples, sampleRate);

  if (stats.frameCount === 0) {
    throw new Error('PCM decode produced zero frames — WebM audio may not have survived decode');
  }

  if (stats.durationSec < minDurationSec) {
    throw new Error(`PCM too short for transcription: ${formatPcmStats(stats)}`);
  }

  if (stats.peak < 1e-5 && stats.rms < 1e-6) {
    throw new Error(`PCM appears silent after decode/relay: ${formatPcmStats(stats)}`);
  }

  return stats;
}

export function coerceFloat32Samples(raw: unknown): Float32Array {
  if (raw instanceof Float32Array) {
    return raw;
  }

  if (raw instanceof ArrayBuffer) {
    return new Float32Array(raw);
  }

  if (ArrayBuffer.isView(raw)) {
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / Float32Array.BYTES_PER_ELEMENT);
  }

  throw new Error('PCM samples missing or invalid after postMessage relay');
}