# Engineering Principles — Reddit Voice Notes

Project-wide design rules. Read before changing pipelines, health signals, timeouts, or user-facing quality settings.

---

## Semantic health checking (required)

Health and progress signals must reflect **actual work-state**, not merely that a process is still running.

### Syntactic vs semantic

| Kind | What it checks | Example anti-pattern |
|------|----------------|----------------------|
| **Syntactic** | Something responded recently | Offscreen `*-heartbeat` progress every 8s while FFmpeg is stuck at 20% |
| **Semantic** | Meaningful state advanced toward completion | Ratio increased, stage changed to `transcoding-done`, bytes written, phase exited |

**Rule:** Timeouts, stall detectors, and UI progress must use **semantic** signals. Syntactic liveness may be logged or shown separately but must **not** reset failure timers or imply success.

### Checklist for new health/progress code

1. **What invariant does “healthy” mean?** Name the concrete state change (e.g. “FFmpeg ratio increased”, “ACK received”, “MP4 ftyp validated”).
2. **Can this signal fire without that invariant?** If yes, it is syntactic — do not wire it to stall/timeout recovery.
3. **Does cancel propagate to the layer doing real work?** Client abort must reach workers/queues, not only drop listeners.
4. **Does supersession drain zombies?** A replaced job must not block the next one.
5. **Review question:** “If this signal fires forever, is the user still stuck?” If yes, fix the signal or add a wall-clock ceiling on the real operation.

### Reference implementation

- `src/ffmpeg/transcoder.ts` — `isMeaningfulProgress()`; heartbeats excluded from stall reset (BUG-006).
- `entrypoints/offscreen/main.ts` — heartbeats tagged `*-heartbeat`; wall-clock job timeout independent of heartbeat traffic.
- `src/ffmpeg/transcode-cancel.ts` — cancel reaches FFmpeg dispose.

---

## Ideally constrained user settings (audio and beyond)

When exposing quality toggles, prefer **`ideal` MediaTrackConstraints** (and similar APIs) over hard `exact` requirements so devices can negotiate down without failing.

### Audio capture defaults (pretty-3 target)

| Setting | Default | User opt-in |
|---------|---------|-------------|
| Browser DSP (`echoCancellation`, `noiseSuppression`, `autoGainControl`) | **On** (economy / speech-friendly) | Off via “raw microphone capture” |
| Sample rate / channels | Browser default (economy) | Ideal 48 kHz + ideal stereo via “enhanced capture” |

### Graceful degradation ladder

1. Try the fullest constraint set implied by prefs.
2. On `OverconstrainedError`, peel back ideals (stereo → mono, drop sampleRate ideal, processing flags only).
3. Final fallback: `{ audio: true }` — recording must still work.

### Migration

- New prefs fields merge with defaults in `loadUserPreferences()`; never require a storage version bump for additive audio keys.
- UI placeholders in the settings shell may ship before behavior is enabled; pipeline reads prefs through `src/recorder/mic-constraints.ts` only.

### Reference implementation

- `src/recorder/mic-constraints.ts` — constraint builders + `acquireMicStream()` fallback ladder.
- `src/settings/user-preferences.ts` — `AudioPreferences` schema + normalization.