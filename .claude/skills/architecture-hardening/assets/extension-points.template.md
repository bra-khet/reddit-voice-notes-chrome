<!--
  TEMPLATE — copy to docs/architecture/extension-points.md.
  This registry answers "where does a NEW <thing> plug in, and what must I keep
  in sync?" Each seam versions independently (e.g. "Voice Effects v2") so you can
  cite a precise contract from a future chat. UPDATE in place; bump the seam's
  version when its contract changes. Delete this comment after first fill.
-->

# Extension Points — Reddit Voice Notes

**Updated:** `<YYYY-MM-DD>` · **Reflects:** `<branch-or-tag>`
**Status:** Canonical registry of integration seams. Pair with
`docs/architecture/architecture-map.md` (the spine) and the canonical subsystem docs.

> For each seam: the **files to touch**, the **contract** to satisfy, the
> **sync points** (places that must change together), and whether a new instance
> needs **both a preview and a bake path** (the preview=bake promise).

---

## Voice effects — v1

- **Add a preset:** `<src/voice/presets.ts>` → register; intensity scaling in
  `src/voice/resolve-config.ts`.
- **Preview path:** `src/voice/preview-chain.ts` (Web Audio graph).
- **Bake path:** filter graph in `src/voice/filter-graphs.ts` → applied as `-af`
  in the transcode pass.
- **Preview=bake?** YES — a preset MUST have both, and they must read the same
  resolved config. A preview-only effect is a violation.
- **Sync points:** preset id ↔ summary (`src/voice/voice-summary.ts`) ↔ Studio
  control (`src/ui/design-studio/voice-controls.ts`).
- **Gotcha:** Web Audio `AudioParam` uses `.value` assignment (BUG-008).

## Subtitle effects — v1

- **Add a style/effect:** `<subtitle style config>` in
  `src/transcription/types.ts` (`SubtitleStyleConfig`).
- **Preview path:** `src/ui/design-studio/subtitle-*` + subtitle effects layer.
- **Bake path:** `src/ffmpeg/subtitle-burnin.ts` (drawtext strategies).
- **Preview=bake?** YES, with documented quantization where FFmpeg drawtext can't
  match canvas (static `fontcolor` per filter → time-sliced approximations).
- **Sync points:** style field ↔ preview render ↔ burn-in drawtext ↔ summary.
- **Gotcha:** use `textfile=` for cue text (punctuation-safe, BUG-031); no silent
  fallback on misconfig (BUG-030).

## Message pipelines — v1

- **Add a pipeline:** define `MSG_<NAME>_{START,ACK,OFFSCREEN,PROGRESS,COMPLETE,CANCEL}`
  in `src/messaging/types.ts`, mirroring the existing shape.
- **Relay:** add register/relay maps in `entrypoints/background.ts`
  (`jobId→tabId`), reuse `relay-registry.ts`. Decide tab-relay vs extension-page
  (`runtime.onMessage`) like burn-in's `skipTabRelay`.
- **Worker:** handle in `entrypoints/offscreen/main.ts` (or sandbox for eval-heavy).
- **Sync points:** failure path must broadcast COMPLETE **before** deleting the
  tab map (BUG-032); cross-pipeline races (e.g. burn-in waits for transcribe
  queue idle).

## Storage — v1

- **New small datum:** `chrome.storage.local` key; add to the storage map
  (`design-studio.md` §3.2); one writer only.
- **New large/structured datum:** a `src/storage/*-db.ts` IDB store + relay if a
  content script needs it (content scripts can't read extension IDB).
- **New cross-context signal:** a `rvn.<x>.ready` key + a poll/listener.
- **Preview=bake?** N/A, but: **never** put blobs or transcript text in prefs.

## Theme / background / canvas flair — v1

- **Preset/background:** `src/theme/presets.ts`, `src/theme/backgrounds.ts`;
  per-frame flair (bokeh/sparkle) reuses existing draw patterns — profile at the
  preview fps before merge.
- **Preview=bake?** YES — it appears in canvas capture, so it's in the export by
  construction; keep layout constants fixed (waveform aggregation risk).

## Design Studio surfaces — v1

- **New section/control:** nest inside the four bounded sections; reuse
  `studio-save-pathways.ts` / `studio-subpanel-guard.ts` (don't hand-roll
  confirms). Preserve `data-studio-panel`, `data-summary-*` contracts.
- **Dirty state:** respect the four independent dirty layers — don't collapse to
  one boolean (`design-studio.md` §3.5).

---

## How to extend this registry
When a feature introduces a genuinely new seam, add a `## <Seam> — v1` section
(don't fold it into an existing one if the contract differs). When an existing
seam's contract changes, bump its version and add a one-line note of what changed.
