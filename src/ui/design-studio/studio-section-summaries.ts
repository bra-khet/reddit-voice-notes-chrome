import type { BarAlignment } from '@/src/recorder/waveform';
import { resolveAppearanceTheme } from '@/src/theme';
import { hexToHsv } from '@/src/theme/color-utils';
import { userBackgroundLayoutFromAppearance } from '@/src/theme/background-layout';
import { getCustomStyleById } from '@/src/settings/custom-styles';
import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import { formatVoiceEffectSummary } from '@/src/voice/voice-summary';
import type { VoiceEffectConfig } from '@/src/voice/types';

export interface StudioSummaryContext {
  prefs: UserPreferencesV1;
  voiceDraft?: VoiceEffectConfig;
}

const ALIGNMENT_TITLES: Record<BarAlignment, string> = {
  top: 'Top',
  center: 'Center',
  bottom: 'Bottom',
};

const POSITION_ABBREV: Record<string, string> = {
  'top-left': 'TL',
  top: 'T',
  'top-right': 'TR',
  left: 'L',
  center: 'C',
  right: 'R',
  'bottom-left': 'BL',
  bottom: 'B',
  'bottom-right': 'BR',
};

function styleLabel(prefs: UserPreferencesV1): string {
  const theme = resolveAppearanceTheme(prefs.appearance);
  const custom = prefs.appearance.activeCustomStyleId
    ? getCustomStyleById(prefs, prefs.appearance.activeCustomStyleId)
    : undefined;
  return custom?.name ?? (prefs.appearance.designOverrides?.barColor ? 'Custom' : theme.name);
}

function barColor(prefs: UserPreferencesV1): string {
  const theme = resolveAppearanceTheme(prefs.appearance);
  return prefs.appearance.designOverrides?.barColor ?? theme.colors.bar;
}

function alignmentBadgeHtml(alignment: BarAlignment): string {
  const activeIndex = alignment === 'top' ? 0 : alignment === 'center' ? 1 : 2;
  const bars = [0, 1, 2]
    .map(
      (index) =>
        `<span class="studio__align-bar${index === activeIndex ? ' studio__align-bar--active' : ''}"></span>`,
    )
    .join('');
  return `<span class="studio__align-badge" title="${ALIGNMENT_TITLES[alignment]}" aria-hidden="true">${bars}</span>`;
}

export function renderBarStyleSummaryHtml(ctx: StudioSummaryContext): string {
  const { prefs } = ctx;
  const label = styleLabel(prefs);
  const color = barColor(prefs);
  const hsv = hexToHsv(color);
  const sat = hsv?.s ?? 0;
  const val = hsv?.v ?? 0;
  const alignment = prefs.appearance.barAlignment ?? 'center';
  const overrides = prefs.appearance.designOverrides;
  const flair =
    overrides?.backgroundEffect && overrides.backgroundEffect !== 'none'
      ? overrides.backgroundEffect
      : null;
  const glowBoost = overrides?.barGlow === 'boosted';

  const effectParts: string[] = [];
  if (flair) effectParts.push(flair);
  if (glowBoost) effectParts.push('glow');
  const effectsChip =
    effectParts.length > 0
      ? `<span class="studio__meta-chip studio__meta-chip--effects">${effectParts.join(' · ')}</span>`
      : '';

  return `
    <span class="studio__meta-style-name">${label}</span>
    <span class="studio__meta-swatch" style="background:${color}" title="${color}"></span>
    <span class="studio__meta-sv">S${sat} V${val}</span>
    ${alignmentBadgeHtml(alignment)}
    ${effectsChip}
  `;
}

export function renderBackgroundSummaryHtml(ctx: StudioSummaryContext): string {
  const { prefs } = ctx;
  const hasPersonal = Boolean(prefs.appearance.customBackgroundId);
  if (!hasPersonal) {
    return '<span class="studio__meta-plain">Theme background</span>';
  }

  const layout = userBackgroundLayoutFromAppearance(prefs.appearance);
  const scale = layout.scaleMode === 'fit' ? 'Fit' : 'Fill';
  const pos = POSITION_ABBREV[layout.position] ?? 'C';

  return `
    <span class="studio__meta-plain">Personal</span>
    <span class="studio__meta-chip">${scale}</span>
    <span class="studio__meta-chip">${pos}</span>
  `;
}

export function renderVoiceSummaryHtml(ctx: StudioSummaryContext): string {
  const config = ctx.voiceDraft ?? ctx.prefs.voiceEffect;
  const summary = formatVoiceEffectSummary(config);
  return `<span class="studio__meta-plain">${summary}</span>`;
}

export function syncStudioSectionSummaries(root: HTMLElement, ctx: StudioSummaryContext): void {
  const barStyleEl = root.querySelector<HTMLElement>('[data-summary-bar-style]');
  const backgroundEl = root.querySelector<HTMLElement>('[data-summary-background]');
  const voiceEl = root.querySelector<HTMLElement>('[data-summary-voice]');

  if (barStyleEl) barStyleEl.innerHTML = renderBarStyleSummaryHtml(ctx);
  if (backgroundEl) backgroundEl.innerHTML = renderBackgroundSummaryHtml(ctx);
  if (voiceEl) voiceEl.innerHTML = renderVoiceSummaryHtml(ctx);
}