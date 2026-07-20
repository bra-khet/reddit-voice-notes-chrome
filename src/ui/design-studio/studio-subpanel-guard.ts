export type StudioSubpanelGuardPanelId = 'style' | 'background' | 'voice' | 'subtitles';

export type StudioSubpanelGuardActions = {
  onApply: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
};

type StudioSubpanelGuardCopy = {
  message: string;
  applyLabel: string;
  discardLabel: string;
  cancelLabel: string;
};

const DEFAULT_GUARD_COPY: StudioSubpanelGuardCopy = {
  message: 'You have unsaved edits in this section. Save before leaving, discard, or keep editing.',
  applyLabel: 'Save & leave',
  discardLabel: 'Discard & leave',
  cancelLabel: 'Keep editing',
};

const GUARD_COPY_BY_PANEL: Partial<Record<StudioSubpanelGuardPanelId, StudioSubpanelGuardCopy>> = {
  subtitles: {
    message:
      'You have unsaved subtitle edits. Save them before leaving, discard the changes, or keep editing.',
    applyLabel: 'Save & leave',
    discardLabel: 'Discard & leave',
    cancelLabel: 'Keep editing',
  },
  style: {
    message:
      'You have unsaved visual style edits. Save them before leaving, discard the changes, or keep editing.',
    applyLabel: 'Save & leave',
    discardLabel: 'Discard & leave',
    cancelLabel: 'Keep editing',
  },
};

/** Inline unsaved prompt for section sub-panels (§10.4). */
export function renderStudioSubpanelGuardFields(): string {
  return `
    <div class="studio__subpanel-guard" data-studio-subpanel-guard hidden>
      <div class="studio__subpanel-guard-card" role="dialog" aria-labelledby="studio-subpanel-guard-title">
        <p class="studio__subpanel-guard-copy popup__field-desc" id="studio-subpanel-guard-title" data-studio-subpanel-guard-message>
          ${DEFAULT_GUARD_COPY.message}
        </p>
        <div class="studio__subpanel-guard-actions studio-v4__guard-actions">
          <button type="button" class="popup__button popup__button--secondary studio-v4__guard-cancel" data-studio-subpanel-guard-cancel>
            ${DEFAULT_GUARD_COPY.cancelLabel}
          </button>
          <button type="button" class="popup__profile-btn popup__profile-btn--delete studio-v4__guard-discard" data-studio-subpanel-guard-discard>
            ${DEFAULT_GUARD_COPY.discardLabel}
          </button>
          <button type="button" class="popup__profile-btn popup__profile-btn--save studio-v4__guard-apply" data-studio-subpanel-guard-apply>
            ${DEFAULT_GUARD_COPY.applyLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

export function mountStudioSubpanelGuard(
  host: HTMLElement,
  actions: StudioSubpanelGuardActions,
): { isVisible(): boolean; show(panelId?: StudioSubpanelGuardPanelId): void; hide(): void } {
  const guardEl = host.querySelector<HTMLElement>('[data-studio-subpanel-guard]')!;
  const messageEl = host.querySelector<HTMLElement>('[data-studio-subpanel-guard-message]')!;
  const applyBtn = host.querySelector<HTMLButtonElement>('[data-studio-subpanel-guard-apply]')!;
  const discardBtn = host.querySelector<HTMLButtonElement>('[data-studio-subpanel-guard-discard]')!;
  const cancelBtn = host.querySelector<HTMLButtonElement>('[data-studio-subpanel-guard-cancel]')!;

  function applyCopy(copy: StudioSubpanelGuardCopy): void {
    messageEl.textContent = copy.message;
    applyBtn.textContent = copy.applyLabel;
    discardBtn.textContent = copy.discardLabel;
    cancelBtn.textContent = copy.cancelLabel;
  }

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
    cancelBtn.blur();
  });

  return {
    isVisible: () => !guardEl.hidden,
    show: (panelId?: StudioSubpanelGuardPanelId) => {
      const copy =
        panelId && GUARD_COPY_BY_PANEL[panelId] ? GUARD_COPY_BY_PANEL[panelId]! : DEFAULT_GUARD_COPY;
      applyCopy(copy);
      guardEl.hidden = false;
      applyBtn.focus();
    },
    hide: () => {
      guardEl.hidden = true;
    },
  };
}
