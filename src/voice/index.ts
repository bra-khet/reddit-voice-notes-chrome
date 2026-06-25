// Barrel for offscreen / harness / ffmpeg paths only — do not import from popup or settings UI
// (process-audio pulls ffmpeg-runner). Prefer direct paths: voice/types, voice/resolve-config, voice-summary.
export * from './types';
export * from './resolve-config';
export * from './voice-summary';
export * from './process-audio';
export * from './preview-chain';
