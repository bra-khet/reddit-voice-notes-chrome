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
- `src/messaging/relay-registry.ts` + `entrypoints/background.ts` — offscreen→content tab relay survives MV3 SW restart; never delete relay maps before failure broadcast (BUG-032).
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
2. **Import gates** — static images **and animated GIFs** are importable (JPEG/PNG/WebP/GIF); video MIME types are schema-ready but rejected until a dedicated video path ships. Animated GIFs loop on the canvas (preview = recorder = MP4, no fidelity gap); see `docs/gif-animation-design-implementation.md`.
3. **Quota ladder** — per-file cap (8 MB images / 15 MB reserved video), max asset count, max total bytes; fail with typed `BackgroundImportError` before write.
4. **Orphan hygiene** — `pruneUnreferencedBackgrounds()` after deletes; prefs refs are the source of truth for retention.
5. **Canvas path (7b)** — Design Studio (extension page) reads ImageDB directly; **recorder content script** relays blob bytes via `BACKGROUND_BLOB_PORT` → `FileReader` data-URL decode → canvas draw. Personal image overrides theme background (fill + dim).
6. **Fallback** — missing/decode failure → theme gradient letterbox; never block recording.

### Reference implementation

- `src/storage/image-db.ts` — IndexedDB CRUD, import validation, object-URL cache.
- `src/storage/animated-background.ts` — animated GIF frame decode (`ImageDecoder`) + `frameAt` loop timing; canvas-native, captured into the export (no FFmpeg). See `docs/gif-animation-design-implementation.md`.
- `src/storage/background-refs.ts` — ref collection, reconcile, prune.
- `src/settings/user-preferences.ts` — `customBackgroundId` normalization on merge.

### Branching save pathways (required for user customization)

Named user entities (profiles, custom styles, and future ImageDB-backed assets) must expose **multiple persistence paths** so edits never dead-end.

| Path | When | Example |
|------|------|---------|
| **Update in place** | A saved entity is selected and dirty | Design Studio **Update profile** / **Update style** (two-step **Sure?** confirm) |
| **Clone** | A saved entity is selected and clean | Green **Clone** button (always visible) → copy, then edit → **Update** |
| **Save as new** | A saved entity is selected and dirty | Same green button, label **Save to new** → fork with edits (equivalent to edit-then-clone) |
| **First save** | No saved entity selected yet | **Save as profile** / **Save as style** |

**Path equivalence:** Clone → edit → Update and edit → Save to new must both reach the same forked entity without dead ends.

**Nested dirty state (roll-up):** When a profile references a custom style and **both** are dirty, never silently “update profile” and leave colors inconsistent. Prompt whether to bundle style changes (update existing style, save style as new, or embed overrides on the profile). Same pattern applies when adding new customization layers (e.g. background libraries, effect packs).

**Rules:**

1. **No false-success** — if storage would still disagree with the canvas after an action, keep the entity dirty or block with a clear prompt.
2. **Offer forks** — green **Clone** / **Save to new** stays visible for every saved entity; label reflects clean vs dirty (unless quota-full).
3. **Dependency order** — persist depended-on entities first (style → profile) when the user opts in to roll-up.
4. **Reuse helpers** — new studio surfaces should call `studio-save-pathways.ts` / `studio-exit.ts`, not one-off confirm logic.

### Reference implementation

- `src/ui/design-studio/studio-save-pathways.ts` — save-as-new + style roll-up prompts
- `src/ui/design-studio/studio-exit.ts` — exit guard, update-with-style option
- `src/ui/design-studio/mount-clip-studio.ts` — Update vs Save to new buttons

### Pipeline-native solutions (required for new effects)

When a feature “should” vary over time or depend on expressive filter math, **start from what the export path can actually do** — then find the closest faithful approximation. Do not expand scope (new renderers, libass revival, frame pre-bakes) until a pipeline-native workaround is understood and documented.

**Process:**

1. **Name the real constraint** — e.g. FFmpeg `drawtext` `fontcolor` is static per filter instance in our wasm burn-in path.
2. **Map preview vs bake** — canvas/RAF can be fully expressive; export may need quantization, duplicate layers, or a different subsystem.
3. **Ship the closest working analogue** — time-sliced static colors, stacked drawtext duplicates for glow/border, `textfile=` for escaping (BUG-031).
4. **Document the fidelity gap** — e.g. rainbow: **slice rate** (`RAINBOW_BAKE_SLICE_SECONDS`) fixes step frequency; **cycle speed** only changes hue delta per step (faster rotation can look choppier). See `docs/design-studio.md` §7.4.
5. **Only escalate pipeline** when the workaround’s cost or quality ceiling blocks the product goal.

**Reference:** `specialHueRainbow` — `temporalizeDrawtextColor()` in `subtitle-effects.ts` / `subtitle-burnin.ts`; live hue via `previewTimeMs` in `subtitle-preview.ts`. Canonical Studio notes: `docs/design-studio.md` §7.4.

---

### Canvas personalization (pretty-8 design studio)

**Canonical Studio reference:** `docs/design-studio.md` — four sections (Bar style, Background, Voice, Subtitles), dirty-state taxonomy, storage map, and UI refresh guardrails.

- **Theme = data driving draw calls** — user overrides merge onto a base preset; do not fork parallel recorders.
- **Layout constants stay fixed** in the studio v1 scope (no bar count/spacing/width sliders) — reduces risk to `waveform.ts` aggregation and preview=WYSIWYG guarantees.
- **Cheap per-frame flairs only** — bokeh, sparkle/twinkle presets reuse existing background draw patterns; profile at 24 fps before merge.
- **Separate studio popup** for HSV/HEX and effect toggles; main popup remains the quick settings hub. See `pretty-branch.md` § Light design studio.