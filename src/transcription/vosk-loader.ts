import { createModel, type Model } from 'vosk-browser';

let modelPromise: Promise<Model> | null = null;
let loadedModelUrl: string | null = null;

export async function loadVoskModel(
  modelUrl: string,
  onStage?: (stage: string) => void,
): Promise<Model> {
  if (modelPromise && loadedModelUrl === modelUrl) {
    return modelPromise;
  }

  if (modelPromise) {
    await disposeVoskModel();
  }

  loadedModelUrl = modelUrl;
  onStage?.('loading-model');

  modelPromise = createModel(modelUrl).then((model) => {
    onStage?.('model-ready');
    return model;
  });

  return modelPromise;
}

export async function disposeVoskModel(): Promise<void> {
  if (!modelPromise) return;

  const model = await modelPromise.catch(() => null);
  model?.terminate();
  modelPromise = null;
  loadedModelUrl = null;
}

export function voskModelIsLoaded(): boolean {
  return modelPromise !== null;
}