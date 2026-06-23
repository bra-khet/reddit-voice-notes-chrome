import { STUDIO_V4_ASSETS, studioV4AssetUrl } from '@/src/ui/design-studio/studio-v4-assets';
import {
  mountStudioSubpanelGuard,
  renderStudioSubpanelGuardFields,
} from '@/src/ui/design-studio/studio-subpanel-guard';

export type StudioPanelId = 'bar-style' | 'background' | 'voice' | 'subtitles';

const PANEL_TITLES: Record<StudioPanelId, string> = {
  'bar-style': 'Bar style',
  background: 'Background',
  voice: 'Voice',
  subtitles: 'Subtitles',
};

const PANEL_ICON_BY_ID: Record<StudioPanelId, string> = {
  'bar-style': STUDIO_V4_ASSETS.icons.barStyle32,
  background: STUDIO_V4_ASSETS.icons.background32,
  voice: STUDIO_V4_ASSETS.icons.voice32,
  subtitles: STUDIO_V4_ASSETS.icons.subtitles32,
};

export type StudioSubpanelGuardHooks = {
  isPanelDirty?: (panelId: StudioPanelId) => boolean;
  onApplyPanel?: (panelId: StudioPanelId) => void | Promise<void>;
  onDiscardPanel?: (panelId: StudioPanelId) => void | Promise<void>;
};

export type StudioSubpanelShellHandle = {
  dispose(): void;
  closeActive(): void;
  isOpen(): boolean;
  getActivePanelId(): StudioPanelId | null;
};

/** Mirrors main Design Studio header while a section sub-panel is open (§10.4 chrome). */
export function renderStudioV4SubpanelChrome(): string {
  return `
    <header class="studio__subpanel-chrome" data-studio-subpanel-chrome hidden>
      <div class="studio__subpanel-chrome-row studio__header-row">
        <div class="studio__subpanel-chrome-status studio-v4__surface studio-v4__surface--subpanel-header-bar">
          <button
            type="button"
            class="studio__subpanel-back studio-v4__nav-chip"
            data-studio-subpanel-back
            aria-label="Cancel and return to sections"
          >
            <img class="studio-v4__icon studio-v4__icon--16" data-studio-subpanel-back-icon alt="" width="16" height="16" />
          </button>
          <img
            class="studio__subpanel-icon studio-v4__icon studio-v4__icon--32"
            data-studio-subpanel-icon
            alt=""
            width="32"
            height="32"
          />
          <div class="studio__subpanel-chrome-copy">
            <h1 class="studio__subpanel-chrome-title" data-studio-subpanel-title id="studio-subpanel-title"></h1>
            <p class="studio__subpanel-chrome-subtitle">Section settings — changes apply live</p>
          </div>
        </div>
        <button
          type="button"
          class="studio__subpanel-done-btn"
          data-studio-subpanel-done
          aria-label="Done editing this section"
        >
          Done
        </button>
      </div>
    </header>
  `;
}

export function renderStudioV4SubpanelShell(): string {
  return `
    <div class="studio__subpanel" data-studio-subpanel hidden>
      <div class="studio__subpanel-content" data-studio-subpanel-slot></div>
      ${renderStudioSubpanelGuardFields()}
    </div>
  `;
}

export function mountStudioV4SubpanelShell(
  studioRoot: HTMLElement,
  hooks: StudioSubpanelGuardHooks = {},
): StudioSubpanelShellHandle {
  const mainHeader = studioRoot.querySelector<HTMLElement>('[data-studio-main-header]')!;
  const chromeEl = studioRoot.querySelector<HTMLElement>('[data-studio-subpanel-chrome]')!;
  const layoutMain = studioRoot.querySelector<HTMLElement>('[data-studio-layout-main]')!;
  const subpanelEl = studioRoot.querySelector<HTMLElement>('[data-studio-subpanel]')!;
  const slotEl = studioRoot.querySelector<HTMLElement>('[data-studio-subpanel-slot]')!;
  const titleEl = studioRoot.querySelector<HTMLElement>('[data-studio-subpanel-title]')!;
  const iconEl = studioRoot.querySelector<HTMLImageElement>('[data-studio-subpanel-icon]')!;
  const backBtn = studioRoot.querySelector<HTMLButtonElement>('[data-studio-subpanel-back]')!;
  const backIcon = studioRoot.querySelector<HTMLImageElement>('[data-studio-subpanel-back-icon]')!;
  const doneBtn = studioRoot.querySelector<HTMLButtonElement>('[data-studio-subpanel-done]')!;

  backIcon.src = studioV4AssetUrl(STUDIO_V4_ASSETS.icons.chevronBack16);

  let activePanelId: StudioPanelId | null = null;
  let activePanelEl: HTMLElement | null = null;
  let pendingClose = false;

  const guard = mountStudioSubpanelGuard(subpanelEl, {
    onApply: async () => {
      if (!activePanelId) return;
      await hooks.onApplyPanel?.(activePanelId);
      if (pendingClose) {
        pendingClose = false;
        closeImmediate();
      }
    },
    onDiscard: async () => {
      if (!activePanelId) return;
      await hooks.onDiscardPanel?.(activePanelId);
      if (pendingClose) {
        pendingClose = false;
        closeImmediate();
      }
    },
    onCancel: () => {
      pendingClose = false;
    },
  });

  function setMainHeaderGuarded(guarded: boolean): void {
    if (guarded) {
      mainHeader.setAttribute('inert', '');
      mainHeader.setAttribute('aria-hidden', 'true');
    } else {
      mainHeader.removeAttribute('inert');
      mainHeader.removeAttribute('aria-hidden');
    }
  }

  function isPanelDirty(): boolean {
    if (!activePanelId) return false;
    return hooks.isPanelDirty?.(activePanelId) ?? false;
  }

  function requestClose(): void {
    if (!activePanelId) return;
    if (guard.isVisible()) {
      guard.hide();
      pendingClose = false;
      return;
    }
    if (isPanelDirty()) {
      pendingClose = true;
      guard.show();
      return;
    }
    closeImmediate();
  }

  function closeImmediate(): void {
    if (!activePanelId || !activePanelEl) {
      chromeEl.hidden = true;
      subpanelEl.hidden = true;
      studioRoot.classList.remove('studio-v4--subpanel-open');
      setMainHeaderGuarded(false);
      activePanelId = null;
      activePanelEl = null;
      return;
    }

    const body = slotEl.querySelector<HTMLElement>('.studio__panel-body');
    if (body) {
      body.hidden = true;
      activePanelEl.appendChild(body);
    }

    guard.hide();
    pendingClose = false;
    chromeEl.hidden = true;
    subpanelEl.hidden = true;
    studioRoot.classList.remove('studio-v4--subpanel-open');
    setMainHeaderGuarded(false);
    layoutMain.hidden = false;
    activePanelId = null;
    activePanelEl = null;
  }

  function openPanel(panelId: StudioPanelId): void {
    if (activePanelId === panelId) return;

    if (activePanelId) {
      closeImmediate();
    }

    const panelEl = studioRoot.querySelector<HTMLElement>(`[data-studio-panel="${panelId}"]`);
    const body = panelEl?.querySelector<HTMLElement>('.studio__panel-body');
    if (!panelEl || !body) return;

    activePanelId = panelId;
    activePanelEl = panelEl;
    titleEl.textContent = PANEL_TITLES[panelId];
    iconEl.src = studioV4AssetUrl(PANEL_ICON_BY_ID[panelId]);

    body.hidden = false;
    slotEl.appendChild(body);
    layoutMain.hidden = true;
    chromeEl.hidden = false;
    subpanelEl.hidden = false;
    studioRoot.classList.add('studio-v4--subpanel-open');
    setMainHeaderGuarded(true);
    doneBtn.focus();
  }

  function onCardClick(event: Event): void {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLButtonElement>('[data-studio-panel-open]');
    if (!card) return;
    const panelId = card.dataset.studioPanelOpen as StudioPanelId | undefined;
    if (!panelId) return;
    openPanel(panelId);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (subpanelEl.hidden || event.key !== 'Escape') return;
    const transcriptModal = studioRoot.querySelector<HTMLElement>('[data-transcript-modal]');
    if (transcriptModal && !transcriptModal.hidden) return;
    event.preventDefault();
    requestClose();
  }

  studioRoot.addEventListener('click', onCardClick);
  backBtn.addEventListener('click', requestClose);
  doneBtn.addEventListener('click', requestClose);
  document.addEventListener('keydown', onKeydown);

  return {
    dispose(): void {
      closeImmediate();
      studioRoot.removeEventListener('click', onCardClick);
      document.removeEventListener('keydown', onKeydown);
    },
    closeActive: requestClose,
    isOpen: () => !subpanelEl.hidden,
    getActivePanelId: () => activePanelId,
  };
}