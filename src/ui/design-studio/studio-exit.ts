import {
  clipProfileMatchesLiveState,
  clipProfileMatchesLiveStateForStudioExit,
  getClipProfileById,
} from '@/src/settings/clip-profiles';
import { normalizeTranscriptConfig } from '@/src/transcription/types';
import { isPresetProfileId } from '@/src/settings/preset-profiles';
import { isCustomStyleDirty } from '@/src/settings/custom-styles';
import {
  applyClipProfile,
  applyCustomClipStyle,
  loadUserPreferences,
  saveAppearancePreferences,
  saveTranscriptPreferences,
  updateActiveClipProfile,
  updateActiveCustomStyle,
  type AppearancePreferences,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';

export function hasStudioUnsavedChanges(prefs: UserPreferencesV1): boolean {
  if (prefs.appearance.activeProfileId) {
    const profile = getClipProfileById(prefs, prefs.appearance.activeProfileId);
    // BUG FIX: subtitle toggle reverts on studio exit (BUG-017)
    // Fix: exit modal / discard ignore transcript drift — global transcriptConfig persists until Update profile.
    if (
      profile &&
      !clipProfileMatchesLiveStateForStudioExit(
        prefs.appearance,
        prefs.voiceEffect,
        profile,
      )
    ) {
      return true;
    }
  }
  if (
    prefs.appearance.activeCustomStyleId &&
    isCustomStyleDirty(prefs.appearance)
  ) {
    return true;
  }
  return false;
}

/** Restore saved profile/style snapshot — discards live studio edits in storage. */
export async function discardStudioUnsavedChanges(
  entryAppearance: AppearancePreferences,
): Promise<UserPreferencesV1> {
  const current = await loadUserPreferences();
  const profileId = current.appearance.activeProfileId;
  // BUG FIX: subtitle toggle reverts on studio exit (BUG-017)
  // Fix: preserve live transcript prefs when reverting a dirty profile snapshot on discard.
  const preservedTranscript = normalizeTranscriptConfig(current.transcriptConfig);

  if (profileId) {
    const profile = getClipProfileById(current, profileId);
    if (
      profile &&
      !clipProfileMatchesLiveStateForStudioExit(
        current.appearance,
        current.voiceEffect,
        profile,
      )
    ) {
      await applyClipProfile(profileId);
      return saveTranscriptPreferences(preservedTranscript);
    }
  }

  const styleId = current.appearance.activeCustomStyleId;
  if (styleId && isCustomStyleDirty(current.appearance)) {
    return applyCustomClipStyle(styleId);
  }

  return saveAppearancePreferences(entryAppearance);
}

export function shouldPromptStyleSaveWithProfileUpdate(prefs: UserPreferencesV1): boolean {
  const profileId = prefs.appearance.activeProfileId;
  if (!profileId || isPresetProfileId(profileId)) return false;
  return Boolean(
    prefs.appearance.activeCustomStyleId && isCustomStyleDirty(prefs.appearance),
  );
}

/** Save style edits first when requested — profile snapshots reference saved style colors. */
export async function updateActiveClipProfileWithStyleOption(
  saveStyleFirst: boolean,
): Promise<UserPreferencesV1> {
  if (saveStyleFirst) {
    const current = await loadUserPreferences();
    if (
      current.appearance.activeCustomStyleId &&
      isCustomStyleDirty(current.appearance)
    ) {
      await updateActiveCustomStyle();
    }
  }
  return updateActiveClipProfile();
}

/** Persist dirty profile and/or custom style before closing studio. */
export async function saveStudioUnsavedChanges(): Promise<UserPreferencesV1> {
  let prefs = await loadUserPreferences();

  if (
    prefs.appearance.activeCustomStyleId &&
    isCustomStyleDirty(prefs.appearance)
  ) {
    prefs = await updateActiveCustomStyle();
  }

  if (prefs.appearance.activeProfileId) {
    const profileId = prefs.appearance.activeProfileId;
    const profile = getClipProfileById(prefs, profileId);
    if (
      profile &&
      !clipProfileMatchesLiveState(
        prefs.appearance,
        prefs.voiceEffect,
        prefs.transcriptConfig,
        profile,
      )
    ) {
      if (isPresetProfileId(profileId)) {
        return prefs;
      }
      return updateActiveClipProfile();
    }
  }

  return prefs;
}