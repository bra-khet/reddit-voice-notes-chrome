import type { BackgroundEffect, BarGlowEffect, DesignOverrides } from '@/src/theme/design-overrides';

export interface EffectControlsHandle {
  sync(overrides: DesignOverrides | null | undefined): void;
}

export function renderEffectControlFields(): string {
  return `
    <div class="studio__effects" data-effect-controls>
      <label class="popup__field">
        <span class="popup__field-label">Background flair</span>
        <select class="popup__select" data-background-effect aria-label="Background flair">
          <option value="none">None</option>
          <option value="bokeh">Bokeh</option>
          <option value="sparkle">Sparkle</option>
        </select>
      </label>
      <label class="popup__toggle-row studio__effect-toggle">
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
    </div>
  `;
}

export function mountEffectControls(
  root: HTMLElement,
  onEffectsChange: (patch: Pick<DesignOverrides, 'backgroundEffect' | 'barGlow'>) => void,
): EffectControlsHandle {
  const panel = root.querySelector<HTMLElement>('[data-effect-controls]')!;
  const backgroundEffectSelect = panel.querySelector<HTMLSelectElement>('[data-background-effect]')!;
  const barGlowBoostInput = panel.querySelector<HTMLInputElement>('[data-bar-glow-boost]')!;

  let syncing = false;

  function emit(): void {
    if (syncing) return;
    onEffectsChange({
      backgroundEffect: backgroundEffectSelect.value as BackgroundEffect,
      barGlow: barGlowBoostInput.checked ? 'boosted' : 'default',
    });
  }

  backgroundEffectSelect.addEventListener('change', emit);
  barGlowBoostInput.addEventListener('change', emit);

  return {
    sync(overrides) {
      syncing = true;
      backgroundEffectSelect.value = overrides?.backgroundEffect ?? 'none';
      barGlowBoostInput.checked = overrides?.barGlow === 'boosted';
      syncing = false;
    },
  };
}