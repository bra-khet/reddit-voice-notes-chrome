export type StudioSubpanelGuardActions = {
  onApply: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
};

/** Inline unsaved prompt for section sub-panels (§10.4). */
export function renderStudioSubpanelGuardFields(): string {
  return `
    <div class="studio__subpanel-guard" data-studio-subpanel-guard hidden>
      <p class="studio__subpanel-guard-copy popup__field-desc">
        You have unsaved edits in this section. Apply them, discard, or keep editing.
      </p>
      <div class="studio__subpanel-guard-actions">
        <button type="button" class="popup__profile-btn popup__profile-btn--save" data-studio-subpanel-guard-apply>
          Apply
        </button>
        <button type="button" class="popup__profile-btn popup__profile-btn--delete" data-studio-subpanel-guard-discard>
          Discard
        </button>
        <button type="button" class="popup__button popup__button--secondary" data-studio-subpanel-guard-cancel>
          Keep editing
        </button>
      </div>
    </div>
  `;
}

export function mountStudioSubpanelGuard(
  host: HTMLElement,
  actions: StudioSubpanelGuardActions,
): { isVisible(): boolean; show(): void; hide(): void } {
  const guardEl = host.querySelector<HTMLElement>('[data-studio-subpanel-guard]')!;
  const applyBtn = host.querySelector<HTMLButtonElement>('[data-studio-subpanel-guard-apply]')!;
  const discardBtn = host.querySelector<HTMLButtonElement>('[data-studio-subpanel-guard-discard]')!;
  const cancelBtn = host.querySelector<HTMLButtonElement>('[data-studio-subpanel-guard-cancel]')!;

  applyBtn.addEventListener('click', () => {
    void Promise.resolve(actions.onApply()).finally(() => {
      guardEl.hidden = true;
    });
  });

  discardBtn.addEventListener('click', () => {
    void Promise.resolve(actions.onDiscard()).finally(() => {
      guardEl.hidden = true;
    });
  });

  cancelBtn.addEventListener('click', () => {
    actions.onCancel();
    guardEl.hidden = true;
  });

  return {
    isVisible: () => !guardEl.hidden,
    show: () => {
      guardEl.hidden = false;
    },
    hide: () => {
      guardEl.hidden = true;
    },
  };
}