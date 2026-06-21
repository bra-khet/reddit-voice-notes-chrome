import {
  backgroundAssetExists,
  deleteBackgroundAsset,
  listBackgroundAssets,
  normalizeBackgroundAssetId,
} from './image-db';
import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import { saveAppearancePreferences } from '@/src/settings/user-preferences';

/** Collect every ImageDB id referenced by prefs (active appearance + saved profiles). */
export function collectReferencedBackgroundIds(prefs: UserPreferencesV1): Set<string> {
  const refs = new Set<string>();

  const activeId = normalizeBackgroundAssetId(prefs.appearance.customBackgroundId);
  if (activeId) refs.add(activeId);

  for (const profile of prefs.appearance.savedProfiles ?? []) {
    const profileId = normalizeBackgroundAssetId(profile.customBackgroundId);
    if (profileId) refs.add(profileId);
  }

  return refs;
}

function stripStaleBackgroundRefs(prefs: UserPreferencesV1, staleIds: Set<string>): UserPreferencesV1 {
  if (staleIds.size === 0) return prefs;

  const activeId = normalizeBackgroundAssetId(prefs.appearance.customBackgroundId);
  const nextActiveId = activeId && staleIds.has(activeId) ? null : prefs.appearance.customBackgroundId ?? null;

  const savedProfiles = (prefs.appearance.savedProfiles ?? []).map((profile) => {
    const profileBg = normalizeBackgroundAssetId(profile.customBackgroundId);
    if (!profileBg || !staleIds.has(profileBg)) return profile;
    return { ...profile, customBackgroundId: null };
  });

  return {
    ...prefs,
    appearance: {
      ...prefs.appearance,
      customBackgroundId: nextActiveId,
      savedProfiles,
    },
  };
}

/**
 * Drop prefs references to missing ImageDB records (e.g. manual DB clear, failed import).
 * Persists when changes are made.
 */
export async function reconcileBackgroundPreferences(
  prefs: UserPreferencesV1,
): Promise<UserPreferencesV1> {
  const refs = collectReferencedBackgroundIds(prefs);
  if (refs.size === 0) return prefs;

  const staleIds = new Set<string>();
  await Promise.all(
    [...refs].map(async (id) => {
      const exists = await backgroundAssetExists(id);
      if (!exists) staleIds.add(id);
    }),
  );

  if (staleIds.size === 0) return prefs;

  const cleaned = stripStaleBackgroundRefs(prefs, staleIds);
  return saveAppearancePreferences({
    customBackgroundId: cleaned.appearance.customBackgroundId ?? null,
    savedProfiles: cleaned.appearance.savedProfiles,
    activeProfileId: cleaned.appearance.activeProfileId,
    activeThemeId: cleaned.appearance.activeThemeId,
    barAlignment: cleaned.appearance.barAlignment,
  });
}

/**
 * Delete ImageDB blobs not referenced by any profile or active appearance.
 * Call after profile/background removal (pretty-7c).
 */
export async function pruneUnreferencedBackgrounds(prefs: UserPreferencesV1): Promise<number> {
  const refs = collectReferencedBackgroundIds(prefs);
  const stored = await listBackgroundAssets();
  let removed = 0;

  for (const asset of stored) {
    if (refs.has(asset.id)) continue;
    const deleted = await deleteBackgroundAsset(asset.id);
    if (deleted) removed += 1;
  }

  return removed;
}