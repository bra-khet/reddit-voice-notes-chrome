import type { AudioVizFrame } from './audio-frame';
import type { LayoutMode } from './layout';
import type { VisualizerParams } from './params';
import { resolveVisualizerParams } from './params';

export * from './audio-frame';
export * from './catalog';
export * from './layout';
export * from './params';
export * from './simulation/agent';
export * from './simulation/activation-grid';
export * from './simulation/bounded-emitter';
export * from './simulation/flow-field';
export * from './simulation/simulation';
export * from './simulation/spatial-partition';

export type AudioVisualKind = 'spectrum' | 'overlay';

export interface AudioVisualWants {
  bands?: boolean;
  waveform?: boolean;
}

export type SpectrumAlignment = 'center' | 'bottom' | 'top';

/** Runtime-only canvas style needed by spectrum renderers; never persisted separately. */
export interface SpectrumRenderEnvironment {
  alignment: SpectrumAlignment;
  amplitudeMode: 'capture' | 'preview';
  reduceMotion: boolean;
  bars: {
    width: number;
    spacing: number;
    cornerRadius: number;
    glow: number;
  };
  colors: {
    bar: string;
    glow: string;
  };
}

export interface AudioVisualRenderEnvironment {
  /** Shared capture/preview identity for overlay behavior that has an honest synthetic-preview gap. */
  amplitudeMode?: 'capture' | 'preview';
  /** Explicit accessibility state for simulations; spectra keep their richer nested environment. */
  reduceMotion?: boolean;
  spectrum?: SpectrumRenderEnvironment;
}

/**
 * CHANGED: v6 visuals register factories behind a common render contract.
 * WHY: stateful simulations need isolated instances while both draw slots share discovery.
 */
export interface AudioVisual {
  readonly id: string;
  readonly kind: AudioVisualKind;
  readonly supportsAfterimage?: boolean;
  readonly supportedLayouts?: readonly LayoutMode[];
  update?(frame: AudioVizFrame, dt: number): void;
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
    environment?: AudioVisualRenderEnvironment,
  ): void;
}

export interface AudioVisualDefinition {
  readonly id: string;
  /** Human label used by registry-driven picker surfaces. */
  readonly label?: string;
  readonly kind: AudioVisualKind;
  /** Static input capability metadata; frame producers inspect this before acquiring optional data. */
  readonly wants: Readonly<AudioVisualWants>;
  /** Broad family name for future Style-panel grouping. */
  readonly family?: string;
  /** Hard element ceiling used by density/performance affordances. */
  readonly maxElements?: number;
  readonly defaultParams?: Partial<VisualizerParams>;
  create(): AudioVisual;
}

const definitions = new Map<string, AudioVisualDefinition>();

function definitionKey(kind: AudioVisualKind, id: string): string {
  return `${kind}:${id}`;
}

export function registerAudioVisual(definition: AudioVisualDefinition): () => void {
  const key = definitionKey(definition.kind, definition.id);
  if (definitions.has(key)) {
    throw new Error(`Audio visual already registered: ${key}`);
  }
  definitions.set(key, definition);
  return () => definitions.delete(key);
}

/** Idempotent registration for built-ins imported through more than one theme barrel. */
export function registerAudioVisualIfAbsent(definition: AudioVisualDefinition): boolean {
  const key = definitionKey(definition.kind, definition.id);
  const existing = definitions.get(key);
  // CHANGED: idempotence is limited to the same built-in definition object.
  // WHY: a future effect pack must not silently lose an accidental kind:id collision.
  if (existing === definition) return false;
  if (existing) throw new Error(`Audio visual already registered: ${key}`);
  definitions.set(key, definition);
  return true;
}

export function getAudioVisualDefinition(
  kind: AudioVisualKind,
  id: string,
): AudioVisualDefinition | null {
  return definitions.get(definitionKey(kind, id)) ?? null;
}

const NO_AUDIO_VISUAL_WANTS: Readonly<AudioVisualWants> = Object.freeze({});

/**
 * CHANGED: optional audio inputs are discoverable from registry metadata without creating a visual.
 * WHY: live capture must decide whether to sample the analyser waveform before it builds the frame.
 */
export function getAudioVisualWants(
  kind: AudioVisualKind,
  id: string,
): Readonly<AudioVisualWants> {
  return getAudioVisualDefinition(kind, id)?.wants ?? NO_AUDIO_VISUAL_WANTS;
}

/** Creates a fresh preset instance so afterimages/agents never leak across canvases. */
export function resolveAudioVisual(kind: AudioVisualKind, id: string): AudioVisual | null {
  return getAudioVisualDefinition(kind, id)?.create() ?? null;
}

export function listAudioVisualDefinitions(
  kind?: AudioVisualKind,
): readonly AudioVisualDefinition[] {
  const registered = [...definitions.values()];
  return kind ? registered.filter((definition) => definition.kind === kind) : registered;
}

interface CanvasVisualRuntime {
  definition: AudioVisualDefinition;
  instance: AudioVisual;
  lastTimeMs: number | null;
}

const canvasRuntimes = new WeakMap<HTMLCanvasElement, Map<string, CanvasVisualRuntime>>();

/**
 * Render a registered visual with stable per-canvas state.
 * CHANGED: registry dispatch now owns update timing and instance reuse.
 * WHY: particle smoothing must persist frame-to-frame without leaking across preview/capture canvases.
 */
export function renderAudioVisualForCanvas(
  kind: AudioVisualKind,
  id: string,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: AudioVizFrame,
  overrides?: Partial<VisualizerParams>,
  environment?: AudioVisualRenderEnvironment,
): boolean {
  const definition = getAudioVisualDefinition(kind, id);
  if (!definition) return false;

  let runtimes = canvasRuntimes.get(canvas);
  if (!runtimes) {
    runtimes = new Map();
    canvasRuntimes.set(canvas, runtimes);
  }

  const key = definitionKey(kind, id);
  let runtime = runtimes.get(key);
  if (!runtime || runtime.definition !== definition) {
    runtime = {
      definition,
      instance: definition.create(),
      lastTimeMs: null,
    };
    runtimes.set(key, runtime);
  }

  const elapsedMs = runtime.lastTimeMs === null ? 0 : frame.timeMs - runtime.lastTimeMs;
  const dt = elapsedMs > 0 ? Math.min(elapsedMs / 1000, 0.1) : 0;
  runtime.lastTimeMs = frame.timeMs;

  const params = resolveVisualizerParams(definition.defaultParams, overrides);
  runtime.instance.update?.(frame, dt);
  runtime.instance.render(ctx, canvas, frame, params, environment);
  return true;
}

/** Explicit teardown hook for long-lived canvases that switch capture sessions. */
export function resetAudioVisualCanvas(canvas: HTMLCanvasElement): void {
  canvasRuntimes.delete(canvas);
}
