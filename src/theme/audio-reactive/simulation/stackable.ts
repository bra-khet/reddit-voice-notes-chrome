import type { StackableEffectId } from '../catalog';
import { MAX_STACKABLE_EFFECTS } from '../catalog';
import type {
  AudioVisualRenderEnvironment,
  AudioVizFrame,
} from '../index';
import type { VisualizerParams } from '../params';
import { resolveVisualizerParams } from '../params';

/** A lightweight ordered visual that composites after the primary overlay and before the spectrum. */
export interface StackableEffect {
  readonly id: StackableEffectId;
  update?(frame: AudioVizFrame, dt: number): void;
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment?: AudioVisualRenderEnvironment,
  ): void;
  /** Current bounded paint-cost estimate, expressed as maximum element passes. */
  getPerformanceCost(): number;
}

export interface StackableEffectDefinition {
  readonly id: StackableEffectId;
  readonly label: string;
  readonly maxElements: number;
  readonly defaultParams?: Partial<VisualizerParams>;
  create(): StackableEffect;
}

const definitions = new Map<StackableEffectId, StackableEffectDefinition>();

export function registerStackableEffect(
  definition: StackableEffectDefinition,
): () => void {
  if (definitions.has(definition.id)) {
    throw new Error(`Stackable effect already registered: ${definition.id}`);
  }
  definitions.set(definition.id, definition);
  return () => definitions.delete(definition.id);
}

/** Idempotent registration for built-ins imported through multiple theme barrels. */
export function registerStackableEffectIfAbsent(
  definition: StackableEffectDefinition,
): boolean {
  const existing = definitions.get(definition.id);
  if (existing === definition) return false;
  if (existing) throw new Error(`Stackable effect already registered: ${definition.id}`);
  definitions.set(definition.id, definition);
  return true;
}

export function getStackableEffectDefinition(
  id: StackableEffectId,
): StackableEffectDefinition | null {
  return definitions.get(id) ?? null;
}

export function listStackableEffectDefinitions(): readonly StackableEffectDefinition[] {
  return [...definitions.values()];
}

interface StackableRuntime {
  definition: StackableEffectDefinition;
  instance: StackableEffect;
  lastTimeMs: number | null;
}

const canvasRuntimes = new WeakMap<HTMLCanvasElement, Map<StackableEffectId, StackableRuntime>>();

function resolveRuntime(
  canvas: HTMLCanvasElement,
  definition: StackableEffectDefinition,
): StackableRuntime {
  let runtimes = canvasRuntimes.get(canvas);
  if (!runtimes) {
    runtimes = new Map();
    canvasRuntimes.set(canvas, runtimes);
  }

  let runtime = runtimes.get(definition.id);
  if (!runtime || runtime.definition !== definition) {
    runtime = {
      definition,
      instance: definition.create(),
      lastTimeMs: null,
    };
    runtimes.set(definition.id, runtime);
  }
  return runtime;
}

/**
 * CHANGED: persisted stackable IDs now render in their saved order through isolated per-canvas state.
 * WHY: Rising Ember must compose predictably with a primary overlay without introducing a scene graph.
 */
export function renderStackableEffectsForCanvas(
  ids: readonly StackableEffectId[],
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: AudioVizFrame,
  overrides?: Partial<VisualizerParams>,
  environment?: AudioVisualRenderEnvironment,
): number {
  let renderedCount = 0;
  let estimatedCost = 0;

  for (let index = 0; index < ids.length && renderedCount < MAX_STACKABLE_EFFECTS; index += 1) {
    const id = ids[index];
    if (!id) continue;

    let duplicate = false;
    for (let prior = 0; prior < index; prior += 1) {
      if (ids[prior] === id) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    const definition = definitions.get(id);
    if (!definition) continue;
    const runtime = resolveRuntime(canvas, definition);
    const elapsedMs = runtime.lastTimeMs === null ? 0 : frame.timeMs - runtime.lastTimeMs;
    const dt = elapsedMs > 0 ? Math.min(elapsedMs / 1000, 0.1) : 0;
    runtime.lastTimeMs = frame.timeMs;

    const params = resolveVisualizerParams(definition.defaultParams, overrides);
    runtime.instance.update?.(frame, dt);
    runtime.instance.render(ctx, canvas, frame, params, environment);
    const cost = runtime.instance.getPerformanceCost();
    estimatedCost += Number.isFinite(cost) ? Math.max(0, cost) : 0;
    renderedCount += 1;
  }

  return estimatedCost;
}

export function resetStackableEffectsCanvas(canvas: HTMLCanvasElement): void {
  canvasRuntimes.delete(canvas);
}
