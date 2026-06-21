/**
 * eloquent-0 — frozen transcription types (leaf module).
 * Do not re-export runtime loaders from here; popup/settings import summaries only.
 */

export type TranscriptSource = 'vosk' | 'manual';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  source: TranscriptSource;
}

export interface SubtitleBackdropConfig {
  enabled: boolean;
  opacity?: number;
  borderRadius?: number;
  fullWidth?: boolean;
}

export interface SubtitleShadowConfig {
  enabled: boolean;
  offsetX?: number;
  offsetY?: number;
  opacity?: number;
}

export interface SubtitleOutlineConfig {
  enabled: boolean;
  width?: number;
}

export interface SubtitleStyleConfig {
  enabled: boolean;
  fontFamily?: string;
  fontSize?: number;
  position?: 'bottom' | 'top' | 'center';
  backdrop?: SubtitleBackdropConfig;
  shadow?: SubtitleShadowConfig;
  outline?: SubtitleOutlineConfig;
}

export interface TranscriptConfig {
  /** User opted in to transcription for this profile/session. */
  transcriptionEnabled: boolean;
  result?: TranscriptResult | null;
  style: SubtitleStyleConfig;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleConfig = {
  enabled: false,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 22,
  position: 'bottom',
  backdrop: { enabled: true, opacity: 0.72, borderRadius: 8, fullWidth: false },
  shadow: { enabled: true, offsetX: 1, offsetY: 1, opacity: 0.85 },
  outline: { enabled: false, width: 1 },
};

export const DEFAULT_TRANSCRIPT_CONFIG: TranscriptConfig = {
  transcriptionEnabled: false,
  result: null,
  style: DEFAULT_SUBTITLE_STYLE,
};

export interface TranscribeProgressCallback {
  (ratio: number, stage: string): void;
}

export interface TranscribeAudioOptions {
  modelUrl: string;
  language?: string;
  onProgress?: TranscribeProgressCallback;
}

export interface TranscribeAudioResult {
  result: TranscriptResult;
  applied: boolean;
  fallback: boolean;
  stage: string;
  elapsedMs: number;
}

export function normalizeSubtitleStyle(raw: Partial<SubtitleStyleConfig> | null | undefined): SubtitleStyleConfig {
  const backdrop: Partial<SubtitleBackdropConfig> = raw?.backdrop ?? {};
  const shadow: Partial<SubtitleShadowConfig> = raw?.shadow ?? {};
  const outline: Partial<SubtitleOutlineConfig> = raw?.outline ?? {};

  return {
    enabled: raw?.enabled === true,
    fontFamily: raw?.fontFamily ?? DEFAULT_SUBTITLE_STYLE.fontFamily,
    fontSize: typeof raw?.fontSize === 'number' ? raw.fontSize : DEFAULT_SUBTITLE_STYLE.fontSize,
    position: raw?.position ?? DEFAULT_SUBTITLE_STYLE.position,
    backdrop: {
      enabled: backdrop.enabled !== false,
      opacity: typeof backdrop.opacity === 'number' ? backdrop.opacity : DEFAULT_SUBTITLE_STYLE.backdrop!.opacity,
      borderRadius:
        typeof backdrop.borderRadius === 'number'
          ? backdrop.borderRadius
          : DEFAULT_SUBTITLE_STYLE.backdrop!.borderRadius,
      fullWidth: backdrop.fullWidth === true,
    },
    shadow: {
      enabled: shadow.enabled !== false,
      offsetX: typeof shadow.offsetX === 'number' ? shadow.offsetX : DEFAULT_SUBTITLE_STYLE.shadow!.offsetX,
      offsetY: typeof shadow.offsetY === 'number' ? shadow.offsetY : DEFAULT_SUBTITLE_STYLE.shadow!.offsetY,
      opacity: typeof shadow.opacity === 'number' ? shadow.opacity : DEFAULT_SUBTITLE_STYLE.shadow!.opacity,
    },
    outline: {
      enabled: outline.enabled === true,
      width: typeof outline.width === 'number' ? outline.width : DEFAULT_SUBTITLE_STYLE.outline!.width,
    },
  };
}

export function normalizeTranscriptConfig(raw: Partial<TranscriptConfig> | null | undefined): TranscriptConfig {
  return {
    transcriptionEnabled: raw?.transcriptionEnabled === true,
    result: raw?.result ?? null,
    style: normalizeSubtitleStyle(raw?.style),
  };
}

export function transcriptSegmentsEqual(a: TranscriptSegment[], b: TranscriptSegment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, index) => {
    const other = b[index];
    return seg.start === other.start && seg.end === other.end && seg.text === other.text;
  });
}

export function transcriptResultsEqual(a: TranscriptResult | null | undefined, b: TranscriptResult | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.text === b.text &&
    a.source === b.source &&
    a.language === b.language &&
    transcriptSegmentsEqual(a.segments, b.segments)
  );
}