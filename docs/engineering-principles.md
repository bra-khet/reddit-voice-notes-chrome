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

### Personal backgrounds — ImageDB (pretty-7)

User background blobs are **too large for `chrome.storage.local`** (multi‑MB images; future lightweight video/loops may reach ~15 MB). Split storage by responsibility:

| Layer | Holds | Rationale |
|-------|--------|-----------|
| **`chrome.storage.local` (`rvnUserPrefs`)** | `customBackgroundId` (`bg-…` refs) + profile metadata | Small, cross-context, hot-swappable like theme ids |
| **IndexedDB (`rvnImageDb`)** | Blob + mime, dimensions, `mediaKind` | Large binary store; shared across popup, content script, service worker |

**Rules:**

1. **Never put blobs in prefs** — only normalized `bg-` ids; invalid ids strip on `reconcileBackgroundPreferences()`.
2. **Import gates** — pretty-7a allows **images only** (JPEG/PNG/WebP/GIF); video MIME types are schema-ready but rejected until canvas loop support ships.
3. **Quota ladder** — per-file cap (8 MB images / 15 MB reserved video), max asset count, max total bytes; fail with typed `BackgroundImportError` before write.
4. **Orphan hygiene** — `pruneUnreferencedBackgrounds()` after deletes; prefs refs are the source of truth for retention.
5. **Canvas path (7b+)** — resolve id → object URL → same `loadBackgroundIfNeeded()` hot-swap as bundled assets; preview = output.
6. **Fallback** — missing/decode failure → theme gradient letterbox; never block recording.

### Reference implementation

- `src/storage/image-db.ts` — IndexedDB CRUD, import validation, object-URL cache.
- `src/storage/background-refs.ts` — ref collection, reconcile, prune.
- `src/settings/user-preferences.ts` — `customBackgroundId` normalization on merge.

### Canvas personalization (pretty-8 design studio)

- **Theme = data driving draw calls** — user overrides merge onto a base preset; do not fork parallel recorders.
- **Layout constants stay fixed** in the studio v1 scope (no bar count/spacing/width sliders) — reduces risk to `waveform.ts` aggregation and preview=WYSIWYG guarantees.
- **Cheap per-frame flairs only** — bokeh, sparkle/twinkle presets reuse existing background draw patterns; profile at 24 fps before merge.
- **Separate studio popup** for HSV/HEX and effect toggles; main popup remains the quick settings hub. See `pretty-branch.md` § Light design studio.