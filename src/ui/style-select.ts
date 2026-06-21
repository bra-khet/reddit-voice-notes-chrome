import { listThemePresets } from '@/src/theme';
import {
  appearanceMatchesCustomStyle,
  isCustomStyleDirty,
  resolveStyleSelectValue,
  STYLE_SELECT_CUSTOM,
} from '@/src/settings/custom-styles';
import type { UserPreferencesV1 } from '@/src/settings/user-preferences';

export function populateDesignStudioStyleSelect(
  select: HTMLSelectElement,
  prefs: UserPreferencesV1,
): void {
  const savedStyles = prefs.appearance.savedCustomStyles ?? [];
  select.replaceChildren();

  const presetGroup = document.createElement('optgroup');
  presetGroup.label = 'Clip styles';
  for (const preset of listThemePresets()) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    presetGroup.append(option);
  }
  select.append(presetGroup);

  const customGroup = document.createElement('optgroup');
  customGroup.label = 'Custom colors';
  const customOption = document.createElement('option');
  customOption.value = STYLE_SELECT_CUSTOM;
  customOption.textContent = 'Custom (unsaved)';
  customGroup.append(customOption);

  for (const style of savedStyles) {
    const option = document.createElement('option');
    option.value = style.id;
    const dirty =
      style.id === prefs.appearance.activeCustomStyleId &&
      isCustomStyleDirty(prefs.appearance);
    option.textContent = dirty ? `${style.name} · unsaved` : style.name;
    customGroup.append(option);
  }

  select.append(customGroup);
  select.value = resolveStyleSelectValue(prefs);
}

export function isStylePanelVisible(prefs: UserPreferencesV1): boolean {
  if (prefs.appearance.activeCustomStyleId) return true;
  if (prefs.appearance.designOverrides?.barColor) return true;
  return false;
}

export function styleSelectShowsCustomColors(prefs: UserPreferencesV1): boolean {
  return isStylePanelVisible(prefs);
}

export { appearanceMatchesCustomStyle, isCustomStyleDirty, resolveStyleSelectValue };