# Dulcet II (v5) Implementation Notes

**Codename**: Dulcet II  
**Version**: v5 (major voice character stylization expansion)  
**Date**: June 2026  
**Status**: Companion reference for implementation  
**Related Documents**:
- `v5-development-roadmap.md` (branching plan)
- `v5-development-roadmap-supplemental.md` (voice stylization primitives & philosophy)

---

## Purpose

This document provides the implementation team (or coding agent) with a concise snapshot of the **current architecture**, explicit compatibility rules, open decisions with preferences, and practical guidance. It is meant to be read alongside the main roadmap and supplemental before starting work on the `dulcet` branches.

The goal of Dulcet II is to evolve the voice system from preset-driven effects into a powerful, mix-and-match **modular DSP primitive system** optimized for highly stylized fantasy / video-game / anime / V-tuber character voices ("V-tuber on steroids") while maintaining full backward compatibility.

---

## Current Architecture Snapshot (June 2026)

### Key Files in `src/voice/`
- `filter-graphs.ts` — Current FFmpeg `-af` graph construction for export.
- `resolve-config.ts` — Resolves preset + intensity/turbo into concrete DSP parameters.
- `types.ts` — Core type definitions (see `VoiceEffectConfig` below).
- `presets.ts` — Definition of existing presets (`deeper`, `higher`, `slight-mask`, `robot`, `whisper`, `custom`).
- `preview-chain.ts` + `process-audio.ts` — Web Audio API preview chain used in Design Studio.
- `voice-summary.ts` — Generates human-readable voice effect summaries.
- `index.ts` — Module entry point.

### Current Voice Configuration Shape (`VoiceEffectConfig`)
```ts
interface VoiceEffectConfig {
  enabled: boolean;
  intensity: number;        // 0-10
  turbo: boolean;           // special high-intensity mode (internally 12)
  presetId: VoiceEffectPresetId; // 'deeper' | 'higher' | ... | 'custom'
  pitchShift?: PitchShiftConfig;
  eq?: EqBandConfig;
  dynamics?: DynamicsConfig;
  reverb?: ReverbConfig;
}