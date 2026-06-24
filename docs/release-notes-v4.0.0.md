# Release notes — v4.0.0 **Eloquent I**

**Tag:** `v4.0.0` · **Codename:** Eloquent I · **Date:** 2026-06-24  
**Merge:** `eloquent` → `main` (92 commits from v3.1.0 baseline)  
**Restore:** `git checkout v4.0.0 && npm install && npm run dev`  
**Prior stable:** `v3.1.0` (main — Design Studio UX + voice effects, no subtitles)

## Summary

**Eloquent I** is the first major release with **optional automated subtitles** — client-side speech-to-text, a YouTube-style segment editor, and hard-burned captions in the final MP4. It ships on top of the full v3 stack (voice effects, clip profiles, personal backgrounds) and the **Design Studio v4 shell** (hero preview, status cards, sub-panels, 3-phase workflow guidance).

Subtitles are **fully opt-in**. Users who never enable transcription get the same fast record → transcode → attach path as v3.1.

## Highlights

### Automated subtitles (Vosk WASM)

| Area | What shipped |
|------|----------------|
| **STT engine** | Vosk WASM in a manifest sandbox iframe; ~40 MB model bundled at install |
| **Parallel pipeline** | `stopRecording()` forks WebM — transcode and transcribe run independently |
| **Edit before bake** | Recorder delivers `base.mp4` first; user edits transcript in Design Studio, then **Bake** burns subs |
| **Burn-in** | Second FFmpeg pass: `drawtext` chain with per-cue `textfile=` (punctuation-safe); backdrop plate compositing |
| **Repeatable** | Rebake anytime after transcript edits or a fresh recording — hint shown under bake status |
| **Disable guard** | Turning off Subtitles with an active transcript shows a confirm dialog (prevents accidental wipe) |

### Design Studio v4 shell

- Hero row: WYSIWYG live preview (628×348 artboard) + mask-cutout bezel frame
- 1×4 status card strip: Bar style · Background · Voice · Subtitles
- Sub-panel navigation with unified dirty exit guard
- Profile status strip: **Subtitles?** + **Ready?** with honest delivery badges (Pending / Ready / Timed out / No speech)
- Sub-panel WYSIWYG previews (bar style, background, caption text)
- Amber bake button with eligibility states: unavailable / ready / baking / complete

### Segment editor & fonts

- YouTube-style cue list with amber timecode treatment
- Segment-aware canvas preview (active cue highlights in live preview)
- DejaVu font family bundled (Sans, Serif, Mono, Condensed Bold) — WYSIWYG preview via FontFace API
- Honest font picker labels; burn-in uses matching TTF assets in WASM offscreen

### 3-phase creative workflow

Cross-tab guidance so users always know where they are:

1. **Design** — Design Studio (no recording yet)
2. **Capture** — Reddit tab (record voice note)
3. **Polish & Bake** — Design Studio (edit transcript, bake subs, attach)

Phase stepper + contextual CTAs on the Studio banner; recorder panel shows matching hints.

### Profiles & persistence

- `transcriptConfig` on clip profiles (toggle + style prefs); legacy profiles load as subtitles-off until **Update profile**
- Serialized prefs queue (`enqueuePrefsOp`) — race-safe appearance + subtitle writes
- Session transcript in `rvnSessionTranscript` IDB; relay registry hardened for service-worker restarts (BUG-032 class)

### Architecture & hardening (eloquent-5)

- `docs/architecture/` — architecture map, extension points, hardening backlog
- Vosk sandbox union narrowing (H3); relay SW-restart resilience (H4)
- Font loader per-face try/catch; burn-in failure needle audit
- Timeout / no-speech UX: status strip stays actionable; honest failure indicators

## Pipeline (unchanged semantics for v3 users)

```
stopRecording()
  → webmClone.slice()
  ├─ TRANSCODE_* → base.mp4 (canvas bg + bars + voice -af)
  └─ TRANSCRIBE_* → TranscriptResult (parallel, non-blocking)

Design Studio (optional):
  → edit segments → Confirm & save → Bake → BURNIN_* → final.mp4
```

**Compositing order (bottom → top):** Background → waveform bars → subtitles (burned in FFmpeg, never drawn on canvas).

## Build

```bash
npm install          # fetches Vosk model (~40 MB) + builds sandbox bundle
npm run build && npm run zip
# → .output/reddit-voice-notes-4.0.0-chrome.zip (~57 MB)
```

Release gate: `npm run build` + `npm run zip` pass. `npm run compile` may report pre-existing strictness warnings in background/loader files (non-blocking for WXT build).

## Upgrade from v3.1.0

1. Remove or disable the old build at `chrome://extensions`
2. Load the new zip (or checkout tag `v4.0.0` and run `npm run zip`)
3. Reload the extension and hard-refresh Reddit

Saved profiles, voice settings, personal backgrounds, and custom styles carry over in `rvnUserPrefs`. Legacy profiles need one **Update profile** to snapshot subtitle prefs.

**First-time subtitle use:** Open Design Studio → Subtitles → enable transcription → record on Reddit → return to Studio when transcript is Ready → edit if needed → Bake → attach on Reddit.

## Known limitations

- **2-minute recording cap** unchanged (BUG-001 deferred; 3:00 restoration is post-v4)
- **Bundle size** ~57 MB zip (Vosk model + DejaVu fonts + FFmpeg WASM)
- **Memory:** Do not run FFmpeg + Vosk concurrently; separate job queues with transcode-idle gate
- **STT input:** Raw captured audio (not voice-modulated export) for best recognition; burn-in timing aligns on final MP4
- **Canvas in background tab** still freezes (browser rAF behavior); audio records normally
- Sub-panel knob/slider SVG chrome not yet wired to controls

## Docs

| Doc | Purpose |
|-----|---------|
| `docs/design-studio.md` | Canonical Studio semantics (four sections, dirty state, storage) |
| `docs/transcription-architecture.md` | MV3 CSP / Vosk sandbox audit |
| `docs/eloquent-4-handoff.md` | Edit-before-bake pipeline handoff |
| `docs/architecture/` | v4 architecture map + hardening backlog |
| `eloquent-branch.md` | Full phase plan (eloquent-0 … eloquent-5) |

## Phase completion

| Phase | Status |
|-------|--------|
| eloquent-0 | Vosk spike + frozen types |
| eloquent-1 | Parallel transcribe wire |
| eloquent-2 | Studio subtitles panel + preview |
| eloquent-3 | FFmpeg burn-in export |
| eloquent-4 | Segment editor, fonts, profile UX, workflow guidance |
| eloquent-5 | Harden, docs, merge → **v4.0.0** |

---

**Tag history:** `v4.0.0` · `v3.7.0` · `v3.6.0` · `v3.1.0` · `v3.0.0` · `v2.0.0`