/** Audio-style radial knob — minimum at bottom, maximum at top (12 o'clock). */

/** Bottom (6 o'clock) = minimum; top (12 o'clock) = maximum. */
const KNOB_MIN_DEG = 90;
const KNOB_MAX_DEG = -90;
const KNOB_SVG_NS = 'http://www.w3.org/2000/svg';

export interface RadialKnobHandle {
  setValue(value: number, silent?: boolean): void;
  getValue(): number;
}

export interface RadialKnobOptions {
  min?: number;
  max?: number;
  value: number;
  label: string;
  ariaLabel: string;
  onChange: (value: number) => void;
}

function valueToAngle(value: number, min: number, max: number): number {
  const t = max === min ? 0 : (value - min) / (max - min);
  return KNOB_MIN_DEG + t * (KNOB_MAX_DEG - KNOB_MIN_DEG);
}

function angleToValue(angleDeg: number, min: number, max: number): number {
  let angle = angleDeg;
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;

  // Valid travel is the right-side arc: bottom (90°) → top (-90°).
  if (angle > 90 || angle < -90) {
    angle = angle > 0 ? KNOB_MAX_DEG : KNOB_MIN_DEG;
  }

  const t = (KNOB_MIN_DEG - angle) / (KNOB_MIN_DEG - KNOB_MAX_DEG);
  return Math.round(min + t * (max - min));
}

function clientToAngle(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radians = Math.atan2(clientY - cy, clientX - cx);
  return (radians * 180) / Math.PI;
}

export function mountRadialKnob(root: HTMLElement, options: RadialKnobOptions): RadialKnobHandle {
  const min = options.min ?? 0;
  const max = options.max ?? 100;
  let value = Math.max(min, Math.min(max, options.value));
  let dragging = false;

  root.innerHTML = `
    <svg class="studio__knob-svg" viewBox="0 0 80 80" aria-hidden="true">
      <circle class="studio__knob-ring" cx="40" cy="40" r="34" />
      <path class="studio__knob-arc" data-knob-arc />
      <g data-knob-ticks></g>
      <line class="studio__knob-needle" x1="40" y1="40" x2="40" y2="14" data-knob-needle />
      <circle class="studio__knob-cap" cx="40" cy="40" r="6" />
    </svg>
    <span class="studio__knob-label">${options.label}</span>
    <span class="studio__knob-value" data-knob-value></span>
  `;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', options.ariaLabel);
  root.setAttribute('aria-valuemin', String(min));
  root.setAttribute('aria-valuemax', String(max));
  root.tabIndex = 0;

  const arcPath = root.querySelector<SVGPathElement>('[data-knob-arc]')!;
  const needle = root.querySelector<SVGLineElement>('[data-knob-needle]')!;
  const ticksGroup = root.querySelector<SVGGElement>('[data-knob-ticks]')!;
  const valueEl = root.querySelector<HTMLElement>('[data-knob-value]')!;

  const tickCount = 11;
  for (let i = 0; i < tickCount; i += 1) {
    const t = i / (tickCount - 1);
    const angle = (valueToAngle(min + t * (max - min), min, max) * Math.PI) / 180;
    const inner = 30;
    const outer = i % 5 === 0 ? 36 : 33;
    const x1 = 40 + inner * Math.cos(angle);
    const y1 = 40 + inner * Math.sin(angle);
    const x2 = 40 + outer * Math.cos(angle);
    const y2 = 40 + outer * Math.sin(angle);
    const tick = document.createElementNS(KNOB_SVG_NS, 'line');
    tick.setAttribute('class', 'studio__knob-tick');
    tick.setAttribute('x1', String(x1));
    tick.setAttribute('y1', String(y1));
    tick.setAttribute('x2', String(x2));
    tick.setAttribute('y2', String(y2));
    ticksGroup.append(tick);
  }

  function describeArc(startDeg: number, endDeg: number): string {
    const start = (startDeg * Math.PI) / 180;
    const end = (endDeg * Math.PI) / 180;
    const r = 34;
    const x1 = 40 + r * Math.cos(start);
    const y1 = 40 + r * Math.sin(start);
    const x2 = 40 + r * Math.cos(end);
    const y2 = 40 + r * Math.sin(end);
    const sweep = endDeg < startDeg ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 0 ${sweep} ${x2} ${y2}`;
  }

  function paint(silent = false): void {
    const angle = valueToAngle(value, min, max);
    needle.setAttribute('transform', `rotate(${angle} 40 40)`);
    arcPath.setAttribute('d', describeArc(KNOB_MIN_DEG, angle));
    valueEl.textContent = String(value);
    root.setAttribute('aria-valuenow', String(value));
    if (!silent) options.onChange(value);
  }

  function setFromPointer(clientX: number, clientY: number): void {
    const rect = root.getBoundingClientRect();
    value = angleToValue(clientToAngle(clientX, clientY, rect), min, max);
    paint();
  }

  root.addEventListener('pointerdown', (event) => {
    dragging = true;
    root.setPointerCapture(event.pointerId);
    setFromPointer(event.clientX, event.clientY);
  });

  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setFromPointer(event.clientX, event.clientY);
  });

  root.addEventListener('pointerup', () => {
    dragging = false;
  });

  root.addEventListener('pointercancel', () => {
    dragging = false;
  });

  root.addEventListener('keydown', (event) => {
    let next = value;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next += 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next -= 1;
    else return;
    event.preventDefault();
    value = Math.max(min, Math.min(max, next));
    paint();
  });

  paint(true);

  return {
    setValue(next, silent = false) {
      value = Math.max(min, Math.min(max, next));
      paint(silent);
    },
    getValue() {
      return value;
    },
  };
}