/**
 * 360° radial value dial — hue-wheel-style drag (pointer capture, spin around center).
 * Graphics: triangle slope wrapped around the ring; 0/100% meet at 12 o'clock (top);
 * tick marks every 10% with rising inner depth.
 */

const KNOB_CANVAS_SIZE = 96;
const KNOB_CENTER = KNOB_CANVAS_SIZE / 2;
const KNOB_R_OUTER = 38;
const KNOB_R_INNER_BASE = 32;
const KNOB_TRIANGLE_DEPTH = 16;

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

const KNOB_ANGLE_OFFSET = -90;

/** 0 / 100 at 12 o'clock; increases clockwise (full 360° = min → max). */
function valueToAngleDeg(value: number, min: number, max: number): number {
  const t = max === min ? 0 : (value - min) / (max - min);
  return KNOB_ANGLE_OFFSET + t * 360;
}

function angleDegToValue(angleDeg: number, min: number, max: number): number {
  const normalized = ((angleDeg % 360) + 360) % 360;
  const t = normalized / 360;
  return Math.round(min + t * (max - min));
}

function clientToAngleDeg(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radians = Math.atan2(clientY - cy, clientX - cx);
  const raw = (radians * 180) / Math.PI;
  return ((raw - KNOB_ANGLE_OFFSET) % 360 + 360) % 360;
}

function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function innerRadiusForValue(fraction: number): number {
  return KNOB_R_OUTER - fraction * KNOB_TRIANGLE_DEPTH;
}

function drawKnobFace(canvas: HTMLCanvasElement, value: number, min: number, max: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cx = KNOB_CENTER;
  const cy = KNOB_CENTER;
  ctx.clearRect(0, 0, KNOB_CANVAS_SIZE, KNOB_CANVAS_SIZE);

  ctx.beginPath();
  ctx.arc(cx, cy, KNOB_R_OUTER, 0, Math.PI * 2);
  ctx.arc(cx, cy, KNOB_R_INNER_BASE - 2, 0, Math.PI * 2, true);
  ctx.fillStyle = '#1a1a1b';
  ctx.fill();
  ctx.strokeStyle = '#343536';
  ctx.lineWidth = 2;
  ctx.stroke();

  const valueFraction = max === min ? 0 : (value - min) / (max - min);
  const valueAngle = valueToAngleDeg(value, min, max);
  const steps = 10;

  for (let i = 0; i <= steps; i += 1) {
    const fraction = i / steps;
    const angle = KNOB_ANGLE_OFFSET + fraction * 360;
    const innerR = innerRadiusForValue(fraction);
    const outer = polar(cx, cy, KNOB_R_OUTER - 1, angle);
    const inner = polar(cx, cy, innerR, angle);

    ctx.beginPath();
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(inner.x, inner.y);
    ctx.strokeStyle = i % 5 === 0 ? '#6a6d70' : '#4a4c4e';
    ctx.lineWidth = i % 5 === 0 ? 2 : 1.25;
    ctx.stroke();
  }

  if (valueFraction > 0.001) {
    const sweepDeg = valueFraction * 360;
    const wedgeSteps = Math.max(2, Math.ceil(sweepDeg / 4));
    ctx.beginPath();
    const startInner = polar(cx, cy, innerRadiusForValue(0), KNOB_ANGLE_OFFSET);
    ctx.moveTo(startInner.x, startInner.y);

    for (let i = 0; i <= wedgeSteps; i += 1) {
      const fraction = (i / wedgeSteps) * valueFraction;
      const angle = KNOB_ANGLE_OFFSET + fraction * 360;
      const point = polar(cx, cy, innerRadiusForValue(fraction), angle);
      ctx.lineTo(point.x, point.y);
    }

    const endOuter = polar(cx, cy, KNOB_R_OUTER - 1, valueAngle);
    ctx.lineTo(endOuter.x, endOuter.y);

    for (let i = wedgeSteps; i >= 0; i -= 1) {
      const fraction = (i / wedgeSteps) * valueFraction;
      const angle = KNOB_ANGLE_OFFSET + fraction * 360;
      const point = polar(cx, cy, KNOB_R_OUTER - 1, angle);
      ctx.lineTo(point.x, point.y);
    }

    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 213, 79, 0.24)';
    ctx.fill();
  }

  const pointer = polar(cx, cy, KNOB_R_OUTER - 3, valueAngle);
  ctx.beginPath();
  ctx.arc(pointer.x, pointer.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#d7dadc';
  ctx.fill();
  ctx.strokeStyle = '#ffd54f';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#272729';
  ctx.fill();
  ctx.strokeStyle = '#4a4c4e';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function mountRadialKnob(root: HTMLElement, options: RadialKnobOptions): RadialKnobHandle {
  const min = options.min ?? 0;
  const max = options.max ?? 100;
  let value = Math.max(min, Math.min(max, options.value));
  let dragging = false;

  root.innerHTML = `
    <canvas
      class="studio__knob-canvas"
      width="${KNOB_CANVAS_SIZE}"
      height="${KNOB_CANVAS_SIZE}"
      data-knob-canvas
      aria-hidden="true"
    ></canvas>
    <span class="studio__knob-label">${options.label}</span>
    <span class="studio__knob-value" data-knob-value></span>
  `;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', options.ariaLabel);
  root.setAttribute('aria-valuemin', String(min));
  root.setAttribute('aria-valuemax', String(max));
  root.tabIndex = 0;

  const canvas = root.querySelector<HTMLCanvasElement>('[data-knob-canvas]')!;
  const valueEl = root.querySelector<HTMLElement>('[data-knob-value]')!;

  function paint(silent = false): void {
    drawKnobFace(canvas, value, min, max);
    valueEl.textContent = String(value);
    root.setAttribute('aria-valuenow', String(value));
    if (!silent) options.onChange(value);
  }

  function setFromPointer(clientX: number, clientY: number): void {
    const rect = root.getBoundingClientRect();
    value = angleDegToValue(clientToAngleDeg(clientX, clientY, rect), min, max);
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