import type { BarAlignment } from '@/src/recorder/waveform';
import { resolveAppearanceTheme } from '@/src/theme';
import { hexToHsv } from '@/src/theme/color-utils';
import { userBackgroundLayoutFromAppearance } from '@/src/theme/background-layout';
import {
  getAudioVisualDefinition,
  getStackableEffectDefinition,
  type OverlayPresetId,
  type SpectrumPresetId,
} from '@/src/theme/audio-reactive';
import { evaluateVisualPerformance } from '@/src/theme/audio-reactive/performance-governor';
import { registerCoreOverlayVisuals } from '@/src/theme/audio-reactive/overlays';
import { registerCoreSpectrumVisuals } from '@/src/theme/audio-reactive/spectra';
import { registerCoreStackableEffects } from '@/src/theme/audio-reactive/stackables';
import { getCustomStyleById } from '@/src/settings/custom-styles';
import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import { formatVoiceEffectSummary } from '@/src/voice/voice-summary';
import type { VoiceEffectConfig } from '@/src/voice/types';
import { formatSubtitleSummary } from '@/src/transcription/transcript-summary';
import type { TranscriptConfig } from '@/src/transcription/types';

export interface StudioSummaryContext {
  prefs: UserPreferencesV1;
  voiceDraft?: VoiceEffectConfig;
  subtitleDraft?: TranscriptConfig;
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

export function renderStyleSummaryHtml(ctx: StudioSummaryContext): string {
  const { prefs } = ctx;
  const label = styleLabel(prefs);
  const color = barColor(prefs);
  const hsv = hexToHsv(color);
  const sat = Math.round(hsv?.s ?? 0);
  const val = Math.round(hsv?.v ?? 0);
  const alignment = prefs.appearance.barAlignment ?? 'center';
  const theme = resolveAppearanceTheme(prefs.appearance);
  const effects = theme.designEffects;
  const spectrumId = (effects?.spectrumPreset ?? 'classic-neon') as SpectrumPresetId;
  const overlayId = (effects?.overlayPreset !== undefined
    ? effects.overlayPreset
    : effects?.backgroundOverlay) as OverlayPresetId | null | undefined;
  const stackables = effects?.stackables ?? [];
  const performance = evaluateVisualPerformance({
    spectrumPreset: spectrumId,
    overlayPreset: overlayId,
    stackables,
    density: effects?.visualizerParams?.density,
  });

  const effectParts: string[] = [];
  if (overlayId) effectParts.push(getAudioVisualDefinition('overlay', overlayId)?.label ?? overlayId);
  if (stackables.length > 0) effectParts.push(`${stackables.length} accent${stackables.length === 1 ? '' : 's'}`);
  const effectsChip =
    effectParts.length > 0
      ? `<span class="studio__meta-chip studio__meta-chip--effects">${effectParts.join(' · ')}</span>`
      : '';
  const spectrumLabel = getAudioVisualDefinition('spectrum', spectrumId)?.label ?? 'Classic';
  const suspendedLabel = performance.suspendedStackableId
    ? getStackableEffectDefinition(performance.suspendedStackableId)?.label
    : null;
  const governorLabel = performance.level === 'comfortable'
    ? 'Comfortable'
    : performance.level === 'elevated'
      ? 'Elevated'
      : suspendedLabel ? `Guarded · ${suspendedLabel}` : 'Guarded';

  return `
    <span class="studio__meta-style-name">${label}</span>
    <span class="studio__meta-chip studio__meta-chip--spectrum">${spectrumLabel}</span>
    <span class="studio__meta-swatch" style="background:${color}" title="${color}"></span>
    <span class="studio__meta-sv">S${sat} V${val}</span>
    ${alignmentBadgeHtml(alignment)}
    ${effectsChip}
    <span class="studio__meta-chip studio__meta-chip--performance studio__meta-chip--${performance.level}">${governorLabel}</span>
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

export function renderSubtitleSummaryHtml(ctx: StudioSummaryContext): string {
  if (!ctx.subtitleDraft) {
    return '<span class="studio__meta-plain">Off</span>';
  }
  const summary = formatSubtitleSummary(ctx.subtitleDraft);
  return `<span class="studio__meta-plain">${summary}</span>`;
}

export function syncStudioSectionSummaries(root: HTMLElement, ctx: StudioSummaryContext): void {
  const styleEl = root.querySelector<HTMLElement>('[data-summary-style]');
  const backgroundEl = root.querySelector<HTMLElement>('[data-summary-background]');
  const voiceEl = root.querySelector<HTMLElement>('[data-summary-voice]');
  const subtitleEl = root.querySelector<HTMLElement>('[data-summary-subtitles]');

  if (styleEl) styleEl.innerHTML = renderStyleSummaryHtml(ctx);
  if (backgroundEl) backgroundEl.innerHTML = renderBackgroundSummaryHtml(ctx);
  if (voiceEl) voiceEl.innerHTML = renderVoiceSummaryHtml(ctx);
  if (subtitleEl) subtitleEl.innerHTML = renderSubtitleSummaryHtml(ctx);
}

// CHANGED: the Style card summary reads the same production labels and cost ceilings as the panel.
// WHY: saved IDs such as `bokeh` must never leak into user-facing status or drift from governor state.
registerCoreSpectrumVisuals();
registerCoreOverlayVisuals();
registerCoreStackableEffects();
