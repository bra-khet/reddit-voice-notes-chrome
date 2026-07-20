/**
 * Design Studio v4 — shared physical analog slider (track + tab assets).
 * Div-based with pointer capture so drags stay glued to one control.
 */

export const PHYSICAL_SLIDER_THUMB_PX = 28;
export const PHYSICAL_SLIDER_THUMB_HALF_PX = PHYSICAL_SLIDER_THUMB_PX / 2;

export type PhysicalSliderOrientation = 'horizontal' | 'vertical';

/** CSS `left` for the thumb centre at fraction `frac` (0–1) of inset travel. */
export function physicalSliderThumbLeft(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  return `calc(${PHYSICAL_SLIDER_THUMB_HALF_PX}px + (100% - ${PHYSICAL_SLIDER_THUMB_PX}px) * ${f})`;
}

/** CSS `top` for a vertical thumb at fraction `frac` (0–1) of inset travel. */
export function physicalSliderThumbTop(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  return `calc(${PHYSICAL_SLIDER_THUMB_HALF_PX}px + (100% - ${PHYSICAL_SLIDER_THUMB_PX}px) * ${f})`;
}

export function physicalSliderValueToFraction(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0;
}

/** Snap a pointer x to the slider's stepped, clamped value (thumb-inset travel). */
export function physicalSliderValueFromX(slider: HTMLElement, clientX: number): number {
  const min = Number(slider.dataset.min);
  const max = Number(slider.dataset.max);
  const step = Number(slider.dataset.step) || 1;
  const rect = slider.getBoundingClientRect();
  const usable = rect.width - PHYSICAL_SLIDER_THUMB_PX;
  const frac = usable > 0 ? (clientX - rect.left - PHYSICAL_SLIDER_THUMB_HALF_PX) / usable : 0;
  const raw = min + Math.max(0, Math.min(1, frac)) * (max - min);
  return Math.max(min, Math.min(max, Math.round(raw / step) * step));
}

/** Snap either axis to the slider's stepped value; vertical values increase top→bottom. */
export function physicalSliderValueFromPointer(
  slider: HTMLElement,
  clientX: number,
  clientY: number,
): number {
  if (slider.dataset.orientation !== 'vertical') {
    return physicalSliderValueFromX(slider, clientX);
  }
  const min = Number(slider.dataset.min);
  const max = Number(slider.dataset.max);
  const step = Number(slider.dataset.step) || 1;
  const rect = slider.getBoundingClientRect();
  const usable = rect.height - PHYSICAL_SLIDER_THUMB_PX;
  const frac = usable > 0 ? (clientY - rect.top - PHYSICAL_SLIDER_THUMB_HALF_PX) / usable : 0;
  const raw = min + Math.max(0, Math.min(1, frac)) * (max - min);
  return Math.max(min, Math.min(max, Math.round(raw / step) * step));
}

export interface PhysicalSliderRenderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  ariaLabel: string;
  orientation?: PhysicalSliderOrientation;
  /** Extra `data-*` attributes on the slider root (e.g. data-voice-intensity). */
  dataAttrs?: Record<string, string>;
}

export function renderPhysicalSliderHtml(options: PhysicalSliderRenderOptions): string {
  const frac = physicalSliderValueToFraction(options.value, options.min, options.max);
  const orientation = options.orientation ?? 'horizontal';
  const dataPairs = Object.entries(options.dataAttrs ?? {})
    .map(([key, val]) => `data-${key}="${val.replace(/"/g, '&quot;')}"`)
    .join(' ');
  const dataSuffix = dataPairs ? ` ${dataPairs}` : '';
  return `
    <div class="studio__physical-slider" data-slider data-orientation="${orientation}" data-min="${options.min}" data-max="${options.max}"
      data-step="${options.step}" data-value="${options.value}"${dataSuffix}
      role="slider" tabindex="0"
      aria-valuemin="${options.min}" aria-valuemax="${options.max}" aria-valuenow="${options.value}"
      aria-orientation="${orientation}"
      aria-label="${options.ariaLabel.replace(/"/g, '&quot;')}">
      <span class="studio__physical-slider-track"></span>
      <span class="studio__physical-slider-thumb" style="${orientation === 'vertical'
        ? `top:${physicalSliderThumbTop(frac)}`
        : `left:${physicalSliderThumbLeft(frac)}`}"></span>
    </div>`;
}

export interface PhysicalSliderWireOptions {
  /** Return false to skip emitting (e.g. while syncing or when disabled). */
  onValueChange?: (slider: HTMLElement, value: number, prev: number) => void;
  /** Called when the slider should be treated as disabled (turbo bypass, etc.). */
  isDisabled?: (slider: HTMLElement) => boolean;
  onInteractionStart?: (slider: HTMLElement) => void;
  onInteractionEnd?: (slider: HTMLElement) => void;
}

/** Apply a value to a slider: move thumb + aria; returns whether the value changed. */
export function setPhysicalSliderValue(slider: HTMLElement, value: number): boolean {
  const min = Number(slider.dataset.min);
  const max = Number(slider.dataset.max);
  const prev = Number(slider.dataset.value);
  slider.dataset.value = String(value);
  slider.setAttribute('aria-valuenow', String(value));
  const thumb = slider.querySelector<HTMLElement>('.studio__physical-slider-thumb');
  if (thumb) {
    const fraction = physicalSliderValueToFraction(value, min, max);
    // CHANGED: the shared physical track can now stand vertically for spatial Y controls.
    // WHY: Background positioning should reuse the established asset/control contract on both axes.
    if (slider.dataset.orientation === 'vertical') {
      thumb.style.left = '';
      thumb.style.top = physicalSliderThumbTop(fraction);
    } else {
      thumb.style.top = '';
      thumb.style.left = physicalSliderThumbLeft(fraction);
    }
  }
  return value !== prev;
}

/**
 * Wire pointer + keyboard interaction for all `[data-slider]` elements under `host`.
 * Returns a dispose function.
 */
export function wirePhysicalSliders(host: HTMLElement, options: PhysicalSliderWireOptions = {}): () => void {
  let activeSlider: HTMLElement | null = null;

  function emitValue(slider: HTMLElement, value: number): void {
    const prev = Number(slider.dataset.value);
    setPhysicalSliderValue(slider, value);
    options.onValueChange?.(slider, value, prev);
  }

  function onPointerDown(event: PointerEvent): void {
    const slider = (event.target as HTMLElement).closest<HTMLElement>('[data-slider]');
    if (!slider || !host.contains(slider)) return;
    if (options.isDisabled?.(slider)) return;
    event.preventDefault();
    activeSlider = slider;
    options.onInteractionStart?.(slider);
    try {
      slider.setPointerCapture(event.pointerId);
    } catch {
      // capture is best-effort
    }
    slider.focus({ preventScroll: true });
    emitValue(slider, physicalSliderValueFromPointer(slider, event.clientX, event.clientY));
  }

  function onPointerMove(event: PointerEvent): void {
    if (!activeSlider) return;
    if (options.isDisabled?.(activeSlider)) return;
    emitValue(activeSlider, physicalSliderValueFromPointer(activeSlider, event.clientX, event.clientY));
  }

  function onPointerEnd(): void {
    if (activeSlider) options.onInteractionEnd?.(activeSlider);
    activeSlider = null;
  }

  function onKeyDown(event: KeyboardEvent): void {
    const slider = (event.target as HTMLElement).closest<HTMLElement>('[data-slider]');
    if (!slider || !host.contains(slider)) return;
    if (options.isDisabled?.(slider)) return;
    const min = Number(slider.dataset.min);
    const max = Number(slider.dataset.max);
    const step = Number(slider.dataset.step) || 1;
    const current = Number(slider.dataset.value);
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else return;
    event.preventDefault();
    options.onInteractionStart?.(slider);
    emitValue(slider, Math.max(min, Math.min(max, next)));
    options.onInteractionEnd?.(slider);
  }

  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerup', onPointerEnd);
  host.addEventListener('pointercancel', onPointerEnd);
  host.addEventListener('keydown', onKeyDown);

  return () => {
    activeSlider = null;
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerEnd);
    host.removeEventListener('pointercancel', onPointerEnd);
    host.removeEventListener('keydown', onKeyDown);
  };
}
