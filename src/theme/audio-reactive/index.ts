import type { AudioVizFrame } from './audio-frame';
import type { LayoutMode } from './layout';
import type { VisualizerParams } from './params';

export * from './audio-frame';
export * from './layout';
export * from './params';

export type AudioVisualKind = 'spectrum' | 'overlay';

export interface AudioVisualWants {
  bands?: boolean;
  waveform?: boolean;
}

/**
 * CHANGED: v6 visuals register factories behind a common render contract.
 * WHY: stateful simulations need isolated instances while both draw slots share discovery.
 */
export interface AudioVisual {
  readonly id: string;
  readonly kind: AudioVisualKind;
  readonly wants: AudioVisualWants;
  readonly supportsAfterimage?: boolean;
  readonly supportedLayouts?: readonly LayoutMode[];
  update?(frame: AudioVizFrame, dt: number): void;
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: AudioVizFrame,
    params: VisualizerParams,
  ): void;
}

export interface AudioVisualDefinition {
  readonly id: string;
  readonly kind: AudioVisualKind;
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

/** Creates a fresh preset instance so afterimages/agents never leak across canvases. */
export function resolveAudioVisual(kind: AudioVisualKind, id: string): AudioVisual | null {
  return definitions.get(definitionKey(kind, id))?.create() ?? null;
}

export function listAudioVisualDefinitions(
  kind?: AudioVisualKind,
): readonly AudioVisualDefinition[] {
  const registered = [...definitions.values()];
  return kind ? registered.filter((definition) => definition.kind === kind) : registered;
}
