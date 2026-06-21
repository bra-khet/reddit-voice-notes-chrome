import { listThemePresets } from '@/src/theme';
import {
  appearanceMatchesProfile,
  getClipProfileById,
  profileSelectValue,
  PROFILE_SELECT_CUSTOM,
  resolveClipStyleSelectValue,
} from '@/src/settings/clip-profiles';
import type { UserPreferencesV1 } from '@/src/settings/user-preferences';

export function populateProfileSelect(select: HTMLSelectElement, prefs: UserPreferencesV1): void {
  const profiles = prefs.appearance.savedProfiles ?? [];
  const activeId = prefs.appearance.activeProfileId;
  select.replaceChildren();

  const customOption = document.createElement('option');
  customOption.value = PROFILE_SELECT_CUSTOM;
  customOption.textContent = 'Custom (unsaved)';
  select.append(customOption);

  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    const dirty =
      profile.id === activeId && !appearanceMatchesProfile(prefs.appearance, profile);
    option.textContent = dirty ? `${profile.name} · unsaved` : profile.name;
    select.append(option);
  }

  const activeProfile = activeId ? getClipProfileById(prefs, activeId) : undefined;
  select.value = activeProfile ? activeId! : PROFILE_SELECT_CUSTOM;
}

export function populateRecorderClipStyleSelect(
  select: HTMLSelectElement,
  prefs: UserPreferencesV1,
): void {
  const profiles = prefs.appearance.savedProfiles ?? [];
  select.replaceChildren();

  if (profiles.length > 0) {
    const profileGroup = document.createElement('optgroup');
    profileGroup.label = 'Saved profiles';
    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profileSelectValue(profile.id);
      option.textContent = profile.name;
      profileGroup.append(option);
    }
    select.append(profileGroup);
  }

  const themeGroup = document.createElement('optgroup');
  themeGroup.label = 'Clip styles';
  for (const preset of listThemePresets()) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    themeGroup.append(option);
  }
  select.append(themeGroup);

  select.value = resolveClipStyleSelectValue(prefs);
}