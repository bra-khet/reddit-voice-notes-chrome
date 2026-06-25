/**
 * Dulcet II (v5) — DSP fragment subsystem barrel.
 *
 * Unlike the `@/src/voice` barrel (which pulls FFmpeg via `process-audio`),
 * every module here is **pure data + string emitters** with no WASM import, so
 * this barrel is safe for the settings popup / Design Studio leaf paths.
 *
 * @see docs/dsp-foundation-design.md
 */

export * from './fragment-types';
export * from './renderer';
export * from './ffmpeg-renderer';
export * from './build-stylized-graph';
export * from './migrate-v1';
