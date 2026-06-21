# `dulcet` branch — voice profiles & audio stream modification

**Status:** Planning — branch not yet opened for implementation.  
**Target release:** v3.0.0 on `main` after merge from `dulcet`.  
**Baseline:** `main` v2.0.1 (Design Studio + hardened transcode pipeline).

**Related docs:** `docs/engineering-principles.md`, `pretty-branch.md`, `docs/bug-archive.md`, `claude-progress.md`

## Goal

Add **voice effects** (pitch shift, EQ, light stylization) so users can transform or lightly mask their voice in Reddit voice notes — without breaking the stable record → transcode → attach flow or the v2 visual personalization stack.

## North star

> Voice clips that sound intentional and fun — or a touch more anonymous — while staying client-side, private, and fast enough for ≤2-minute takes.

Prioritize **traditional DSP** with clear preview and graceful fallback. No ML voice conversion, no server round-trips, no pipeline re-architecture.

**v3.0 gate (on `dulcet`):** Ship isolated processor proof (dulcet-1), Design Studio preview (dulcet-2), MP4 integration (dulcet-3), profile persistence with v2 save pathways (dulcet-4), then harden and tag **v3.0.0** on `main` (dulcet-5).

## Current state (v2.0.1 on `main`)

| Layer | Today |
|-------|--------|
| **Capture** | `getUserMedia` via `mic-constraints.ts` (browser DSP on by default; raw/enhanced capture toggles in prefs) → `MediaRecorder` → WebM (≤2:00 enforced) |
| **Visualization** | Web Audio analyser → canvas waveform at 24 fps (`waveform.ts`); preview pixels = encoded video pixels |
| **Transcode** | Offscreen FFmpeg.wasm (`ffmpeg-runner.ts`, `transcoder.ts`); semantic stall detection; BUG-007 dup-storm fix; 60s client stall ceiling |
| **Visual personalization** | Design Studio (colors, personal backgrounds via ImageDB, bokeh/glow/sparkle); up to 12 clip profiles; Update / Clone / Save to new pathways |
| **Audio content** | **Unmodified** — AAC track is raw captured audio |

**Integration opportunity:** Voice processing fits as a **post-capture, pre- or in-transcode** step. Prefer extending the existing FFmpeg filter graph over a parallel encode path. Design Studio becomes the home for **visual + voice** customization; main popup stays the quick hub.

## Focus areas

### Voice effects (export + preview)

- Duration-preserving pitch shift (default) via FFmpeg `asetrate` + `atempo` (or equivalent Web Audio preview chain)
- Small preset library: Deeper, Higher, Slight mask, Robot, Whisper, Custom
- Optional follow-ons: 3-band EQ, normalize/compressor, light reverb — only after MVP pitch path is stable

### Design Studio UX

- New **Voice** section (or tab) reusing existing slider/debounce/preview patterns from color pickers and effect toggles
- **Preview-first:** hear processed audio before record+transcode; debounced updates; no fake progress
- Voice config dirty-state follows the same **Update / Clone / Save to new** model as clip profiles (see engineering principles)

### Profile & storage

- Embed `voiceEffectConfig` on existing `ClipProfile` — **do not** fork a parallel “voice-only profile” store unless a later phase proves it necessary
- Additive prefs merge in `loadUserPreferences()`; no storage version bump for new optional fields
- Existing visual-only profiles load with voice effects **disabled** (backward compatible)

### Pipeline & observability

- Raw WebM always retained in memory until export succeeds; processing failure → **silent fallback to raw audio** + user-visible signal (toast or phase label)
- New processing stage uses **semantic** progress only (`transcoder.ts` / offscreen patterns — no heartbeat-as-health)
- Cancel must propagate through any new worker/queue (`transcode-cancel.ts` pattern)

## Engineering constraints

Read **`docs/engineering-principles.md`** before pipeline, studio, or settings work.

| Rule | Rationale |
|------|-----------|
| **Semantic health checking** | Voice-process stage must advance measurable state (bytes written, filter stage done, ratio moved) — not syntactic pings |
| **Branching save pathways** | Voice edits on a saved profile → dirty + **Update profile**; clean → **Clone**; dirty fork → **Save to new**; reuse `studio-save-pathways.ts` / `studio-exit.ts` |
| **Non-destructive export** | Effects applied at export; capture blob unchanged; failure degrades to raw audio |
| **Duration-preserving default** | Keeps waveform video track in sync without re-timing viz; duration-changing effects are explicit opt-in and out of v3.0 gate |
| **Composable config** | Serializable `VoiceEffectConfig` → FFmpeg `-af` string or Web Audio node chain; no hard-coded UI-to-filter coupling |
| **Ideally constrained capture** | Voice *effects* are separate from mic *constraints* (`mic-constraints.ts`); do not conflate browser DSP toggles with post-capture DSP |
| **Lean dependency footprint** | No ONNX/TF.js/ML models in v3; bundle size and WASM memory already dominated by FFmpeg |
| **Stable over flashy** | Feature disabled by default or `enabled: false` until user opts in; presets gate extreme settings |
| **MVP paths untouched** | No parallel recorder; no second MediaRecorder graph for export |

## Likely touch points

```
src/recorder/voice-recorder.ts   # stop → transcode handoff; session epoch / cancel
src/recorder/mic-constraints.ts  # capture quality only (not voice effects)
src/recorder/waveform.ts         # viz timing; must stay aligned with processed audio duration
src/ffmpeg/ffmpeg-runner.ts      # extend command / -af filter graph
src/ffmpeg/transcoder.ts         # semantic progress + stall for new stage
src/ffmpeg/transcode-cancel.ts   # cancel propagation
entrypoints/offscreen/           # WASM worker host
src/settings/clip-profiles.ts    # embed voiceEffectConfig on ClipProfile
src/settings/user-preferences.ts # merge + apply profile helpers
src/ui/design-studio/            # new voice panel; extend mount-clip-studio.ts
src/ui/design-studio/studio-save-pathways.ts
src/ui/design-studio/studio-exit.ts
src/voice/                       # NEW — effect config, preset table, filter builders (dulcet-1)
```

## Out of scope (v3.0)

- ML voice conversion / cloning / formant-perfect gender shift
- Server-side or cloud processing
- Forensic-grade anonymization
- Real-time voice monitoring **during** recording (preview-only post-capture or demo buffer is fine)
- Duration-changing time-stretch as default
- Composable user-built effect chains (declarative fixed chain is enough for v3.0)
- Re-architecting the video waveform pipeline

## Pitch shift — starting hypothesis

Exaggerating natural direction (deeper → deeper, higher → higher) often sounds better for casual voice notes than large cross-range shifts. Ship:

- Manual semitone slider (−12 to +12)
- **Exaggerate natural** toggle (sign from coarse pitch estimate or user pick — detail in dulcet-0 audit)
- Moderate presets (±3 to ±8 semitones) before extreme values

```text
pitchRatio = 2^(semitones / 12)
```

Duration-preserving FFmpeg sketch: `asetrate=48000*pitchRatio,aresample=48000,atempo=1/pitchRatio` (exact string finalized in dulcet-1).

## Data model sketch

Voice config is **embedded in clip profiles**, not a separate top-level entity.

```ts
interface VoiceEffectConfig {
  enabled: boolean;
  pitchShift?: {
    semitones: number;           // -12 … +12
    preserveDuration: boolean;   // default true
    exaggerateNatural?: boolean;
  };
  eq?: { lowGain?: number; midGain?: number; highGain?: number };
  dynamics?: { normalize?: boolean; compressorEnabled?: boolean };
  reverb?: { amount?: number };  // 0–1
}

// Additive field on existing ClipProfile (src/settings/clip-profiles.ts):
interface ClipProfile {
  // …existing visual fields…
  voiceEffectConfig?: VoiceEffectConfig | null;
}
```

Bundled **voice presets** are hardcoded defaults (like theme presets), not stored in `savedProfiles`. Live edits dirty the active saved profile the same way a preset style switch now does (v2.0.1 behavior).

## Version 3 phase plan (`dulcet` branch)

`main` = v2 stable (visual personalization). `dulcet` = v3 (voice effects). Phases are sequential; each phase is **one major integration**.

| Phase | Name | Scope | Status |
|-------|------|-------|--------|
| **dulcet-0** | Audit & types | Map audio→FFmpeg handoff; recorder stop flow; messaging/offscreen contracts; freeze `VoiceEffectConfig`, preset table, filter-string notes | Planned |
| **dulcet-1** | Isolated processor | `src/voice/` + `processAudio(blob, config)` in offscreen; no-op + duration-preserving pitch; one supporting effect (gain/EQ); fallback to input blob on error; manual harness | Planned |
| **dulcet-2** | Studio preview UI | Voice section in Design Studio; Web Audio preview (demo buffer or last recording); pitch slider, presets, debounced playback; **no export wire yet** | Planned |
| **dulcet-3** | Pipeline wire | Hook recorder stop → voice process (if enabled) → existing transcode; semantic progress stage; cancel + stall; verify viz/audio sync at 2:00 cap | Planned |
| **dulcet-4** | Profile persistence | `voiceEffectConfig` on `ClipProfile`; Update/Clone/Save to new + exit guard; optional main-popup summary; 1–2 extra effects if budget allows | Planned |
| **dulcet-5** | Harden & release | Edge cases, perf budget (<5–10s added on mid-range HW for 2:00), docs, prod zip, merge `dulcet` → `main`, tag **v3.0.0** | Planned |

### dulcet-0 — audit checklist

- [ ] Trace WebM blob from `voice-recorder.ts` stop through messaging to offscreen FFmpeg argv
- [ ] Document where audio and video streams merge today (single WebM vs separate paths)
- [ ] Confirm waveform animation timing source (duration, sample count, wall clock)
- [ ] List semantic progress injection points for a `voice-process` phase
- [ ] Decide: single-pass FFmpeg `-af` vs pre-process audio blob then mux (prefer fewer passes)
- [ ] Commit frozen types + example filter graphs (no processing code required)

### dulcet-1 — definition of done

Isolated `processAudio()` returns a usable audio blob for enabled configs, returns input unchanged for `enabled: false`, and returns input on any failure. Performance and artifact notes in `claude-progress.md` or phase notes.

### dulcet-2 — definition of done

User opens Design Studio, adjusts voice settings, hears preview without recording or transcoding. Studio state may hold unsaved voice edits; export unchanged.

### dulcet-3 — definition of done

Record → apply active voice config → MP4 contains processed audio when enabled; disabled path bit-identical to v2. Cancel mid-process does not orphan the next recording (session epoch / queue drain).

### dulcet-4 — definition of done

Voice settings persist on named clip profiles with the same branching save behavior as visual fields. Loading an old profile without `voiceEffectConfig` behaves as voice-off.

### dulcet-5 — definition of done

Stable v3.0.0 build; README and bug-archive updated; feature can be disabled globally or per-profile without breaking v2 users.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Waveform/video desync if duration changes | Default `preserveDuration: true`; defer time-stretch |
| Quality loss on re-encode | High AAC bitrate; minimize pass count; A/B in dulcet-1 |
| Processing too slow on low-end hardware | Budget in dulcet-1; wall-clock ceiling + semantic stall; optional “light” preset |
| Filter graph debug pain | Keep graphs small, commented, logged; raw-audio fallback |
| Studio/prefs complexity | Reuse save-pathway helpers; embed on `ClipProfile` only |

## Testing checklist (per phase)

- Preview plays and reflects slider/preset changes (dulcet-2+)
- Full record → processed MP4 when enabled (dulcet-3+)
- Disabled voice → unchanged from v2 output (dulcet-3+)
- Profile save / update / clone / discard on exit (dulcet-4+)
- Cancel during voice process or transcode (dulcet-3+)
- Existing visual-only profiles unaffected (dulcet-4+)
- Performance acceptable at 2:00 cap on target hardware (dulcet-5)

## Branch workflow

```bash
git checkout main
git pull
git checkout -b dulcet
```

Work one **dulcet-X** phase per sprint. Checkpoint tags optional (`dulcet-1-processor-prototype`, etc.). Merge to `main` only after dulcet-5 passes the v3.0 gate.

Restore stable v2 without voice work:

```bash
git checkout main && npm install && npm run dev
```

## Immediate next step

**dulcet-0 audit** — read `src/recorder/voice-recorder.ts` and `src/ffmpeg/ffmpeg-runner.ts`, document the audio handoff, then commit frozen types under `src/voice/types.ts` (or equivalent) before any UI or pipeline edits.