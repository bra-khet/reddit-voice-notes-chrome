# Release notes — v5.3.1 **Voice live-mic preview**

**Tag:** `v5.3.1` (tentative) · **Date:** 2026-06-27
**Branch:** `feature/voice-preview-live-mic` (from `main` @ `e1e8991`)
**Restore:** `git checkout v5.3.1 && npm install && npm run dev`
**Prior stable:** `v5.3.0` (main — Subtitle QoL)
**Design + plan:** `docs/v5.3.1-voice-live-mic-preview-design-document.md`

## Summary

The Design Studio Voice panel can now audition the active voice character on **your own
live voice** — no prior Reddit recording required. A new **One-Time Test** button captures
a short mic sample, runs it through the *same* graph renderer as the export, and plays it
back; **Last Voice Note** (renamed from "Test character voice") still auditions your last
recording. Because both routes resolve through the same `resolveVoiceGraph()` +
`processAudioWithGraph()`, what you hear is byte-identical to what bakes.

The live-mic capture is **transient and never stored** — it cannot overwrite the last
recording held in browser memory. Everything stays client-side; no export, profile, or
storage-format changes.

## Highlights

### One-Time Test (live mic)

| Area | What shipped |
|------|----------------|
| **Audition your own voice** | "One-Time Test" captures ~10 s from the mic (click to start, "Stop & render" or auto-stop), renders the active graph, and plays it back |
| **Same path = same sound** | Reuses `resolveVoiceGraph` → `processAudioWithGraph` → the single `VoicePreviewHandle` — preview = bake, no second DSP backend |
| **Never persisted** | `src/voice/mic-test-capture.ts` is a pure leaf that imports no storage — the capture is in-memory only and cannot touch `rvnLastRecording` |
| **Prefs-faithful capture** | Uses `acquireMicStream(prefs.audio)` so the test honors the same raw/enhanced mic constraints (and fallback ladder) as the real recorder |
| **Live level meter** | An `AnalyserNode` RMS meter shows input level while recording (reduced-motion aware); AudioContext torn down on every exit path |

### Voice audition UX

- **Contrasting names, shared glyph:** "Last Voice Note" (stored Reddit recording) and
  "One-Time Test" (live mic) flank a shared mic icon — visuals say *same voice*, names say
  *different source*. Captions ("Stored recording from Reddit" / "Test recording — not
  stored") make the distinction — and the storage-safety rule — feel like a path forward.
- **One shared Stop button** (own row): "Stop & render" while capturing, "Stop" while
  playing, hidden otherwise — the test buttons no longer reflow.
- **Empty-state guidance:** with no saved recording, "Last Voice Note" is de-emphasized and
  "One-Time Test" is emphasized, with copy steering newcomers to the mic test.

## Notes / known follow-ups

- `docs/design-studio.md` §6.1–6.4 are stale (they describe the pre-Dulcet-II flat /
  Web-Audio voice world); §6.5 documents the current audition controls. A full §6 refresh
  is tracked separately.
- A11y: `role="meter"` + `aria-valuenow`, `aria-live` status, reduced-motion on animations.

## Files

- **New:** `src/voice/mic-test-capture.ts`, `docs/v5.3.1-voice-live-mic-preview-design-document.md`, this file.
- **Changed:** `src/ui/design-studio/voice-controls.ts`, `entrypoints/design-studio/style.css`,
  `docs/design-studio.md` (§6.5 + stale flag), `docs/architecture/extension-points.md`
  (new "Voice live-mic preview — v1" seam, v1.1).
