import {
  CUSTOM_STYLE_BASE_THEME_ID,
  DEFAULT_CUSTOM_STYLE_OVERRIDES,
  normalizeDesignOverrides,
  type DesignOverrides,
} from '@/src/theme/design-overrides';
import {
  DEFAULT_USER_BACKGROUND_LAYOUT,
  normalizeUserBackgroundLayout,
} from '@/src/theme/background-layout';
import type { AppearancePreferences } from '@/src/settings/user-preferences';
import type {
  BackgroundImagePosition,
  BackgroundScaleMode,
  NormalizedUserBackgroundLayout,
} from '@/src/theme/types';

export type SettingsResetMode = 'default' | 'blank';

export interface BackgroundResetTarget {
  customBackgroundId: string | null;
  backgroundScaleMode: BackgroundScaleMode;
  backgroundPosition: BackgroundImagePosition;
  backgroundLayout: NormalizedUserBackgroundLayout;
}

export interface StyleResetTarget {
  activeThemeId: string;
  activeCustomStyleId: string | null;
  designOverrides: DesignOverrides | null;
}

export interface SettingsResetChoice {
  mode: SettingsResetMode;
  label: string;
  description: string;
  confirmLabel: string;
}

export interface SettingsResetDialogCopy {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  triggerLabel: string;
  dockTitle: string;
  dockDescription: string;
  choices: readonly [SettingsResetChoice, SettingsResetChoice];
}

export interface SettingsResetDialogHandle {
  dispose(): void;
}

export interface SettingsResetDialogOptions {
  fallbackFocus?: () => HTMLElement | null;
}

export const BACKGROUND_RESET_COPY: SettingsResetDialogCopy = {
  id: 'background',
  eyebrow: 'Background only',
  title: 'Reset this background?',
  description:
    'Choose what returns. Your profile, transcript, current take, and uploaded files stay untouched.',
  triggerLabel: 'Reset background…',
  dockTitle: 'Return path',
  dockDescription: 'Restore the darkroom or step back to the active theme.',
  choices: [
    {
      mode: 'default',
      label: 'Product layout',
      description:
        'Keep this image or GIF. Restore centered Fill, normal blend, default dim, no blur or Holo, and normal GIF motion.',
      confirmLabel: 'Restore layout',
    },
    {
      mode: 'blank',
      label: 'Theme background',
      description:
        'Clear the personal-background override and reveal the active style’s theme. The upload remains in your library.',
      confirmLabel: 'Use theme background',
    },
  ],
};

export const STYLE_RESET_COPY: SettingsResetDialogCopy = {
  id: 'style',
  eyebrow: 'Style only',
  title: 'Reset this Style?',
  description:
    'Choose the source to return to. Your saved Style, profile name, Background, Voice, Subtitles, transcript, and current take stay untouched.',
  triggerLabel: 'Reset Style…',
  dockTitle: 'Return path',
  dockDescription: 'Rewind this instrument or drop back to its bundled stage.',
  choices: [
    {
      mode: 'default',
      label: 'Style source',
      description:
        'Restore the selected saved Style snapshot. An unsaved Custom Style returns to the starter color and visual controls.',
      confirmLabel: 'Restore Style',
    },
    {
      mode: 'blank',
      label: 'Base preset',
      description:
        'Detach the custom Style and clear its optional overrides. Saved Styles remain available in your collection.',
      confirmLabel: 'Use base preset',
    },
  ],
};

/**
 * CHANGED: Reset targets are resolved at one normalized seam before UI or storage sees them.
 * WHY: "default" must retain the selected media while "blank" removes only its optional reference.
 */
export function resolveBackgroundResetTarget(
  mode: SettingsResetMode,
  currentBackgroundId: string | null,
): BackgroundResetTarget {
  const backgroundLayout = normalizeUserBackgroundLayout(DEFAULT_USER_BACKGROUND_LAYOUT);
  return {
    customBackgroundId: mode === 'blank' ? null : currentBackgroundId,
    backgroundScaleMode: backgroundLayout.scaleMode,
    backgroundPosition: backgroundLayout.position,
    backgroundLayout,
  };
}

/**
 * CHANGED: Style reset resolves either the authored source or the normal bundled-theme fallback.
 * WHY: restoring a saved snapshot and detaching its optional overrides are distinct, non-destructive actions.
 */
export function resolveStyleResetTarget(
  mode: SettingsResetMode,
  appearance: Pick<
    AppearancePreferences,
    'activeThemeId' | 'activeCustomStyleId' | 'designOverrides' | 'savedCustomStyles'
  >,
): StyleResetTarget {
  const savedStyle = appearance.activeCustomStyleId
    ? appearance.savedCustomStyles?.find((style) => style.id === appearance.activeCustomStyleId)
    : undefined;

  if (mode === 'blank') {
    return {
      activeThemeId: savedStyle?.baseThemeId ?? appearance.activeThemeId,
      activeCustomStyleId: null,
      designOverrides: null,
    };
  }

  const sourceOverrides = normalizeDesignOverrides(
    savedStyle?.designOverrides ?? DEFAULT_CUSTOM_STYLE_OVERRIDES,
  );
  return {
    activeThemeId: savedStyle?.baseThemeId ?? CUSTOM_STYLE_BASE_THEME_ID,
    activeCustomStyleId: savedStyle?.id ?? null,
    designOverrides: sourceOverrides ?? { ...DEFAULT_CUSTOM_STYLE_OVERRIDES },
  };
}

function renderChoice(copy: SettingsResetChoice, groupName: string, checked: boolean): string {
  return `
    <label class="studio__settings-reset-choice">
      <input
        type="radio"
        name="${groupName}"
        value="${copy.mode}"
        ${checked ? 'checked' : ''}
      />
      <span class="studio__settings-reset-choice-mark" aria-hidden="true"></span>
      <span class="studio__settings-reset-choice-copy">
        <strong>${copy.label}</strong>
        <small>${copy.description}</small>
      </span>
    </label>
  `;
}

export function renderSettingsResetControl(copy: SettingsResetDialogCopy): string {
  const titleId = `studio-${copy.id}-reset-title`;
  const descriptionId = `studio-${copy.id}-reset-description`;
  const groupName = `studio-${copy.id}-reset-mode`;
  return `
    <section class="studio__settings-reset-dock" aria-label="${copy.dockTitle}">
      <span class="studio__settings-reset-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5.2 8.4A8 8 0 1 1 4 14.7" />
          <path d="M4.8 3.8v5h5" />
        </svg>
      </span>
      <span class="studio__settings-reset-dock-copy">
        <strong>${copy.dockTitle}</strong>
        <small>${copy.dockDescription}</small>
      </span>
      <button
        type="button"
        class="studio__settings-reset-trigger"
        data-settings-reset-trigger="${copy.id}"
      >
        ${copy.triggerLabel}
      </button>
    </section>
    <dialog
      class="studio__settings-reset-dialog"
      data-settings-reset-dialog="${copy.id}"
      aria-labelledby="${titleId}"
      aria-describedby="${descriptionId}"
    >
      <form class="studio__settings-reset-sheet" method="dialog" data-settings-reset-form>
        <span class="studio__settings-reset-rail" aria-hidden="true"></span>
        <header class="studio__settings-reset-head">
          <span class="studio__settings-reset-eyebrow">${copy.eyebrow}</span>
          <h3 id="${titleId}">${copy.title}</h3>
          <p id="${descriptionId}">${copy.description}</p>
        </header>
        <fieldset class="studio__settings-reset-choices">
          <legend class="studio__sr-only">Reset destination</legend>
          ${renderChoice(copy.choices[0], groupName, true)}
          ${renderChoice(copy.choices[1], groupName, false)}
        </fieldset>
        <output class="studio__settings-reset-status" data-settings-reset-status aria-live="polite"></output>
        <div class="studio__settings-reset-actions">
          <button type="button" class="popup__button popup__button--secondary" data-settings-reset-cancel>
            Keep editing
          </button>
          <button type="submit" class="popup__profile-btn popup__profile-btn--save" data-settings-reset-confirm>
            ${copy.choices[0].confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  `;
}

export function mountSettingsResetDialog(
  root: HTMLElement,
  copy: SettingsResetDialogCopy,
  onConfirm: (mode: SettingsResetMode) => void | Promise<void>,
  options: SettingsResetDialogOptions = {},
): SettingsResetDialogHandle {
  const trigger = root.querySelector<HTMLButtonElement>(
    `[data-settings-reset-trigger="${copy.id}"]`,
  )!;
  const dialog = root.querySelector<HTMLDialogElement>(
    `[data-settings-reset-dialog="${copy.id}"]`,
  )!;
  const form = dialog.querySelector<HTMLFormElement>('[data-settings-reset-form]')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-settings-reset-cancel]')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-settings-reset-confirm]')!;
  const status = dialog.querySelector<HTMLOutputElement>('[data-settings-reset-status]')!;
  const radios = [...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  let busy = false;

  const selectedMode = (): SettingsResetMode =>
    (radios.find((radio) => radio.checked)?.value as SettingsResetMode | undefined) ?? 'default';

  const syncConfirmCopy = (): void => {
    const selected =
      copy.choices.find((choice) => choice.mode === selectedMode()) ?? copy.choices[0];
    confirm.textContent = busy ? 'Applying…' : selected.confirmLabel;
  };

  const close = (): void => {
    if (!busy && dialog.open) dialog.close();
  };

  const onTrigger = (): void => {
    status.value = '';
    radios[0]!.checked = true;
    busy = false;
    syncConfirmCopy();
    dialog.showModal();
    radios[0]!.focus();
  };

  const onRadioChange = (): void => {
    status.value = '';
    syncConfirmCopy();
  };

  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    confirm.disabled = true;
    cancel.disabled = true;
    radios.forEach((radio) => {
      radio.disabled = true;
    });
    syncConfirmCopy();
    void Promise.resolve()
      .then(() => onConfirm(selectedMode()))
      .then(() => dialog.close())
      .catch((error: unknown) => {
        status.value = error instanceof Error ? error.message : 'Could not reset this setting.';
      })
      .finally(() => {
        busy = false;
        confirm.disabled = false;
        cancel.disabled = false;
        radios.forEach((radio) => {
          radio.disabled = false;
        });
        syncConfirmCopy();
      });
  };

  const onDialogClick = (event: MouseEvent): void => {
    if (event.target === dialog) close();
  };

  const onCancel = (event: Event): void => {
    if (busy) event.preventDefault();
  };

  const onClose = (): void => {
    // CHANGED: conditional reset docks return focus to their panel's primary selector when a reset hides the trigger.
    // WHY: clearing Style overrides removes its reset dock, so focusing the departed control would strand keyboard users.
    const triggerIsVisible = !trigger.hidden && !trigger.closest<HTMLElement>('[hidden]');
    (triggerIsVisible ? trigger : options.fallbackFocus?.())?.focus();
  };

  trigger.addEventListener('click', onTrigger);
  cancel.addEventListener('click', close);
  form.addEventListener('submit', onSubmit);
  radios.forEach((radio) => radio.addEventListener('change', onRadioChange));
  dialog.addEventListener('click', onDialogClick);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onClose);

  return {
    dispose() {
      trigger.removeEventListener('click', onTrigger);
      cancel.removeEventListener('click', close);
      form.removeEventListener('submit', onSubmit);
      radios.forEach((radio) => radio.removeEventListener('change', onRadioChange));
      dialog.removeEventListener('click', onDialogClick);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
    },
  };
}
