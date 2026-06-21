import { isCustomStyleDirty } from '@/src/settings/custom-styles';
import {
  saveCurrentAsClipProfile,
  saveCurrentAsCustomStyle,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';
import { shouldPromptStyleSaveWithProfileUpdate } from '@/src/ui/design-studio/studio-exit';

export const SAVE_TO_NEW_LABEL = 'Save to new';

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

export function promptNameForSaveAsNew(entityLabel: string): string | null {
  const name = window.prompt(`Name for the new ${entityLabel}:`);
  if (name === null) return null;
  return name;
}

export function isStyleSaveToNewAvailable(prefs: UserPreferencesV1): boolean {
  return Boolean(
    prefs.appearance.activeCustomStyleId && isCustomStyleDirty(prefs.appearance),
  );
}