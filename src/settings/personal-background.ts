import { pruneUnreferencedBackgrounds } from '@/src/storage/background-refs';
import { deleteBackgroundAsset, normalizeBackgroundAssetId } from '@/src/storage/image-db';
import {
  loadUserPreferences,
  saveAppearancePreferences,
  type UserPreferencesV1,
} from '@/src/settings/user-preferences';

/** Remove a stored background and clear prefs/profile refs that pointed at it (pretty-7c). */
export async function deletePersonalBackgroundAsset(assetId: string): Promise<UserPreferencesV1> {
  const normalized = normalizeBackgroundAssetId(assetId);
  if (!normalized) {
    throw new Error('Invalid background id.');
  }

  const current = await loadUserPreferences();
  const nextActiveId =
    normalizeBackgroundAssetId(current.appearance.customBackgroundId) === normalized
      ? null
      : current.appearance.customBackgroundId ?? null;

  const savedProfiles = (current.appearance.savedProfiles ?? []).map((profile) => {
    if (normalizeBackgroundAssetId(profile.customBackgroundId) !== normalized) return profile;
    return { ...profile, customBackgroundId: null };
  });

  await deleteBackgroundAsset(normalized);

  const prefs = await saveAppearancePreferences({
    customBackgroundId: nextActiveId,
    savedProfiles,
  });

  await pruneUnreferencedBackgrounds(prefs);
  return prefs;
}

export async function setActivePersonalBackground(
  assetId: string | null,
): Promise<UserPreferencesV1> {
  return saveAppearancePreferences({
    customBackgroundId: normalizeBackgroundAssetId(assetId),
    activeProfileId: null,
  });
}