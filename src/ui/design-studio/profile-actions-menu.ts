// CHANGED: Profile management uses one host-neutral menu/dialog controller, import strategy sheet, and adjacent dirty-reset key.
// WHY: the Studio needs compact Save/recover/transfer choices and keyboard-complete management without duplicating storage policy.

import type { UserPreferencesImportStrategy } from '@/src/settings/user-preferences';

export type CreateProfileSource = 'current' | 'defaults';

export interface ProfileActionsState {
  activeProfileName: string | null;
  profileNames: readonly string[];
  hasSavedProfile: boolean;
  profileDirty: boolean;
  hasResettableChanges: boolean;
  canAddProfile: boolean;
}

export interface ProfileActionsCallbacks {
  onCreate(name: string, source: CreateProfileSource): Promise<void>;
  onRename(name: string): Promise<void>;
  onClone(name: string): Promise<void>;
  onReset(): Promise<void>;
  onDelete(): Promise<void>;
  onExport(): void | Promise<void>;
  onImport(strategy: UserPreferencesImportStrategy): void;
}

export interface ProfileActionsHandle {
  sync(state: ProfileActionsState): void;
  openCreateFromCurrent(): void;
  close(): void;
  dispose(): void;
}

export interface ProfileSaveButtonState {
  hasSavedProfile: boolean;
  profileDirty: boolean;
  canAddProfile: boolean;
  confirmationPending: boolean;
}

export interface ProfileSaveButtonView {
  visible: boolean;
  disabled: boolean;
  confirmationPending: boolean;
}

export interface ProfileActionsView {
  cloneLabel: 'Clone profile' | 'Save as new profile';
  cloneDescription: string;
  manageDisabled: boolean;
  addDisabled: boolean;
  resetDisabled: boolean;
  resetLabel: string;
  resetTitle: string;
}

type ProfileAction = 'add' | 'import' | 'rename' | 'clone' | 'export' | 'delete';
type ProfileDialogMode = 'create' | 'rename' | 'clone' | 'delete' | 'import';

const PROFILE_NAME_MAX_LENGTH = 40;

function normalizedNameSet(names: readonly string[]): Set<string> {
  return new Set(names.map((name) => name.trim().toLocaleLowerCase()));
}

function nameWithSuffix(base: string, suffix: string): string {
  const available = Math.max(1, PROFILE_NAME_MAX_LENGTH - suffix.length);
  return `${base.slice(0, available).trimEnd()}${suffix}`;
}

export function nextAvailableProfileCopyName(
  activeName: string,
  profileNames: readonly string[],
): string {
  const existing = normalizedNameSet(profileNames);
  const base = activeName.replace(/\s+\(copy \d+\)$/i, '').trim() || 'Profile';
  for (let copyNumber = 1; copyNumber < 10_000; copyNumber += 1) {
    const candidate = nameWithSuffix(base, ` (copy ${copyNumber})`);
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return nameWithSuffix(base, ` (copy ${Date.now()})`);
}

export function nextAvailableProfileName(
  baseName: string,
  profileNames: readonly string[],
): string {
  const existing = normalizedNameSet(profileNames);
  const trimmed = baseName.trim().slice(0, PROFILE_NAME_MAX_LENGTH) || 'New profile';
  if (!existing.has(trimmed.toLocaleLowerCase())) return trimmed;
  for (let number = 2; number < 10_000; number += 1) {
    const candidate = nameWithSuffix(trimmed, ` ${number}`);
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return nameWithSuffix(trimmed, ` ${Date.now()}`);
}

// BUG FIX: Profile Reset looked busy while clean and could not restore Custom defaults
// Fix: Keep the reserved reset key visible, expose an honest disabled state, and describe its saved-snapshot or product-default target.
// Sync: mount-clip-studio.ts; profile-actions.css; scripts/test-profile-actions.mjs
export function resolveProfileActionsView(
  state: ProfileActionsState,
): ProfileActionsView {
  const resetDisabled = !state.hasResettableChanges;
  return {
    cloneLabel: state.profileDirty ? 'Save as new profile' : 'Clone profile',
    cloneDescription: state.profileDirty
      ? 'Keep the original and save these edits separately'
      : 'Create an independent copy of this profile',
    manageDisabled: !state.hasSavedProfile,
    addDisabled: !state.canAddProfile,
    resetDisabled,
    resetLabel: state.hasSavedProfile
      ? 'Reset unsaved profile changes'
      : 'Restore Custom profile defaults',
    resetTitle: resetDisabled
      ? state.hasSavedProfile
        ? 'Profile matches saved settings'
        : 'Custom profile already uses product defaults'
      : state.hasSavedProfile
        ? 'Reset to saved profile'
        : 'Restore product defaults',
  };
}

// BUG FIX: Custom (unsaved) profiles had no discoverable primary save action
// Fix: Unsaved setups now share the reserved Save slot and use the existing Add-current flow; only the profile cap disables them.
// Sync: mount-clip-studio.ts; scripts/test-profile-actions.mjs
export function resolveProfileSaveButtonView(
  state: ProfileSaveButtonState,
): ProfileSaveButtonView {
  if (!state.profileDirty && !state.confirmationPending) {
    return {
      visible: false,
      disabled: true,
      confirmationPending: false,
    };
  }

  if (!state.hasSavedProfile) {
    return {
      visible: state.profileDirty,
      disabled: !state.canAddProfile,
      confirmationPending: false,
    };
  }

  return {
    visible: true,
    disabled: false,
    confirmationPending: state.confirmationPending,
  };
}

function renderActionIcon(action: ProfileAction): string {
  const paths: Record<ProfileAction, string> = {
    add: '<path d="M12 5v14M5 12h14"/><path d="M4 4h16v16H4z"/>',
    import:
      '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/>',
    rename:
      '<path d="m4 17-.8 3.8L7 20l10.8-10.8-3-3L4 17Z"/><path d="m13.8 7.2 3 3"/>',
    clone:
      '<rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    export:
      '<path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M5 14v6h14v-6"/>',
    delete:
      '<path d="M4 7h16M9 3h6l1 4H8l1-4Z"/><path d="m7 7 1 14h8l1-14M10 11v6m4-6v6"/>',
  };
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${paths[action]}
    </svg>
  `;
}

function renderMenuItem(
  action: ProfileAction,
  label: string,
  description: string,
): string {
  return `
    <button
      type="button"
      class="studio__profile-menu-item${action === 'delete' ? ' studio__profile-menu-item--danger' : ''}"
      role="menuitem"
      data-profile-action="${action}"
    >
      <span class="studio__profile-menu-icon">${renderActionIcon(action)}</span>
      <span class="studio__profile-menu-copy">
        <strong data-profile-action-label="${action}">${label}</strong>
        <small data-profile-action-description="${action}">${description}</small>
      </span>
      <span class="studio__profile-menu-arrow" aria-hidden="true">›</span>
    </button>
  `;
}

export function renderProfileActionsMarkup(): string {
  return `
    <div class="studio__profile-save-slot">
      <button
        type="button"
        class="popup__profile-btn popup__profile-btn--save studio__profile-save-btn"
        data-save-profile
        hidden
      >
        Save changes
      </button>
    </div>
    <!-- BUG FIX: Profile Reset looked busy while clean and could not restore Custom defaults. -->
    <!-- Fix: Keep one visibly dormant reset key that activates for either saved-snapshot reversion or Custom product defaults. -->
    <!-- Sync: mount-clip-studio.ts; profile-actions.css; scripts/test-profile-actions.mjs -->
    <div class="studio__profile-reset-slot">
      <button
        type="button"
        class="studio__profile-reset-btn"
        data-reset-profile
        aria-label="Reset unsaved profile changes"
        title="Reset profile changes"
        disabled
      >
        <span class="studio__settings-reset-glyph studio__profile-reset-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5.2 8.4A8 8 0 1 1 4 14.7" />
            <path d="M4.8 3.8v5h5" />
          </svg>
        </span>
      </button>
    </div>
    <div class="studio__profile-actions-shell" data-profile-actions-shell>
      <button
        type="button"
        class="studio__profile-menu-trigger"
        data-profile-actions-trigger
        aria-label="Profile actions"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="studio-profile-actions-menu"
        title="Profile actions"
      >
        <span class="studio__profile-menu-glyph" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
      </button>
      <div class="studio__profile-menu-backdrop" data-profile-menu-backdrop hidden></div>
      <div
        class="studio__profile-menu"
        id="studio-profile-actions-menu"
        data-profile-actions-menu
        role="menu"
        aria-label="Profile actions"
        hidden
      >
        <header class="studio__profile-menu-head">
          <span class="studio__profile-menu-kicker">Profile control deck</span>
          <strong data-profile-menu-active-name>Current setup</strong>
        </header>
        <div class="studio__profile-menu-group" role="group" aria-label="Create and transfer">
          ${renderMenuItem('add', 'Add profile', 'Start from this setup or product defaults')}
          ${renderMenuItem('import', 'Import JSON', 'Merge libraries or replace from a verified backup')}
        </div>
        <div class="studio__profile-menu-group" role="group" aria-label="Manage selected profile">
          ${renderMenuItem('rename', 'Rename profile', 'Change the selected profile name')}
          ${renderMenuItem('clone', 'Clone profile', 'Create an independent copy of this profile')}
          ${renderMenuItem('export', 'Export JSON', 'Download all profiles and preferences')}
        </div>
        <div class="studio__profile-menu-group studio__profile-menu-group--danger" role="group" aria-label="Destructive actions">
          ${renderMenuItem('delete', 'Delete profile', 'Permanently remove the selected profile')}
        </div>
      </div>
    </div>
    <div class="studio__profile-action-modal" data-profile-action-modal hidden>
      <form
        class="studio__profile-action-dialog"
        data-profile-action-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-profile-action-title"
        novalidate
      >
        <header class="studio__profile-action-dialog-head">
          <div>
            <span class="studio__profile-dialog-kicker">Profile control deck</span>
            <h2 id="studio-profile-action-title" data-profile-dialog-title>Profile action</h2>
          </div>
          <button
            type="button"
            class="studio__profile-dialog-close"
            data-profile-dialog-close
            aria-label="Close profile dialog"
          >×</button>
        </header>
        <p class="studio__profile-dialog-copy" data-profile-dialog-copy></p>
        <label class="studio__profile-name-field" data-profile-name-field>
          <span>Profile name</span>
          <input
            type="text"
            maxlength="${PROFILE_NAME_MAX_LENGTH}"
            autocomplete="off"
            spellcheck="false"
            data-profile-name-input
          />
          <small>Up to ${PROFILE_NAME_MAX_LENGTH} characters</small>
        </label>
        <fieldset class="studio__profile-source-options" data-profile-source-options hidden>
          <legend>Start from</legend>
          <label class="studio__profile-source-option">
            <input type="radio" name="profile-source" value="current" checked />
            <span>
              <strong>Current setup</strong>
              <small>Capture the look, voice, and subtitle settings on screen</small>
            </span>
          </label>
          <label class="studio__profile-source-option">
            <input type="radio" name="profile-source" value="defaults" />
            <span>
              <strong>Product defaults</strong>
              <small>Open a clean Classic profile with voice and subtitles off</small>
            </span>
          </label>
        </fieldset>
        <!-- CHANGED: Import strategy is chosen before the native file picker opens. -->
        <!-- WHY: merge and full replacement must be explicit, comparable decisions instead of a destructive afterthought. -->
        <fieldset class="studio__profile-source-options studio__profile-import-options" data-profile-import-options hidden>
          <legend>Import strategy</legend>
          <label class="studio__profile-source-option studio__profile-import-option--merge">
            <input type="radio" name="profile-import-strategy" value="merge" checked />
            <span>
              <strong>
                Merge with this Studio
                <em class="studio__profile-import-badge">Recommended</em>
              </strong>
              <small>Apply the backup’s settings, keep unmatched local profiles and styles, and update matching names or IDs</small>
            </span>
          </label>
          <label class="studio__profile-source-option studio__profile-import-option--replace">
            <input type="radio" name="profile-import-strategy" value="replace" />
            <span>
              <strong>Replace all preferences</strong>
              <small>Restore the backup exactly; local profiles and styles missing from it are removed</small>
            </span>
          </label>
        </fieldset>
        <div class="studio__profile-delete-summary" data-profile-delete-summary hidden>
          <span>Selected profile</span>
          <strong data-profile-delete-name></strong>
          <small>This removes the saved profile only. Your current recording is untouched.</small>
        </div>
        <p class="studio__profile-dialog-error" data-profile-dialog-error role="alert" hidden></p>
        <div class="studio__profile-dialog-actions">
          <button type="button" class="popup__button popup__button--secondary" data-profile-dialog-cancel>
            Cancel
          </button>
          <button type="submit" class="popup__profile-btn popup__profile-btn--save" data-profile-dialog-submit>
            Continue
          </button>
        </div>
      </form>
    </div>
  `;
}

export function mountProfileActionsMenu(
  root: HTMLElement,
  callbacks: ProfileActionsCallbacks,
): ProfileActionsHandle {
  const profileSelect = root.querySelector<HTMLSelectElement>('[data-profile-select]');
  const saveButton = root.querySelector<HTMLButtonElement>('[data-save-profile]')!;
  const resetButton = root.querySelector<HTMLButtonElement>('[data-reset-profile]')!;
  const shell = root.querySelector<HTMLElement>('[data-profile-actions-shell]')!;
  const trigger = root.querySelector<HTMLButtonElement>('[data-profile-actions-trigger]')!;
  const menu = root.querySelector<HTMLElement>('[data-profile-actions-menu]')!;
  const backdrop = root.querySelector<HTMLElement>('[data-profile-menu-backdrop]')!;
  const activeName = root.querySelector<HTMLElement>('[data-profile-menu-active-name]')!;
  const modal = root.querySelector<HTMLElement>('[data-profile-action-modal]')!;
  const dialog = root.querySelector<HTMLFormElement>('[data-profile-action-dialog]')!;
  const dialogTitle = root.querySelector<HTMLElement>('[data-profile-dialog-title]')!;
  const dialogCopy = root.querySelector<HTMLElement>('[data-profile-dialog-copy]')!;
  const nameField = root.querySelector<HTMLElement>('[data-profile-name-field]')!;
  const nameInput = root.querySelector<HTMLInputElement>('[data-profile-name-input]')!;
  const sourceOptions = root.querySelector<HTMLFieldSetElement>('[data-profile-source-options]')!;
  const importOptions = root.querySelector<HTMLFieldSetElement>('[data-profile-import-options]')!;
  const deleteSummary = root.querySelector<HTMLElement>('[data-profile-delete-summary]')!;
  const deleteName = root.querySelector<HTMLElement>('[data-profile-delete-name]')!;
  const dialogError = root.querySelector<HTMLElement>('[data-profile-dialog-error]')!;
  const dialogClose = root.querySelector<HTMLButtonElement>('[data-profile-dialog-close]')!;
  const dialogCancel = root.querySelector<HTMLButtonElement>('[data-profile-dialog-cancel]')!;
  const dialogSubmit = root.querySelector<HTMLButtonElement>('[data-profile-dialog-submit]')!;

  let state: ProfileActionsState = {
    activeProfileName: null,
    profileNames: [],
    hasSavedProfile: false,
    profileDirty: false,
    hasResettableChanges: false,
    canAddProfile: true,
  };
  let dialogMode: ProfileDialogMode | null = null;
  let dialogReturnFocus: HTMLElement = trigger;
  let resetBusy = false;
  let disposed = false;

  function menuItems(): HTMLButtonElement[] {
    return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  function setActionDisabled(action: ProfileAction, disabled: boolean): void {
    const button = menu.querySelector<HTMLButtonElement>(`[data-profile-action="${action}"]`)!;
    button.setAttribute('aria-disabled', String(disabled));
  }

  function closeMenu(restoreFocus = false): void {
    menu.hidden = true;
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !disposed) trigger.focus();
  }

  function openMenu(): void {
    if (!modal.hidden) closeDialog(false);
    menu.hidden = false;
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menuItems()[0]?.focus();
  }

  function closeDialog(restoreFocus = true): void {
    modal.hidden = true;
    dialogMode = null;
    dialogError.hidden = true;
    dialog.removeAttribute('aria-busy');
    dialogSubmit.disabled = false;
    dialogCancel.disabled = false;
    dialogClose.disabled = false;
    if (restoreFocus && !disposed) {
      const returnButton =
        dialogReturnFocus instanceof HTMLButtonElement ? dialogReturnFocus : null;
      if (!dialogReturnFocus.hidden && !returnButton?.disabled) {
        dialogReturnFocus.focus();
      } else {
        (profileSelect ?? trigger).focus();
      }
    }
    dialogReturnFocus = trigger;
  }

  function openDialog(mode: ProfileDialogMode, returnFocus: HTMLElement = trigger): void {
    closeMenu();
    dialogMode = mode;
    dialogReturnFocus = returnFocus;
    dialogError.hidden = true;
    nameField.hidden = mode === 'delete' || mode === 'import';
    sourceOptions.hidden = mode !== 'create';
    importOptions.hidden = mode !== 'import';
    deleteSummary.hidden = mode !== 'delete';
    dialogSubmit.classList.toggle('popup__profile-btn--delete', mode === 'delete');
    dialogSubmit.classList.toggle('popup__profile-btn--save', mode !== 'delete');

    if (mode === 'create') {
      dialogTitle.textContent = 'Add profile';
      dialogCopy.textContent =
        'Name the profile, then choose whether it begins from this setup or a clean product baseline.';
      nameInput.value = nextAvailableProfileName('New profile', state.profileNames);
      dialogSubmit.textContent = 'Add profile';
      const currentSource = sourceOptions.querySelector<HTMLInputElement>(
        'input[value="current"]',
      );
      if (currentSource) currentSource.checked = true;
    } else if (mode === 'rename') {
      dialogTitle.textContent = 'Rename profile';
      dialogCopy.textContent = 'Change the label without changing the profile settings or identity.';
      nameInput.value = state.activeProfileName ?? '';
      dialogSubmit.textContent = 'Rename profile';
    } else if (mode === 'clone') {
      dialogTitle.textContent = state.profileDirty ? 'Save as new profile' : 'Clone profile';
      dialogCopy.textContent = state.profileDirty
        ? 'Keep the selected profile unchanged and save the edits on screen as a new profile.'
        : 'Create an independent copy you can edit without changing the selected profile.';
      nameInput.value = nextAvailableProfileCopyName(
        state.activeProfileName ?? 'Profile',
        state.profileNames,
      );
      dialogSubmit.textContent = state.profileDirty ? 'Save as new' : 'Clone profile';
    } else if (mode === 'delete') {
      dialogTitle.textContent = 'Delete profile?';
      dialogCopy.textContent =
        'This is a permanent profile action and needs one explicit confirmation.';
      deleteName.textContent = state.activeProfileName ?? 'Selected profile';
      dialogSubmit.textContent = 'Delete profile';
    } else {
      dialogTitle.textContent = 'Import preferences';
      dialogCopy.textContent =
        'Choose how this verified backup joins the Studio. Both paths normalize first and save once.';
      dialogSubmit.textContent = 'Choose JSON file';
      const mergeStrategy = importOptions.querySelector<HTMLInputElement>(
        'input[value="merge"]',
      );
      if (mergeStrategy) mergeStrategy.checked = true;
    }

    modal.hidden = false;
    requestAnimationFrame(() => {
      if (mode === 'delete') {
        dialogCancel.focus();
      } else if (mode === 'import') {
        importOptions.querySelector<HTMLInputElement>('input:checked')?.focus();
      } else {
        nameInput.focus();
        nameInput.select();
      }
    });
  }

  async function activateAction(action: ProfileAction): Promise<void> {
    const button = menu.querySelector<HTMLButtonElement>(`[data-profile-action="${action}"]`)!;
    if (button.getAttribute('aria-disabled') === 'true') return;

    if (action === 'add') {
      openDialog('create');
    } else if (action === 'rename') {
      openDialog('rename');
    } else if (action === 'clone') {
      openDialog('clone');
    } else if (action === 'delete') {
      openDialog('delete');
    } else if (action === 'import') {
      openDialog('import');
    } else {
      closeMenu();
      await callbacks.onExport();
    }
  }

  function focusRelativeMenuItem(current: HTMLButtonElement, delta: number): void {
    const items = menuItems();
    const index = Math.max(0, items.indexOf(current));
    items[(index + delta + items.length) % items.length]?.focus();
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    const current = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    if (!current) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRelativeMenuItem(current, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRelativeMenuItem(current, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      menuItems()[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      menuItems().at(-1)?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  }

  function focusableDialogElements(): HTMLElement[] {
    return [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"])',
    )].filter((element) => !element.closest<HTMLElement>('[hidden]'));
  }

  function onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableDialogElements();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Could not complete the profile action.';
  }

  // BUG FIX: Profile Reset looked busy while clean and could not restore Custom defaults
  // Fix: Only a genuinely resettable state enters busy mode; clean states remain inert and focus returns after either reset destination.
  // Sync: mount-clip-studio.ts; profile-actions.css; scripts/test-profile-actions.mjs
  const onResetClick = (): void => {
    if (resetBusy || resetButton.disabled) return;
    resetBusy = true;
    resetButton.disabled = true;
    resetButton.setAttribute('aria-busy', 'true');
    void callbacks.onReset()
      .then(() => {
        if (!disposed) (profileSelect ?? trigger).focus();
      })
      .catch((error: unknown) => {
        console.error('[Reddit Voice Notes] Could not reset profile changes', error);
        window.alert(errorMessage(error));
      })
      .finally(() => {
        resetBusy = false;
        resetButton.removeAttribute('aria-busy');
        resetButton.disabled = resolveProfileActionsView(state).resetDisabled;
      });
  };

  resetButton.addEventListener('click', onResetClick);
  trigger.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu();
    }
  });
  menu.addEventListener('keydown', onMenuKeydown);
  menu.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-profile-action]',
    );
    const action = button?.dataset.profileAction as ProfileAction | undefined;
    if (action) void activateAction(action);
  });
  backdrop.addEventListener('click', () => closeMenu(true));
  dialogClose.addEventListener('click', () => closeDialog());
  dialogCancel.addEventListener('click', () => closeDialog());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeDialog();
  });
  modal.addEventListener('keydown', onDialogKeydown);
  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!dialogMode) return;
    const mode = dialogMode;
    const name = nameInput.value.trim();
    if (mode !== 'delete' && mode !== 'import' && !name) {
      dialogError.textContent = 'Enter a profile name.';
      dialogError.hidden = false;
      nameInput.focus();
      return;
    }

    dialog.setAttribute('aria-busy', 'true');
    dialogError.hidden = true;
    dialogSubmit.disabled = true;
    dialogCancel.disabled = true;
    dialogClose.disabled = true;
    void (async () => {
      if (mode === 'create') {
        const source =
          sourceOptions.querySelector<HTMLInputElement>('input[name="profile-source"]:checked')
            ?.value === 'defaults'
            ? 'defaults'
            : 'current';
        await callbacks.onCreate(name, source);
      } else if (mode === 'rename') {
        await callbacks.onRename(name);
      } else if (mode === 'clone') {
        await callbacks.onClone(name);
      } else if (mode === 'delete') {
        await callbacks.onDelete();
      } else {
        const strategy =
          importOptions.querySelector<HTMLInputElement>(
            'input[name="profile-import-strategy"]:checked',
          )?.value === 'replace'
            ? 'replace'
            : 'merge';
        callbacks.onImport(strategy);
      }
      closeDialog();
    })().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        closeDialog();
        return;
      }
      dialogError.textContent = errorMessage(error);
      dialogError.hidden = false;
      dialog.removeAttribute('aria-busy');
      dialogSubmit.disabled = false;
      dialogCancel.disabled = false;
      dialogClose.disabled = false;
      if (mode === 'import') {
        importOptions.querySelector<HTMLInputElement>('input:checked')?.focus();
      } else if (mode !== 'delete') {
        nameInput.focus();
      }
    });
  });

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (menu.hidden) return;
    const target = event.target as Node | null;
    if (target && !shell.contains(target)) closeMenu();
  };
  document.addEventListener('pointerdown', onDocumentPointerDown);

  return {
    sync(nextState) {
      state = {
        ...nextState,
        profileNames: [...nextState.profileNames],
      };
      const view = resolveProfileActionsView(state);
      activeName.textContent = state.activeProfileName ?? 'Current setup';
      setActionDisabled('add', view.addDisabled);
      setActionDisabled('rename', view.manageDisabled);
      setActionDisabled('clone', view.manageDisabled);
      setActionDisabled('delete', view.manageDisabled);
      resetButton.disabled = resetBusy || view.resetDisabled;
      resetButton.setAttribute('aria-label', view.resetLabel);
      resetButton.title = view.resetTitle;

      const addDescription = menu.querySelector<HTMLElement>(
        '[data-profile-action-description="add"]',
      )!;
      addDescription.textContent = view.addDisabled
        ? 'Profile limit reached — delete one to add another'
        : 'Start from this setup or product defaults';
      const cloneLabel = menu.querySelector<HTMLElement>(
        '[data-profile-action-label="clone"]',
      )!;
      const cloneDescription = menu.querySelector<HTMLElement>(
        '[data-profile-action-description="clone"]',
      )!;
      cloneLabel.textContent = view.cloneLabel;
      cloneDescription.textContent = view.cloneDescription;
    },
    openCreateFromCurrent() {
      // BUG FIX: Custom (unsaved) Save changes previously required menu discovery
      // Fix: Open the established Add-current dialog directly and return focus to the initiating Save key when cancelled.
      // Sync: mount-clip-studio.ts; scripts/test-profile-actions.mjs
      openDialog('create', saveButton);
    },
    close() {
      closeMenu();
      closeDialog(false);
    },
    dispose() {
      disposed = true;
      closeMenu();
      closeDialog(false);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      resetButton.removeEventListener('click', onResetClick);
    },
  };
}
