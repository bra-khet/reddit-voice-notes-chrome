/**
 * v5.3.5 Cue-stable overlay caching — cache keys, phase quantization, LRU storage.
 * Sync: subtitle-overlay-renderer.ts paintCueWithCache + compensated frame pacing.
 */

import {
  CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS,
  canvasTextGradientWavePhase,
} from '@/src/transcription/subtitle-effects';
import {
  DEFAULT_SUBTITLE_HUE_ROTATE_SPEED,
  type SubtitleStyleConfig,
} from '@/src/transcription/types';

/** Quantized animation buckets per cycle — 32 ≈ ~30 updates/s at 30 fps (v5.3.5 QA tuning). */
export const CUE_OVERLAY_CACHE_PHASE_BUCKETS = 32;

/** Defensive cap for pathological transcripts (v5.3.5 design §3.3). */
export const CUE_OVERLAY_CACHE_MAX_ENTRIES = 64;

export interface CueOverlayCacheLookupCue {
  start: number;
  end: number;
  text: string;
}

export interface CueOverlayCacheStats {
  enabled: boolean;
  phaseBuckets: number;
  maxEntries: number;
  hits: number;
  misses: number;
  lookups: number;
  creates: number;
  evictions: number;
  uniqueKeys: number;
  hitRate: number;
}

export function stableCueId(cue: CueOverlayCacheLookupCue): string {
  return `${cue.start}|${cue.end}|${cue.text}`;
}

/**
 * Lightweight stable hash of style fields that affect canvas overlay paint.
 */
export function hashSubtitleStyleForCueCache(
  style: SubtitleStyleConfig,
  themeBarColor: string,
): string {
  const glow = style.glow;
  const backdrop = style.backdrop;
  return [
    style.fontSize ?? 22,
    style.fontFamily ?? '',
    style.position ?? 'bottom',
    style.textColor ?? '',
    style.specialHue ?? '',
    style.textGradient !== false ? 1 : 0,
    style.textGradientWave === true ? 1 : 0,
    glow?.enabled === true ? 1 : 0,
    glow?.mode ?? 'halo',
    glow?.opacity ?? 0.55,
    glow?.blurRadius ?? 2,
    glow?.dualBorder === true ? 1 : 0,
    glow?.colorSource ?? '',
    glow?.hueRotateMode ?? '',
    glow?.hueRotateSpeed ?? DEFAULT_SUBTITLE_HUE_ROTATE_SPEED,
    backdrop?.enabled === false ? 0 : 1,
    backdrop?.opacity ?? 0.72,
    backdrop?.borderRadius ?? 8,
    themeBarColor,
  ].join('|');
}

function wavePhaseBucket(timestampSeconds: number): number {
  const phase = canvasTextGradientWavePhase(timestampSeconds);
  return Math.floor(phase * CUE_OVERLAY_CACHE_PHASE_BUCKETS) % CUE_OVERLAY_CACHE_PHASE_BUCKETS;
}

function hueRotatePhaseBucket(style: SubtitleStyleConfig, timestampSeconds: number): number {
  const glow = style.glow;
  const speed = Math.max(1, glow?.hueRotateSpeed ?? DEFAULT_SUBTITLE_HUE_ROTATE_SPEED);
  const hue = ((timestampSeconds * speed) % 360 + 360) % 360;
  const bucketSize = 360 / CUE_OVERLAY_CACHE_PHASE_BUCKETS;
  return Math.floor(hue / bucketSize) % CUE_OVERLAY_CACHE_PHASE_BUCKETS;
}

/**
 * Quantized animation phase label for cache keys.
 * Static cues return "0"; animated effects append wave/hue bucket tags.
 */
export function quantizeOverlayAnimationPhase(
  style: SubtitleStyleConfig,
  timestampSeconds: number,
): string {
  const parts: string[] = [];

  if (style.textGradientWave === true) {
    parts.push(`w${wavePhaseBucket(timestampSeconds)}`);
  }

  if (style.glow?.colorSource === 'rainbow') {
    parts.push(`h${hueRotatePhaseBucket(style, timestampSeconds)}`);
  }

  return parts.length > 0 ? parts.join(',') : '0';
}

export function makeCueOverlayCacheKey(
  cue: CueOverlayCacheLookupCue,
  style: SubtitleStyleConfig,
  themeBarColor: string,
  timestampSeconds: number,
): string {
  const cueId = stableCueId(cue);
  const styleHash = hashSubtitleStyleForCueCache(style, themeBarColor);
  const phaseBucket = quantizeOverlayAnimationPhase(style, timestampSeconds);
  return `${cueId}|${styleHash}|phase:${phaseBucket}`;
}

export class CueOverlayCache {
  private readonly map = new Map<string, ImageBitmap>();
  private readonly order: string[] = [];
  private hits = 0;
  private misses = 0;
  private creates = 0;
  private evictions = 0;

  get(key: string): ImageBitmap | undefined {
    const bitmap = this.map.get(key);
    if (!bitmap) {
      this.misses += 1;
      return undefined;
    }

    const index = this.order.indexOf(key);
    if (index >= 0) {
      this.order.splice(index, 1);
      this.order.push(key);
    }
    this.hits += 1;
    return bitmap;
  }

  set(key: string, bitmap: ImageBitmap): void {
    if (this.map.has(key)) {
      this.map.get(key)?.close();
      const index = this.order.indexOf(key);
      if (index >= 0) this.order.splice(index, 1);
    } else {
      this.creates += 1;
      if (this.map.size >= CUE_OVERLAY_CACHE_MAX_ENTRIES) {
        const evictKey = this.order.shift();
        if (evictKey) {
          this.map.get(evictKey)?.close();
          this.map.delete(evictKey);
          this.evictions += 1;
        }
      }
    }

    this.map.set(key, bitmap);
    this.order.push(key);
  }

  clear(): void {
    for (const bitmap of this.map.values()) {
      bitmap.close();
    }
    this.map.clear();
    this.order.length = 0;
    this.hits = 0;
    this.misses = 0;
    this.creates = 0;
    this.evictions = 0;
  }

  get size(): number {
    return this.map.size;
  }

  stats(enabled = true): CueOverlayCacheStats {
    const lookups = this.hits + this.misses;
    return {
      enabled,
      phaseBuckets: CUE_OVERLAY_CACHE_PHASE_BUCKETS,
      maxEntries: CUE_OVERLAY_CACHE_MAX_ENTRIES,
      hits: this.hits,
      misses: this.misses,
      lookups,
      creates: this.creates,
      evictions: this.evictions,
      uniqueKeys: this.map.size,
      hitRate: lookups > 0 ? this.hits / lookups : 0,
    };
  }
}

/** Exported for tests — wave cycle constant used in phase bucketing. */
export const CUE_CACHE_WAVE_CYCLE_SECONDS = CANVAS_TEXT_GRADIENT_WAVE_CYCLE_SECONDS;