import type { TranscriptConfig } from './types';

/** Collapsed Design Studio chip — leaf module (popup-safe). */
export function formatSubtitleSummary(config: TranscriptConfig): string {
  if (!config.transcriptionEnabled) return 'Off';

  const text = config.result?.text?.trim() ?? '';
  const segments = config.result?.segments?.length ?? 0;
  if (!text) return 'On · awaiting transcript';

  const preview = text.length > 28 ? `${text.slice(0, 28)}…` : text;
  const segLabel = segments > 0 ? `${segments} seg` : 'text';
  return `On · ${segLabel} · ${preview}`;
}