import type { TranscriptSegment } from './types';

function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);

  const pad2 = (value: number) => String(value).padStart(2, '0');
  const pad3 = (value: number) => String(value).padStart(3, '0');

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)},${pad3(millis)}`;
}

/** Build SubRip text from timed segments (eloquent-0 stub — used in eloquent-3 burn-in). */
export function buildSrtFromSegments(segments: TranscriptSegment[]): string {
  const blocks: string[] = [];

  segments.forEach((segment, index) => {
    const text = segment.text.trim();
    if (!text) return;

    const start = formatSrtTimestamp(segment.start);
    const end = formatSrtTimestamp(Math.max(segment.end, segment.start + 0.25));
    blocks.push(`${index + 1}\n${start} --> ${end}\n${text}\n`);
  });

  return blocks.join('\n');
}