import {
  deriveGlowColor,
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
} from '@/src/theme/color-utils';
import type { DesignOverrides } from '@/src/theme/design-overrides';

export interface ColorPickerControls {
  sync(overrides: DesignOverrides | null | undefined): void;
}

export function renderColorPickerFields(): string {
  return `
    <div class="studio__color-panel" data-color-panel>
      <div class="studio__color-preview-row">
        <span class="studio__color-swatch" data-color-swatch aria-hidden="true"></span>
        <label class="studio__color-hex-field">
          <span class="popup__field-label">HEX</span>
          <input
            class="studio__color-hex-input"
            type="text"
            data-color-hex
            maxlength="7"
            spellcheck="false"
            autocomplete="off"
            aria-label="Bar color hex"
          />
        </label>
      </div>
      <label class="studio__color-slider">
        <span class="popup__field-label">Hue</span>
        <input type="range" min="0" max="360" step="1" data-color-hue aria-label="Hue" />
      </label>
      <label class="studio__color-slider">
        <span class="popup__field-label">Saturation</span>
        <input type="range" min="0" max="100" step="1" data-color-sat aria-label="Saturation" />
      </label>
      <label class="studio__color-slider">
        <span class="popup__field-label">Brightness</span>
        <input type="range" min="0" max="100" step="1" data-color-val aria-label="Brightness" />
      </label>
      <p class="popup__micro studio__color-note">
        Custom colors use the Neon Glow template — bar glow and backdrop adjust to your pick.
      </p>
    </div>
  `;
}

export function mountColorPickerControls(
  root: HTMLElement,
  onColorChange: (overrides: DesignOverrides) => void,
): ColorPickerControls {
  const panel = root.querySelector<HTMLElement>('[data-color-panel]')!;
  const swatch = panel.querySelector<HTMLElement>('[data-color-swatch]')!;
  const hexInput = panel.querySelector<HTMLInputElement>('[data-color-hex]')!;
  const hueInput = panel.querySelector<HTMLInputElement>('[data-color-hue]')!;
  const satInput = panel.querySelector<HTMLInputElement>('[data-color-sat]')!;
  const valInput = panel.querySelector<HTMLInputElement>('[data-color-val]')!;

  let syncing = false;

  function emitFromHsv(h: number, s: number, v: number): void {
    const barColor = hsvToHex(h, s, v);
    swatch.style.background = barColor;
    hexInput.value = barColor;
    onColorChange({
      barColor,
      glowColor: deriveGlowColor(barColor),
    });
  }

  function applyHex(hex: string): boolean {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return false;
    const hsv = hexToHsv(normalized);
    if (!hsv) return false;

    syncing = true;
    hueInput.value = String(Math.round(hsv.h));
    satInput.value = String(Math.round(hsv.s));
    valInput.value = String(Math.round(hsv.v));
    swatch.style.background = normalized;
    hexInput.value = normalized;
    syncing = false;

    onColorChange({
      barColor: normalized,
      glowColor: deriveGlowColor(normalized),
    });
    return true;
  }

  hueInput.addEventListener('input', () => {
    if (syncing) return;
    emitFromHsv(
      Number(hueInput.value),
      Number(satInput.value),
      Number(valInput.value),
    );
  });

  satInput.addEventListener('input', () => {
    if (syncing) return;
    emitFromHsv(
      Number(hueInput.value),
      Number(satInput.value),
      Number(valInput.value),
    );
  });

  valInput.addEventListener('input', () => {
    if (syncing) return;
    emitFromHsv(
      Number(hueInput.value),
      Number(satInput.value),
      Number(valInput.value),
    );
  });

  hexInput.addEventListener('change', () => {
    if (syncing) return;
    if (!applyHex(hexInput.value)) {
      hexInput.value = swatch.style.background || '#00e5ff';
    }
  });

  hexInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      hexInput.dispatchEvent(new Event('change'));
    }
  });

  return {
    sync(overrides) {
      const barColor = overrides?.barColor ?? '#00e5ff';
      applyHex(barColor);
    },
  };
}