import {
  deriveGlowColor,
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
} from '@/src/theme/color-utils';
import type { DesignOverrides } from '@/src/theme/design-overrides';
import { mountRadialKnob } from '@/src/ui/design-studio/radial-knob';

export interface ColorPickerControls {
  sync(overrides: DesignOverrides | null | undefined): void;
  isUserAdjusting(): boolean;
}

const HUE_WHEEL_SIZE = 132;
const HUE_RING_INNER = 42;
const HUE_RING_OUTER = 58;

export function renderColorPickerFields(): string {
  return `
    <div class="studio__color-panel" data-color-panel>
      <div class="studio__color-knobs">
        <div class="studio__hue-wheel-host" data-hue-wheel-host>
          <canvas
            class="studio__hue-wheel"
            data-hue-wheel
            width="${HUE_WHEEL_SIZE}"
            height="${HUE_WHEEL_SIZE}"
            aria-label="Hue wheel"
          ></canvas>
          <span class="studio__hue-wheel-core" data-hue-core aria-hidden="true"></span>
          <span class="studio__hue-wheel-marker" data-hue-marker aria-hidden="true"></span>
        </div>
        <div class="studio__sv-knobs">
          <div class="studio__knob-host" data-sat-knob-host></div>
          <div class="studio__knob-host" data-val-knob-host></div>
        </div>
      </div>
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
      <p class="popup__micro studio__color-note">
        Turn the hue ring and saturation / brightness knobs — glow follows your bar color.
      </p>
    </div>
  `;
}

function clientToHue(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radians = Math.atan2(clientY - cy, clientX - cx);
  let degrees = (radians * 180) / Math.PI + 90;
  if (degrees < 0) degrees += 360;
  return Math.round(degrees % 360);
}

function hueToMarkerPosition(hue: number): { x: number; y: number } {
  const radians = ((hue - 90) * Math.PI) / 180;
  const radius = (HUE_RING_INNER + HUE_RING_OUTER) / 2;
  const center = HUE_WHEEL_SIZE / 2;
  return {
    x: center + radius * Math.cos(radians),
    y: center + radius * Math.sin(radians),
  };
}

function drawHueWheel(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const center = HUE_WHEEL_SIZE / 2;
  ctx.clearRect(0, 0, HUE_WHEEL_SIZE, HUE_WHEEL_SIZE);

  for (let hue = 0; hue < 360; hue += 1) {
    const start = ((hue - 90) * Math.PI) / 180;
    const end = ((hue + 1.5 - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(center, center, HUE_RING_OUTER, start, end);
    ctx.arc(center, center, HUE_RING_INNER, end, start, true);
    ctx.closePath();
    ctx.fillStyle = hsvToHex(hue, 100, 100);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(center, center, HUE_RING_INNER - 2, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1b';
  ctx.fill();
}

export function mountColorPickerControls(
  root: HTMLElement,
  onColorChange: (overrides: DesignOverrides) => void,
): ColorPickerControls {
  const panel = root.querySelector<HTMLElement>('[data-color-panel]')!;
  const swatch = panel.querySelector<HTMLElement>('[data-color-swatch]')!;
  const hexInput = panel.querySelector<HTMLInputElement>('[data-color-hex]')!;
  const hueWheel = panel.querySelector<HTMLCanvasElement>('[data-hue-wheel]')!;
  const hueCore = panel.querySelector<HTMLElement>('[data-hue-core]')!;
  const hueMarker = panel.querySelector<HTMLElement>('[data-hue-marker]')!;
  const satKnobHost = panel.querySelector<HTMLElement>('[data-sat-knob-host]')!;
  const valKnobHost = panel.querySelector<HTMLElement>('[data-val-knob-host]')!;

  let syncing = false;
  let userAdjusting = false;
  let hue = 180;
  let sat = 100;
  let val = 100;

  drawHueWheel(hueWheel);

  function setUserAdjusting(next: boolean): void {
    userAdjusting = next;
  }

  function overridesFromHsv(h: number, s: number, v: number): DesignOverrides {
    const barColor = hsvToHex(h, s, v);
    return {
      barColor,
      glowColor: deriveGlowColor(barColor),
    };
  }

  function paintHueMarker(): void {
    const pos = hueToMarkerPosition(hue);
    hueMarker.style.left = `${pos.x}px`;
    hueMarker.style.top = `${pos.y}px`;
    hueCore.style.background = hsvToHex(hue, sat, val);
  }

  function emitFromHsv(emit: boolean): void {
    const overrides = overridesFromHsv(hue, sat, val);
    swatch.style.background = overrides.barColor;
    hexInput.value = overrides.barColor;
    paintHueMarker();
    if (emit) onColorChange(overrides);
  }

  function setUIFromHex(hex: string, emit: boolean): boolean {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return false;
    const hsv = hexToHsv(normalized);
    if (!hsv) return false;

    syncing = true;
    hue = Math.round(hsv.h);
    sat = Math.round(hsv.s);
    val = Math.round(hsv.v);
    satKnob.setValue(sat, true);
    valKnob.setValue(val, true);
    swatch.style.background = normalized;
    hexInput.value = normalized;
    paintHueMarker();
    syncing = false;

    if (emit) onColorChange(overridesFromHsv(hue, sat, val));
    return true;
  }

  const satKnob = mountRadialKnob(satKnobHost, {
    label: 'Saturation',
    ariaLabel: 'Saturation',
    value: sat,
    onChange(next) {
      if (syncing) return;
      sat = next;
      emitFromHsv(true);
    },
  });

  const valKnob = mountRadialKnob(valKnobHost, {
    label: 'Brightness',
    ariaLabel: 'Brightness',
    value: val,
    onChange(next) {
      if (syncing) return;
      val = next;
      emitFromHsv(true);
    },
  });

  let hueDragging = false;

  function setHueFromPointer(clientX: number, clientY: number): void {
    if (syncing) return;
    hue = clientToHue(clientX, clientY, hueWheel.getBoundingClientRect());
    emitFromHsv(true);
  }

  hueWheel.addEventListener('pointerdown', (event) => {
    hueDragging = true;
    setUserAdjusting(true);
    hueWheel.setPointerCapture(event.pointerId);
    setHueFromPointer(event.clientX, event.clientY);
  });

  hueWheel.addEventListener('pointermove', (event) => {
    if (!hueDragging) return;
    setHueFromPointer(event.clientX, event.clientY);
  });

  hueWheel.addEventListener('pointerup', () => {
    hueDragging = false;
    setUserAdjusting(false);
  });

  hueWheel.addEventListener('pointercancel', () => {
    hueDragging = false;
    setUserAdjusting(false);
  });

  panel.addEventListener('focusin', () => setUserAdjusting(true));
  panel.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && panel.contains(next)) return;
    setUserAdjusting(false);
  });

  satKnobHost.addEventListener('pointerdown', () => setUserAdjusting(true));
  valKnobHost.addEventListener('pointerdown', () => setUserAdjusting(true));

  hexInput.addEventListener('change', () => {
    if (syncing) return;
    if (!setUIFromHex(hexInput.value, true)) {
      hexInput.value = swatch.style.background || '#00e5ff';
    }
  });

  hexInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      hexInput.dispatchEvent(new Event('change'));
    }
  });

  paintHueMarker();

  return {
    sync(overrides) {
      const barColor = overrides?.barColor ?? '#00e5ff';
      setUIFromHex(barColor, false);
    },
    isUserAdjusting() {
      return userAdjusting || hueDragging;
    },
  };
}