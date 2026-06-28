/**
 * Dulcet II (v5) — procedural impulse-response generator (Sub-Phase 1.2b).
 *
 * Synthesizes reverb impulse responses entirely in JS — no sampled assets, no
 * licensing, tiny footprint (decision: v5 procedural-IR). The same generator
 * feeds two backends:
 *  - **Export:** IR → 16-bit WAV → FFmpeg `afir` (convolution) via the renderer's
 *    aux-input hook.
 *  - **Preview (Branch 3):** IR → `AudioBuffer` → `ConvolverNode`.
 *
 * Model: per-"space" exponential-decay filtered noise tail + early reflections +
 * a small direct impulse. Deterministic (seeded) so the same params always yield
 * the same space. "space" ids double as high-level "Character Space" presets.
 */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * clamp(t, 0, 1);
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface IrSpaceDef {
  /** Decay seconds at decay=50 (scaled by the decay param). */
  baseDecaySec: number;
  /** 0..1 high-frequency damping (1 = dark/absorptive, 0 = bright/reflective). */
  damping: number;
  /** Early-reflection tap times (ms). */
  earlyMs: number[];
  /** Early-reflection base gain. */
  earlyGain: number;
}

/** "Character Space" presets — the IR-selection menu the Custom UI exposes later. */
export const IR_SPACES: Record<string, IrSpaceDef> = {
  'fantasy-hall': { baseDecaySec: 1.8, damping: 0.45, earlyMs: [11, 19, 27], earlyGain: 0.5 },
  'cyber-chamber': { baseDecaySec: 0.7, damping: 0.18, earlyMs: [5, 9, 13, 17], earlyGain: 0.6 },
  cavern: { baseDecaySec: 3.0, damping: 0.7, earlyMs: [23, 37, 53], earlyGain: 0.42 },
  'small-box': { baseDecaySec: 0.4, damping: 0.35, earlyMs: [3, 6, 9], earlyGain: 0.55 },
  phone: { baseDecaySec: 0.22, damping: 0.55, earlyMs: [2, 4], earlyGain: 0.5 },
  oracle: { baseDecaySec: 2.6, damping: 0.5, earlyMs: [17, 29, 43, 61], earlyGain: 0.45 },
};

const DEFAULT_SPACE: IrSpaceDef = IR_SPACES['fantasy-hall'];

export interface IrParams {
  /** Space id (key of {@link IR_SPACES}); unknown ids fall back to fantasy-hall. */
  space: string;
  /** 0–100 decay-tail length scaling. */
  decay: number;
  /** 0–100 pre-delay before the tail (sense of distance). */
  preDelay: number;
}

/** Generate a mono impulse response for the given space + params. */
export function generateImpulseResponse(p: IrParams, sampleRate = 48_000): Float32Array {
  const def = IR_SPACES[p.space] ?? DEFAULT_SPACE;
  const decaySec = clamp(def.baseDecaySec * lerp(0.4, 1.8, p.decay / 100), 0.15, 3.0);
  const preDelaySec = lerp(0, 0.08, p.preDelay / 100);
  const length = Math.ceil((preDelaySec + decaySec) * sampleRate);
  const preDelaySamples = Math.floor(preDelaySec * sampleRate);
  const ir = new Float32Array(length);

  // Deterministic noise (seeded LCG) so a given space is stable across renders.
  let seed = hashString(p.space) ^ (Math.floor(p.decay) * 2654435761);
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  const tau = decaySec / 6; // ~6 time constants across the decay
  const lp = clamp(def.damping, 0, 0.95);
  const brightMix = clamp(1 - def.damping, 0, 0.6); // blend raw noise back for sparkle
  let prev = 0;

  for (let i = preDelaySamples; i < length; i++) {
    const t = (i - preDelaySamples) / sampleRate;
    const env = Math.exp(-t / tau);
    const n = rnd();
    prev = prev + (1 - lp) * (n - prev); // one-pole lowpass = damping
    ir[i] = lerp(prev, n, brightMix) * env;
  }

  // Early reflections (alternating sign for diffusion).
  for (let k = 0; k < def.earlyMs.length; k++) {
    const idx = preDelaySamples + Math.floor((def.earlyMs[k] / 1000) * sampleRate);
    if (idx < length) ir[idx] += def.earlyGain * 0.8 ** k * (k % 2 === 0 ? 1 : -1);
  }
  // A little direct signal for body.
  if (preDelaySamples < length) ir[preDelaySamples] += 0.6;

  // Peak-normalize so afir / ConvolverNode get a predictable level.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(ir[i]));
  if (peak > 0) {
    const g = 0.9 / peak;
    for (let i = 0; i < length; i++) ir[i] *= g;
  }
  return ir;
}

/** Encode a mono Float32 buffer as 16-bit PCM WAV bytes (for the FFmpeg `afir` input). */
export function encodeWavMono16(samples: Float32Array, sampleRate = 48_000): Uint8Array {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  dv.setUint32(40, n * 2, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = clamp(samples[i], -1, 1);
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}
