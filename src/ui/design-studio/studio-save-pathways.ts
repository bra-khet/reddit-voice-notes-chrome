import { isPresetProfileId } from '@/src/settings/preset-profiles';
import {
  saveCurrentAsClipProfile,
  saveCurrentAsCustomStyle,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { shouldPromptStyleSaveWithProfileUpdate } from '@/src/ui/design-studio/studio-exit';

export const SAVE_TO_NEW_LABEL = 'Save to new';
export const CLONE_LABEL = 'Clone';

/** Green fork button: Clone when clean, Save to new when dirty — same action, different entry path. */
export function forkButtonLabel(hasUnsavedEdits: boolean): string {
  return hasUnsavedEdits ? SAVE_TO_NEW_LABEL : CLONE_LABEL;
}

export function canForkActiveProfile(prefs: UserPreferencesV1): boolean {
  const profileId = prefs.appearance.activeProfileId;
  return Boolean(profileId && !isPresetProfileId(profileId));
}

export function canForkActiveStyle(prefs: UserPreferencesV1): boolean {
  return Boolean(prefs.appearance.activeCustomStyleId);
}

/** How to handle unsaved custom style colors when saving a profile as a new copy. */
export type ProfileStyleRollup = 'new-style' | 'embed-on-profile' | 'keep-style-ref';

/**
 * Ask how to bundle dirty style edits into a save-as-new profile action.
 * Returns null when the user cancels the flow.
 */
export function promptStyleRollupForSaveNewProfile(prefs: UserPreferencesV1): ProfileStyleRollup | null {
  if (!shouldPromptStyleSaveWithProfileUpdate(prefs)) {
    return 'keep-style-ref';
  }

  const styleName =
    prefs.appearance.savedCustomStyles?.find(
      (style) => style.id === prefs.appearance.activeCustomStyleId,
    )?.name ?? 'This style';

  const saveNewStyle = window.confirm(
    `"${styleName}" has unsaved color edits. Save them as a new style in the new profile too?`,
  );
  if (saveNewStyle) {
    return 'new-style';
  }

  const embedOnProfile = window.confirm(
    `Save the current colors on the new profile only (without changing "${styleName}")?`,
  );
  if (embedOnProfile) {
    return 'embed-on-profile';
  }

  return null;
}

export async function saveNewClipProfileFromStudio(
  profileName: string,
  rollup: ProfileStyleRollup,
  styleName?: string,
): Promise<UserPreferencesV1> {
  if (rollup === 'new-style') {
    const trimmedStyle = styleName?.trim();
    if (!trimmedStyle) {
      throw new Error('Enter a style name.');
    }
    await saveCurrentAsCustomStyle(trimmedStyle);
  }

  return saveCurrentAsClipProfile(profileName, {
    embedDirtyStyleOverrides: rollup === 'embed-on-profile',
  });
}

export function promptNameForFork(entityLabel: string, cloning: boolean): string | null {
  const name = window.prompt(
    cloning ? `Name for the cloned ${entityLabel}:` : `Name for the new ${entityLabel}:`,
  );
  if (name === null) return null;
  return name;
}

/** Clone clean snapshot, or fork with optional dirty style roll-up. */
export async function forkActiveClipProfileFromStudio(
  prefs: UserPreferencesV1,
  profileName: string,
  profileDirty: boolean,
): Promise<UserPreferencesV1> {
  if (!profileDirty) {
    return saveCurrentAsClipProfile(profileName);
  }

  const rollup = promptStyleRollupForSaveNewProfile(prefs);
  if (rollup === null) {
    throw new DOMException('Profile fork cancelled.', 'AbortError');
  }

  let styleName: string | undefined;
  if (rollup === 'new-style') {
    const prompted = promptNameForFork('style', false);
    if (prompted === null) {
      throw new DOMException('Profile fork cancelled.', 'AbortError');
    }
    styleName = prompted;
  }

  return saveNewClipProfileFromStudio(profileName, rollup, styleName);
}