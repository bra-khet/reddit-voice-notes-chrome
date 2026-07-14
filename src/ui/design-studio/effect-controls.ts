import type { BackgroundEffect, BarGlowEffect, DesignOverrides } from '@/src/theme/design-overrides';
import { BUBBLES_OVERLAY_LABEL } from '@/src/theme/audio-reactive/catalog';

// V4 NOTE: Effects controls may relocate when Design Studio sections are segmented.

export interface EffectControlsHandle {
  sync(overrides: DesignOverrides | null | undefined): void;
}

export function renderBackgroundFlairFields(): string {
  return `
    <div class="studio__effects" data-background-flair-controls>
      <label class="popup__field">
        <span class="popup__field-label">Background flair</span>
        <select class="popup__select" data-background-effect aria-label="Background flair">
          <option value="none">None</option>
          <option value="bokeh">${BUBBLES_OVERLAY_LABEL}</option>
          <option value="sparkle">Sparkle</option>
        </select>
      </label>
    </div>
  `;
}

export function renderBarGlowField(): string {
  return `
    <label class="popup__toggle-row studio__effect-toggle" data-bar-glow-control>
      <span class="popup__toggle-copy">
        <span class="popup__toggle-label">Boosted bar glow</span>
        <p class="popup__field-desc">Stronger neon halo on waveform bars.</p>
      </span>
      <input
        class="popup__toggle-input"
        type="checkbox"
        data-bar-glow-boost
        aria-label="Boosted bar glow"
      />
    </label>
  `;
}

/** @deprecated Use renderBackgroundFlairFields + renderBarGlowField */
export function renderEffectControlFields(): string {
  return `${renderBarGlowField()}${renderBackgroundFlairFields()}`;
}

export function mountBackgroundFlairControls(
  root: HTMLElement,
  onFlairChange: (backgroundEffect: BackgroundEffect) => void,
): EffectControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-background-flair-controls]')!;
  const backgroundEffectSelect = panel.querySelector<HTMLSelectElement>('[data-background-effect]')!;
  let syncing = false;

  backgroundEffectSelect.addEventListener('change', () => {
    if (syncing) return;
    onFlairChange(backgroundEffectSelect.value as BackgroundEffect);
  });

  return {
    sync(overrides) {
      syncing = true;
      backgroundEffectSelect.value = overrides?.backgroundEffect ?? 'none';
      syncing = false;
    },
  };
}

export function mountBarGlowControl(
  root: HTMLElement,
  onBarGlowChange: (barGlow: BarGlowEffect) => void,
): EffectControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-bar-glow-control]')!;
  const barGlowBoostInput = panel.querySelector<HTMLInputElement>('[data-bar-glow-boost]')!;
  let syncing = false;

  barGlowBoostInput.addEventListener('change', () => {
    if (syncing) return;
    onBarGlowChange(barGlowBoostInput.checked ? 'boosted' : 'default');
  });

  return {
    sync(overrides) {
      syncing = true;
      barGlowBoostInput.checked = overrides?.barGlow === 'boosted';
      syncing = false;
    },
  };
}

export function mountEffectControls(
  root: HTMLElement,
  onEffectsChange: (patch: Pick<DesignOverrides, 'backgroundEffect' | 'barGlow'>) => void,
): EffectControlsHandle {
  const flair = mountBackgroundFlairControls(root, (backgroundEffect) => {
    onEffectsChange({ backgroundEffect });
  });
  const glow = mountBarGlowControl(root, (barGlow) => {
    onEffectsChange({ barGlow });
  });

  return {
    sync(overrides) {
      flair.sync(overrides);
      glow.sync(overrides);
    },
  };
}
