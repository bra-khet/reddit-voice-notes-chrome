import type { BarAlignment } from '@/src/recorder/waveform';
import {
  getPresetClipProfile,
  isPresetProfileId,
  presetThemeIdFromProfileId,
} from '@/src/settings/preset-profiles';
import {
  normalizeBackgroundPosition,
  normalizeBackgroundScaleMode,
} from '@/src/theme/background-layout';
import type { BackgroundImagePosition, BackgroundScaleMode } from '@/src/theme/types';
import { normalizeBackgroundAssetId } from '@/src/storage/image-db';
import { designOverridesMatch, normalizeDesignOverrides } from '@/src/theme/design-overrides';
import { isKnownThemeId, normalizeThemeId } from '@/src/theme/presets';
import type { AppearancePreferences, UserPreferencesV1 } from '@/src/settings/user-preferences';
import {
  DEFAULT_TRANSCRIPT_CONFIG,
  normalizeTranscriptConfig,
  transcriptConfigsEqual,
  type TranscriptConfig,
} from '@/src/transcription/types';
import { voiceEffectConfigsEqual } from '@/src/voice/resolve-config';
import {
  DEFAULT_VOICE_EFFECT_CONFIG,
  normalizeVoiceEffectConfig,
  type VoiceEffectConfig,
} from '@/src/voice/types';

export const MAX_CLIP_PROFILES = 12;
export const PROFILE_ID_PREFIX = 'clip-' as const;
export const PROFILE_SELECT_CUSTOM = '' as const;

export interface ClipProfile {
  id: string;
  name: string;
  themeId: string;
  barAlignment: BarAlignment;
  /** ImageDB record id (`bg-…`) when this profile uses a personal background. */
  customBackgroundId?: string | null;
  backgroundScaleMode?: BackgroundScaleMode;
  backgroundPosition?: BackgroundImagePosition;
  /** Saved custom clip style (`style-…`) when this profile uses user colors. */
  customStyleId?: string | null;
  /** Snapshot of unsaved custom colors when the profile was saved. */
  designOverrides?: import('@/src/theme/design-overrides').DesignOverrides | null;
  /** dulcet-4: voice effect snapshot — absent on legacy profiles means voice-off. */
  voiceEffectConfig?: VoiceEffectConfig | null;
  /** eloquent-2: subtitle snapshot — absent on legacy profiles means subtitles-off. */
  transcriptConfig?: TranscriptConfig | null;
}

const VALID_BAR_ALIGNMENTS: readonly BarAlignment[] = ['center', 'bottom', 'top'];

function normalizeBarAlignment(alignment: BarAlignment | undefined): BarAlignment {
  if (alignment && VALID_BAR_ALIGNMENTS.includes(alignment)) return alignment;
  return 'center';
}

export function createClipProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${PROFILE_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${PROFILE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeClipProfiles(
  profiles: ClipProfile[] | undefined,
  savedCustomStyles: { id: string }[] = [],
): ClipProfile[] {
  if (!profiles?.length) return [];

  const seenIds = new Set<string>();
  const normalized: ClipProfile[] = [];
  const validStyleIds = new Set(savedCustomStyles.map((style) => style.id));

  for (const raw of profiles) {
    const name = raw.name?.trim();
    if (!raw.id || !name || !isKnownThemeId(raw.themeId)) continue;
    if (seenIds.has(raw.id)) continue;
    seenIds.add(raw.id);

    const customStyleId =
      raw.customStyleId && validStyleIds.has(raw.customStyleId) ? raw.customStyleId : null;
    const designOverrides = customStyleId
      ? null
      : normalizeDesignOverrides(raw.designOverrides);

    normalized.push({
      id: raw.id,
      name: name.slice(0, 40),
      themeId: normalizeThemeId(raw.themeId),
      barAlignment: normalizeBarAlignment(raw.barAlignment),
      customBackgroundId: normalizeBackgroundAssetId(raw.customBackgroundId),
      backgroundScaleMode: normalizeBackgroundScaleMode(raw.backgroundScaleMode),
      backgroundPosition: normalizeBackgroundPosition(raw.backgroundPosition),
      customStyleId,
      designOverrides,
      voiceEffectConfig:
        raw.voiceEffectConfig != null
          ? normalizeVoiceEffectConfig(raw.voiceEffectConfig)
          : null,
      transcriptConfig:
        raw.transcriptConfig != null
          ? normalizeTranscriptConfig(raw.transcriptConfig)
          : null,
    });

    if (normalized.length >= MAX_CLIP_PROFILES) break;
  }

  return normalized;
}

export function normalizeActiveProfileId(
  activeId: string | null | undefined,
  profiles: ClipProfile[],
): string | null {
  if (!activeId) return null;
  if (isPresetProfileId(activeId)) {
    const themeId = presetThemeIdFromProfileId(activeId);
    return isKnownThemeId(themeId) ? activeId : null;
  }
  return profiles.some((profile) => profile.id === activeId) ? activeId : null;
}

export function getClipProfileById(
  prefs: UserPreferencesV1,
  profileId: string,
): ClipProfile | undefined {
  if (isPresetProfileId(profileId)) {
    return getPresetClipProfile(presetThemeIdFromProfileId(profileId));
  }
  return prefs.appearance.savedProfiles?.find((profile) => profile.id === profileId);
}

/** Legacy saved profiles without voiceEffectConfig compare as voice-off. */
export function voiceEffectMatchesProfile(
  live: VoiceEffectConfig | undefined,
  profile: ClipProfile,
): boolean {
  if (isPresetProfileId(profile.id)) {
    return true;
  }

  const liveNorm = normalizeVoiceEffectConfig(live);
  const snapshotNorm =
    profile.voiceEffectConfig != null
      ? normalizeVoiceEffectConfig(profile.voiceEffectConfig)
      : normalizeVoiceEffectConfig(DEFAULT_VOICE_EFFECT_CONFIG);
  return voiceEffectConfigsEqual(liveNorm, snapshotNorm);
}

/** Legacy saved profiles without transcriptConfig compare as subtitles-off. */
export function transcriptConfigMatchesProfile(
  live: TranscriptConfig | undefined,
  profile: ClipProfile,
): boolean {
  if (isPresetProfileId(profile.id)) {
    return true;
  }

  const liveNorm = normalizeTranscriptConfig(live);
  const snapshotNorm =
    profile.transcriptConfig != null
      ? normalizeTranscriptConfig(profile.transcriptConfig)
      : normalizeTranscriptConfig(DEFAULT_TRANSCRIPT_CONFIG);
  return transcriptConfigsEqual(liveNorm, snapshotNorm);
}

export function clipProfileMatchesLiveState(
  appearance: AppearancePreferences,
  voiceEffect: VoiceEffectConfig | undefined,
  transcriptConfig: TranscriptConfig | undefined,
  profile: ClipProfile,
): boolean {
  return (
    appearanceMatchesProfile(appearance, profile) &&
    voiceEffectMatchesProfile(voiceEffect, profile) &&
    transcriptConfigMatchesProfile(transcriptConfig, profile)
  );
}

/**
 * Studio exit / discard — subtitle prefs persist globally until Update profile (BUG-017).
 */
export function clipProfileMatchesLiveStateForStudioExit(
  appearance: AppearancePreferences,
  voiceEffect: VoiceEffectConfig | undefined,
  profile: ClipProfile,
): boolean {
  return (
    appearanceMatchesProfile(appearance, profile) &&
    voiceEffectMatchesProfile(voiceEffect, profile)
  );
}

export function appearanceMatchesProfile(
  appearance: AppearancePreferences,
  profile: ClipProfile,
): boolean {
  if ((appearance.activeCustomStyleId ?? null) !== (profile.customStyleId ?? null)) {
    return false;
  }

  let styleMatches = true;
  if (profile.customStyleId) {
    const savedStyle = appearance.savedCustomStyles?.find(
      (style) => style.id === profile.customStyleId,
    );
    styleMatches = savedStyle
      ? designOverridesMatch(appearance.designOverrides, savedStyle.designOverrides)
      : false;
  } else {
    styleMatches = designOverridesMatch(appearance.designOverrides, profile.designOverrides);
  }

  return (
    appearance.activeThemeId === profile.themeId &&
    (appearance.barAlignment ?? 'center') === profile.barAlignment &&
    (appearance.customBackgroundId ?? null) === (profile.customBackgroundId ?? null) &&
    (appearance.backgroundScaleMode ?? 'fill') === (profile.backgroundScaleMode ?? 'fill') &&
    (appearance.backgroundPosition ?? 'center') === (profile.backgroundPosition ?? 'center') &&
    styleMatches
  );
}

export function findMatchingClipProfile(prefs: UserPreferencesV1): ClipProfile | undefined {
  const profiles = prefs.appearance.savedProfiles ?? [];
  return profiles.find((profile) =>
    clipProfileMatchesLiveState(
      prefs.appearance,
      prefs.voiceEffect,
      prefs.transcriptConfig,
      profile,
    ),
  );
}

/** Recorder panel select value for a saved profile. */
export function profileSelectValue(profileId: string): string {
  return `profile:${profileId}`;
}

export function parseClipStyleSelectValue(value: string): { kind: 'profile'; profileId: string } | { kind: 'theme'; themeId: string } {
  if (value.startsWith('profile:')) {
    return { kind: 'profile', profileId: value.slice('profile:'.length) };
  }
  return { kind: 'theme', themeId: value };
}

export function resolveClipStyleSelectValue(prefs: UserPreferencesV1): string {
  const activeId = prefs.appearance.activeProfileId;
  if (activeId && getClipProfileById(prefs, activeId)) {
    return profileSelectValue(activeId);
  }
  const preset = getPresetClipProfile(prefs.appearance.activeThemeId);
  if (preset) return profileSelectValue(preset.id);
  return prefs.appearance.activeThemeId;
}