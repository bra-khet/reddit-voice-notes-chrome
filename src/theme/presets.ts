import { RVN_COLORS } from '@/src/ui/tokens';
import type { WaveformTheme } from './types';

export const DEFAULT_THEME_ID = 'classic' as const;

export const THEME_PRESETS: WaveformTheme[] = [
  {
    id: 'classic',
    name: 'Classic',
    bars: {
      width: 14,
      spacing: 4,
      cornerRadius: 3,
      glow: 12,
    },
    colors: {
      bar: RVN_COLORS.redditBlue,
      glow: `${RVN_COLORS.redditBlue}cc`,
      bg: RVN_COLORS.surfaceDark,
    },
    background: {
      type: 'gradient',
      value: [
        { offset: 0, color: RVN_COLORS.surfaceDark },
        { offset: 1, color: '#1a1d24' },
      ],
    },
  },
  {
    id: 'neon-glow',
    name: 'Neon Glow',
    bars: {
      width: 12,
      spacing: 5,
      cornerRadius: 6,
      glow: 22,
    },
    colors: {
      bar: '#00e5ff',
      glow: '#ff00e5aa',
      bg: '#060812',
    },
    background: {
      type: 'image',
      value: 'aurora',
      imageDimOverlay: 0.45,
      scaleMode: 'fit',
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    bars: {
      width: 6,
      spacing: 8,
      cornerRadius: 2,
      glow: 4,
    },
    colors: {
      bar: '#e8eaed',
      glow: '#ffffff44',
      bg: '#121316',
    },
    background: {
      type: 'solid',
      value: '#121316',
    },
  },
];

const presetById = new Map(THEME_PRESETS.map((theme) => [theme.id, theme]));

export function getThemeById(id: string | undefined): WaveformTheme {
  if (id && presetById.has(id)) {
    return presetById.get(id)!;
  }
  return presetById.get(DEFAULT_THEME_ID)!;
}

export function listThemePresets(): readonly WaveformTheme[] {
  return THEME_PRESETS;
}