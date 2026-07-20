import {
  BackgroundImportError,
  getBackgroundStorageSummary,
  importBackgroundAsset,
  listBackgroundAssets,
  MAX_SINGLE_IMAGE_BACKGROUND_BYTES,
  type BackgroundAssetMeta,
} from '@/src/storage/image-db';
import {
  deletePersonalBackgroundAsset,
  setActivePersonalBackground,
} from '@/src/settings/personal-background';
import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import {
  BUNDLED_USER_BACKGROUNDS,
  isBundledUserBackgroundId,
} from '@/src/theme/background-layout-presets';

const BACKGROUND_NONE = '' as const;
const ACCEPTED_BACKGROUND_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatAssetLabel(asset: BackgroundAssetMeta): string {
  const sizeKb = Math.max(1, Math.round(asset.byteSize / 1024));
  const dims =
    asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : '';
  // CHANGED: surface animated GIFs in the library label.
  // WHY: animated branch Phase 1 — users should see which backgrounds loop.
  const animated = asset.mediaKind === 'animated' ? ' · Animated' : '';
  return `${asset.displayName} (${sizeKb} KB${dims}${animated})`;
}

export function renderPersonalBackgroundFields(): string {
  return `
    <label class="popup__field">
      <span class="popup__field-label">Personal background</span>
      <select class="popup__select" data-background-select aria-label="Personal background"></select>
    </label>
    <div class="popup__background-actions">
      <button type="button" class="popup__profile-btn popup__profile-btn--save" data-upload-background>
        Upload image
      </button>
      <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-delete-background hidden>
        Delete image
      </button>
      <input
        type="file"
        accept="${ACCEPTED_BACKGROUND_TYPES}"
        data-background-file
        hidden
        aria-hidden="true"
      />
    </div>
    <p class="popup__micro" data-background-hint></p>
  `;
}

export interface PersonalBackgroundControls {
  sync(prefs: UserPreferencesV1): Promise<void>;
}

export function mountPersonalBackgroundControls(
  root: HTMLElement,
  onUpdated: (prefs: UserPreferencesV1) => void,
): PersonalBackgroundControls {
  const backgroundSelect = root.querySelector<HTMLSelectElement>('[data-background-select]')!;
  const uploadBtn = root.querySelector<HTMLButtonElement>('[data-upload-background]')!;
  const deleteBtn = root.querySelector<HTMLButtonElement>('[data-delete-background]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-background-file]')!;
  const hintEl = root.querySelector<HTMLElement>('[data-background-hint]')!;

  let assets: BackgroundAssetMeta[] = [];
  let busy = false;

  function setBusy(next: boolean): void {
    busy = next;
    uploadBtn.disabled = next;
    deleteBtn.disabled = next;
    backgroundSelect.disabled = next;
  }

  function populateBackgroundSelect(activeId: string | null): void {
    const selected = activeId ?? BACKGROUND_NONE;
    backgroundSelect.replaceChildren();

    const noneOption = document.createElement('option');
    noneOption.value = BACKGROUND_NONE;
    noneOption.textContent = 'None (theme default)';
    backgroundSelect.append(noneOption);

    for (const background of BUNDLED_USER_BACKGROUNDS) {
      const option = document.createElement('option');
      option.value = background.id;
      option.textContent = `${background.label} (included)`;
      backgroundSelect.append(option);
    }

    for (const asset of assets) {
      const option = document.createElement('option');
      option.value = asset.id;
      option.textContent = formatAssetLabel(asset);
      backgroundSelect.append(option);
    }

    const hasActivePersonal = assets.some((asset) => asset.id === selected);
    const hasActiveBundled = isBundledUserBackgroundId(selected);
    backgroundSelect.value = hasActivePersonal || hasActiveBundled ? selected : BACKGROUND_NONE;
    deleteBtn.hidden = !hasActivePersonal;
  }

  async function refreshStorageHint(): Promise<void> {
    const summary = await getBackgroundStorageSummary();
    const usedMb = (summary.totalBytes / (1024 * 1024)).toFixed(1);
    const maxMb = Math.round(summary.maxTotalBytes / (1024 * 1024));
    hintEl.textContent =
      `JPEG, PNG, WebP, or GIF up to ${formatMegabytes(MAX_SINGLE_IMAGE_BACKGROUND_BYTES)}. ` +
      `Library: ${summary.count}/${summary.maxCount} images · ${usedMb}/${maxMb} MB used. ` +
      'Personal backgrounds replace the theme backdrop; bars and colors still come from the clip style.';
  }

  async function reloadAssets(activeId: string | null): Promise<void> {
    assets = await listBackgroundAssets();
    populateBackgroundSelect(activeId);
    await refreshStorageHint();
  }

  backgroundSelect.addEventListener('change', () => {
    if (busy) return;
    const value = backgroundSelect.value;
    setBusy(true);
    void setActivePersonalBackground(value || null)
      .then(onUpdated)
      .finally(() => setBusy(false));
  });

  uploadBtn.addEventListener('click', () => {
    if (busy) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || busy) return;

    setBusy(true);
    void importBackgroundAsset(file)
      .then((meta) => setActivePersonalBackground(meta.id))
      .then(onUpdated)
      .catch((error: unknown) => {
        const message =
          error instanceof BackgroundImportError || error instanceof Error
            ? error.message
            : 'Could not import background.';
        window.alert(message);
      })
      .finally(() => setBusy(false));
  });

  deleteBtn.addEventListener('click', () => {
    if (busy) return;
    const assetId = backgroundSelect.value;
    if (!assetId || assetId === BACKGROUND_NONE) return;

    const asset = assets.find((entry) => entry.id === assetId);
    const label = asset?.displayName ?? 'this image';
    if (!window.confirm(`Delete "${label}" from your library? Saved profiles using it will fall back to theme backgrounds.`)) {
      return;
    }

    setBusy(true);
    void deletePersonalBackgroundAsset(assetId)
      .then(onUpdated)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not delete background.';
        window.alert(message);
      })
      .finally(() => setBusy(false));
  });

  return {
    async sync(prefs) {
      await reloadAssets(prefs.appearance.customBackgroundId ?? null);
    },
  };
}
