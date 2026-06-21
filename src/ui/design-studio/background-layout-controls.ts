import type { UserPreferencesV1 } from '@/src/settings/user-preferences';
import type { BackgroundImagePosition, BackgroundScaleMode } from '@/src/theme/types';

export interface BackgroundLayoutControlsHandle {
  sync(prefs: UserPreferencesV1): void;
}

const SCALE_OPTIONS: { value: BackgroundScaleMode; label: string; hint: string }[] = [
  {
    value: 'fit',
    label: 'Fit inside',
    hint: 'Show the whole image; theme fills empty space',
  },
  {
    value: 'fill',
    label: 'Fill frame',
    hint: 'Zoom to cover; edges may crop',
  },
];

const POSITION_OPTIONS: {
  value: BackgroundImagePosition;
  label: string;
  gridColumn: number;
  gridRow: number;
}[] = [
  { value: 'top', label: 'Top', gridColumn: 2, gridRow: 1 },
  { value: 'left', label: 'Left', gridColumn: 1, gridRow: 2 },
  { value: 'center', label: 'Center', gridColumn: 2, gridRow: 2 },
  { value: 'right', label: 'Right', gridColumn: 3, gridRow: 2 },
  { value: 'bottom', label: 'Bottom', gridColumn: 2, gridRow: 3 },
];

function scaleModeIcon(mode: BackgroundScaleMode): string {
  if (mode === 'fit') {
    return `
      <svg class="studio__layout-icon" viewBox="0 0 32 20" aria-hidden="true">
        <rect x="1" y="1" width="30" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <rect x="8" y="4" width="16" height="12" rx="1" fill="currentColor" opacity="0.85"/>
      </svg>
    `;
  }
  return `
    <svg class="studio__layout-icon" viewBox="0 0 32 20" aria-hidden="true">
      <rect x="1" y="1" width="30" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <rect x="4" y="2" width="24" height="16" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="1" y="1" width="30" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/>
    </svg>
  `;
}

function positionIcon(position: BackgroundImagePosition): string {
  const photoRects: Record<BackgroundImagePosition, string> = {
    top: '<rect x="10" y="3" width="12" height="8" rx="1" fill="currentColor"/>',
    center: '<rect x="10" y="8" width="12" height="8" rx="1" fill="currentColor"/>',
    bottom: '<rect x="10" y="13" width="12" height="8" rx="1" fill="currentColor"/>',
    left: '<rect x="4" y="8" width="12" height="8" rx="1" fill="currentColor"/>',
    right: '<rect x="16" y="8" width="12" height="8" rx="1" fill="currentColor"/>',
  };
  return `
    <svg class="studio__layout-icon studio__layout-icon--small" viewBox="0 0 32 24" aria-hidden="true">
      <rect x="1" y="1" width="30" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
      ${photoRects[position]}
    </svg>
  `;
}

export function renderBackgroundLayoutFields(): string {
  const scaleButtons = SCALE_OPTIONS.map(
    (option) => `
      <button
        type="button"
        class="studio__layout-choice"
        data-scale-mode="${option.value}"
        aria-label="${option.label}"
        title="${option.hint}"
      >
        ${scaleModeIcon(option.value)}
        <span class="studio__layout-choice-label">${option.label}</span>
      </button>
    `,
  ).join('');

  const positionButtons = POSITION_OPTIONS.map(
    (option) => `
      <button
        type="button"
        class="studio__layout-choice studio__layout-choice--position"
        data-background-position="${option.value}"
        style="grid-column:${option.gridColumn};grid-row:${option.gridRow}"
        aria-label="${option.label}"
        title="${option.label}"
      >
        ${positionIcon(option.value)}
      </button>
    `,
  ).join('');

  return `
    <div class="studio__background-layout" data-background-layout hidden>
      <div class="studio__layout-group">
        <span class="popup__field-label">Image sizing</span>
        <div class="studio__layout-scale-row" role="radiogroup" aria-label="Background image sizing">
          ${scaleButtons}
        </div>
      </div>
      <div class="studio__layout-group">
        <span class="popup__field-label">Image position</span>
        <div class="studio__layout-position-grid" role="radiogroup" aria-label="Background image position">
          ${positionButtons}
        </div>
      </div>
    </div>
  `;
}

export function mountBackgroundLayoutControls(
  root: HTMLElement,
  onLayoutChange: (patch: {
    backgroundScaleMode: BackgroundScaleMode;
    backgroundPosition: BackgroundImagePosition;
  }) => void,
): BackgroundLayoutControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-background-layout]')!;
  const scaleButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-scale-mode]')];
  const positionButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-background-position]')];

  let syncing = false;
  let scaleMode: BackgroundScaleMode = 'fill';
  let position: BackgroundImagePosition = 'center';

  function emit(): void {
    if (syncing) return;
    onLayoutChange({ backgroundScaleMode: scaleMode, backgroundPosition: position });
  }

  function syncButtons(): void {
    syncing = true;
    for (const button of scaleButtons) {
      const active = button.dataset.scaleMode === scaleMode;
      button.classList.toggle('studio__layout-choice--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const button of positionButtons) {
      const active = button.dataset.backgroundPosition === position;
      button.classList.toggle('studio__layout-choice--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    syncing = false;
  }

  for (const button of scaleButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.scaleMode as BackgroundScaleMode | undefined;
      if (!next || next === scaleMode) return;
      scaleMode = next;
      syncButtons();
      emit();
    });
  }

  for (const button of positionButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.backgroundPosition as BackgroundImagePosition | undefined;
      if (!next || next === position) return;
      position = next;
      syncButtons();
      emit();
    });
  }

  return {
    sync(prefs) {
      const hasBackground = Boolean(prefs.appearance.customBackgroundId);
      panel.hidden = !hasBackground;
      if (!hasBackground) return;

      scaleMode = prefs.appearance.backgroundScaleMode ?? 'fill';
      position = prefs.appearance.backgroundPosition ?? 'center';
      syncButtons();
    },
  };
}