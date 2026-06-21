/**
 * Dulcet v3 — frozen voice-effect types (dulcet-0).
 * No processing or pipeline wiring here; see filter-graphs.ts for FFmpeg/Web Audio sketches.
 */

/** Bundled voice preset ids — hardcoded like theme presets, not stored in savedProfiles. */
export type VoiceEffectPresetId =
  | 'deeper'
  | 'higher'
  | 'slight-mask'
  | 'robot'
  | 'whisper'
  | 'custom';

export const VOICE_SEMITONE_MIN = -12;
export const VOICE_SEMITONE_MAX = 12;

/** dulcet-4: nominal effect strength; 0 = off, Turbo maps to 12. */
export const VOICE_INTENSITY_MIN = 0;
export const VOICE_INTENSITY_MAX = 10;
export const VOICE_INTENSITY_TURBO = 12;
export const VOICE_INTENSITY_DEFAULT = 10;

/** Nominal export sample rate — matches AAC transcode path in ffmpeg-runner.ts. */
export const VOICE_EXPORT_SAMPLE_RATE_HZ = 48_000;

export interface PitchShiftConfig {
  /** Semitone offset (−12 … +12). */
  semitones: number;
  /** Default true — keeps waveform video in sync without re-timing viz. */
  preserveDuration: boolean;
  /**
   * When true, flip semitone sign to exaggerate perceived natural direction.
   * Coarse pitch estimate deferred to dulcet-2 preview UI; field reserved here.
   */
  exaggerateNatural?: boolean;
}

export interface EqBandConfig {
  /** Gain in dB (−12 … +12). */
  lowGain?: number;
  midGain?: number;
  highGain?: number;
}

export interface DynamicsConfig {
  normalize?: boolean;
  compressorEnabled?: boolean;
}

export interface ReverbConfig {
  /** Wet mix 0–1. */
  amount?: number;
}

export interface VoiceEffectConfig {
  enabled: boolean;
  /** Effect strength 0–10 (off at 0). Turbo forces magic 12. */
  intensity?: number;
  /** When true, intensity is VOICE_INTENSITY_TURBO and the slider is bypassed. */
  turbo?: boolean;
  /** Active bundled preset, or `custom` when user edits sliders. */
  presetId?: VoiceEffectPresetId;
  pitchShift?: PitchShiftConfig;
  eq?: EqBandConfig;
  dynamics?: DynamicsConfig;
  reverb?: ReverbConfig;
}

export const DEFAULT_PITCH_SHIFT: PitchShiftConfig = {
  semitones: 0,
  preserveDuration: true,
  exaggerateNatural: false,
};

/** Voice effects off — backward compatible default for profiles without voiceEffectConfig. */
export const DEFAULT_VOICE_EFFECT_CONFIG: VoiceEffectConfig = {
  enabled: false,
  intensity: VOICE_INTENSITY_DEFAULT,
  turbo: false,
  presetId: 'custom',
  pitchShift: { ...DEFAULT_PITCH_SHIFT },
};

const EQ_GAIN_MIN = -12;
const EQ_GAIN_MAX = 12;
const REVERB_AMOUNT_MAX = 1;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeSemitones(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return clamp(Math.round(value), VOICE_SEMITONE_MIN, VOICE_SEMITONE_MAX);
}

function normalizeEqGain(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return clamp(Math.round(value * 10) / 10, EQ_GAIN_MIN, EQ_GAIN_MAX);
}

const VALID_PRESET_IDS: readonly VoiceEffectPresetId[] = [
  'deeper',
  'higher',
  'slight-mask',
  'robot',
  'whisper',
  'custom',
];

export function isVoiceEffectPresetId(value: string): value is VoiceEffectPresetId {
  return (VALID_PRESET_IDS as readonly string[]).includes(value);
}

export function semitonesToPitchRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/**
 * Additive merge for prefs / clip profiles — missing fields inherit defaults; voice-off when absent.
 */
export function normalizeVoiceEffectConfig(
  raw: VoiceEffectConfig | null | undefined,
): VoiceEffectConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_VOICE_EFFECT_CONFIG,
      pitchShift: { ...DEFAULT_PITCH_SHIFT },
    };
  }

  const presetId =
    raw.presetId && isVoiceEffectPresetId(raw.presetId) ? raw.presetId : 'custom';

  const pitchRaw = raw.pitchShift;
  const pitchShift: PitchShiftConfig = {
    semitones: normalizeSemitones(pitchRaw?.semitones),
    preserveDuration: pitchRaw?.preserveDuration !== false,
    exaggerateNatural: pitchRaw?.exaggerateNatural === true,
  };

  const eqRaw = raw.eq;
  const eq: EqBandConfig | undefined = eqRaw
    ? {
        lowGain: normalizeEqGain(eqRaw.lowGain),
        midGain: normalizeEqGain(eqRaw.midGain),
        highGain: normalizeEqGain(eqRaw.highGain),
      }
    : undefined;

  const reverbRaw = raw.reverb;
  const reverb: ReverbConfig | undefined =
    reverbRaw && typeof reverbRaw.amount === 'number'
      ? { amount: clamp(reverbRaw.amount, 0, REVERB_AMOUNT_MAX) }
      : undefined;

  const turbo = raw.turbo === true;
  let intensity =
    typeof raw.intensity === 'number' && !Number.isNaN(raw.intensity)
      ? Math.round(raw.intensity)
      : VOICE_INTENSITY_DEFAULT;
  if (turbo) {
    intensity = VOICE_INTENSITY_TURBO;
  } else {
    intensity = clamp(intensity, VOICE_INTENSITY_MIN, VOICE_INTENSITY_MAX);
  }

  return {
    enabled: raw.enabled === true,
    intensity,
    turbo,
    presetId,
    pitchShift,
    eq,
    dynamics: raw.dynamics,
    reverb,
  };
}

/** Resolved strength for export/preview scaling (0 when disabled). */
export function effectiveVoiceIntensity(config: VoiceEffectConfig): number {
  const normalized = normalizeVoiceEffectConfig(config);
  if (!normalized.enabled) return 0;
  return normalized.intensity ?? VOICE_INTENSITY_DEFAULT;
}

/**
 * Scale numeric effect magnitudes by intensity/10 (Turbo = 12 → 1.2×).
 * Boolean dynamics flags stay when intensity > 0 and originally enabled.
 */
export function scaleVoiceEffectByIntensity(config: VoiceEffectConfig): VoiceEffectConfig {
  const normalized = normalizeVoiceEffectConfig(config);
  if (!normalized.enabled) return normalized;

  const intensity = normalized.intensity ?? VOICE_INTENSITY_DEFAULT;
  if (intensity <= 0) {
    return { ...normalized, enabled: false };
  }

  const factor = intensity / VOICE_INTENSITY_MAX;
  const roundGain = (value: number | undefined): number | undefined => {
    if (value === undefined || Number.isNaN(value)) return undefined;
    const scaled = Math.round(value * factor * 10) / 10;
    return scaled === 0 ? undefined : scaled;
  };

  const semitones = normalized.pitchShift?.semitones ?? 0;
  const scaledSemitones = clamp(
    Math.round(semitones * factor),
    VOICE_SEMITONE_MIN,
    VOICE_SEMITONE_MAX,
  );

  const eq = normalized.eq;
  const scaledEq: EqBandConfig | undefined = eq
    ? {
        lowGain: roundGain(eq.lowGain),
        midGain: roundGain(eq.midGain),
        highGain: roundGain(eq.highGain),
      }
    : undefined;

  const reverbAmount = normalized.reverb?.amount;
  const scaledReverb: ReverbConfig | undefined =
    reverbAmount !== undefined
      ? { amount: clamp(reverbAmount * factor, 0, REVERB_AMOUNT_MAX) }
      : undefined;

  return {
    ...normalized,
    pitchShift: normalized.pitchShift
      ? { ...normalized.pitchShift, semitones: scaledSemitones }
      : undefined,
    eq: scaledEq,
    reverb: scaledReverb,
  };
}

/** Stable equality for profile dirty checks and snapshots. */
export function voiceEffectConfigsEqual(
  a: VoiceEffectConfig,
  b: VoiceEffectConfig,
): boolean {
  return (
    JSON.stringify(normalizeVoiceEffectConfig(a)) ===
    JSON.stringify(normalizeVoiceEffectConfig(b))
  );
}

/** True when config would alter audio (used to skip FFmpeg -af and preview chains). */
export function voiceEffectIsActive(config: VoiceEffectConfig): boolean {
  const scaled = scaleVoiceEffectByIntensity(config);
  if (!scaled.enabled) return false;

  const semitones = scaled.pitchShift?.semitones ?? 0;
  if (semitones !== 0) return true;

  const eq = scaled.eq;
  if (eq?.lowGain || eq?.midGain || eq?.highGain) return true;

  if (scaled.dynamics?.normalize || scaled.dynamics?.compressorEnabled) return true;

  const reverbAmount = scaled.reverb?.amount ?? 0;
  if (reverbAmount > 0) return true;

  return false;
}