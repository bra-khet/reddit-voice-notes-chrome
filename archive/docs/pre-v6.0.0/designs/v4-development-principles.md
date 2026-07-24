> **Archive provenance:** Archived after the v6.0.0 stable checkpoint — 2026-07-23.
> Original living path: `docs/v4-development-principles.md`.
> Preserved as pre-v6 engineering history; current rules live in `docs/engineering-principles.md`.

# v4 Development Principles — Streamlined Design for Smooth Eloquent / v4 Work

**Goal:** Make v4 (automated subtitles + profile polish) development predictable and resilient after the profile bug cluster of mid-2026.

**Design Studio (canonical):** `docs/design-studio.md` — start here for UI semantics, four sections, dirty-state taxonomy, and refresh guardrails. This file covers cross-branch pipeline law; Studio behavior lives in that doc.

**Primary sources synthesized here:** `docs/design-studio.md` (Design Studio suite semantics), `archive/progress/eloquent-branch.md`, `archive/progress/dulcet-branch.md`, `archive/progress/pretty-branch.md`, `docs/engineering-principles.md`, `docs/transcription-architecture.md`, `claude-progress.md`, `docs/eloquent-profile-handoff.md`, bug history (BUG-001…024), and observed pipeline patterns.

## 1. Branch & Release Model (Do Not Change Lightly)

- `main` = stable release line. Only merges that have passed the full phase gate land here.
- Feature branches (`eloquent` for v4) are used for a major version's lifecycle.
- **One phase per sprint.** Phases are large, intentional integrations (eloquent-0 spike, eloquent-1 parallel wire, eloquent-2 studio editor, eloquent-3 burn-in, eloquent-4 profiles+polish, eloquent-5 harden+release).
- Merge `eloquent` → `main` **only** after eloquent-5 passes the v4.0 gate.
- Use annotated checkpoint tags liberally for WIP recovery (`eloquent-profile-nominal`, `pretty-8-design-studio-prototype`, etc.).
- Always record the fallback tag before starting a risky sprint (see `docs/code-review.md`).

Restore command (canonical):
```bash
git checkout <stable-tag> && npm install && npm run dev
```

## 2. Core Architectural Invariants (Never Regress)

### Compositing Layers (strict bottom-to-top order in final MP4)
1. Background (theme + personal image/bokeh)
2. Audio bars + effects (glow, sparkle)
3. Subtitles (topmost; **never** drawn into the capture canvas; always a post-`base.mp4` FFmpeg burn-in)

`base.mp4` = canvas (bg+bars) + (optional voice -af) AAC  
`final.mp4` = base + burned subtitles (eloquent-3+)

### Preview = Output Guarantee
- The single canvas in `waveform.ts` (`captureStream`) is the video track source.
- Everything visible in Design Studio Live preview (including subtitles overlay in eloquent-2) must be reproducible by the export path.
- No parallel recorders for visuals.

### Pipeline-native solutions
- When export cannot express a feature directly (e.g. time-varying `drawtext` color), ship the closest pipeline-faithful analogue first — time slices, duplicate layers, `textfile=` indirection — and document the fidelity gap before changing renderers. See `docs/engineering-principles.md` § Pipeline-native solutions; example: `specialHueRainbow`.

### Capture Fork at Stop (the v4 parallel pattern)
At `stopRecording()` (after `validateWebmRecording`):
- Retain `webmBlob` for transcode.
- `webmClone = webmBlob.slice()` for transcription (non-destructive).
- Fire `TRANSCODE_*` and `TRANSCRIBE_*` **in parallel**, never `await` one before the other.
- Transcription failure or disable → silent fallback to `base.mp4` only (export still succeeds).

### Separate WASM Queues
- FFmpeg: `enqueueTranscodeJob` (single serialized worker).
- Vosk: `enqueueTranscribeJob` (separate serialized queue).
- **Do not run both concurrently** until memory profiling on target hardware for 2:00 cap (FFmpeg ~32 MB heap + Vosk ~40 MB model).

### Raw Audio for STT
- Transcription always runs on the raw captured clone (pre-voice-effect).
- Duration-preserving voice effects keep timing alignment for burn-in.
- Accept that STT text may not perfectly match stylized delivery when voice FX are on.

### Opt-in Heavy Features
- Vosk model load is deferred until user enables subtitles or explicit action.
- Same philosophy that kept voice effects and personal backgrounds from loading at startup.

## 3. Pipeline Discipline (Hardened Lessons)

### Semantic Health Checking (from BUG-006)
- Stall detection, progress, and timeouts must be driven by **meaningful state change** (ratio increase, stage label change, bytes processed, segment emission).
- Heartbeats are syntactic liveness only. They are logged but **never** reset stall timers.
- Wall-clock ceilings are independent safety nets.

### Binary Transport & Validation
- Explicit verify at every hop (`binary-verify.ts`, preflight, ftyp asserts).
- `.slice()` fresh buffers for every FFmpeg writeFile (BUG-002).
- Chunked base64 only where required by MV3 message size or page CSP (personal backgrounds); prefer transferables for PCM.

### Cancel & Supersession (BUG-005 pattern)
- `sessionEpoch` + `AbortController` on every long-running path.
- Cancel must reach the actual worker doing work (`disposeFfmpeg`, queue skip for transcribe).
- New sessions supersede prior jobs for the same tab.

### FFmpeg Strategy Hardening (BUG-007)
- Primary: `-fflags +genpts+igndts -fps_mode passthrough -r 24`.
- Fallback: `-vf fps=24`.
- Early abort + retry on dup storm detection.
- Keep the two-strategy shape unless profiling justifies more.

### Cap & Sizing Reality
- Enforced/display cap is **2:00** (BUG-001 lesson). Longer is deferred architectural work (chunked transport + lower video BPS).

## 4. Storage & Prefs Discipline (Born From the 2026-06 Bug Cluster)

The worst fragility came from concurrent RMW + boot races between subtitle draft persistence and profile/appearance application.

**Non-negotiable rules (see also `docs/code-review.md` and `docs/eloquent-profile-handoff.md`):**

- Every read or write of `rvnUserPrefs` is wrapped by `enqueuePrefsOp` (single promise chain).
- `applyClipProfile`, `saveAppearancePreferences`, and `saveTranscriptPreferences` are each **one atomic queue slot**.
- Studio boot order is **load → reconcile → mount(initialPrefs)**. No parallel loads.
- `prefsHydrated` gate: ignore storage listeners until first reconciled apply.
- Use `buildDraftConfig()` **closure** for subtitle draft (not bare method reference that can be undefined during construction).
- Never insert `flushPersist` (or equivalent early write) before profile Save/Update/Clone without the queue + guard discipline.
- `transcriptConfig` on `ClipProfile` holds **style + enabled flag**. Actual edited transcript text lives in session `rvnSessionTranscript` IDB until the user saves or eloquent-4 explicitly decides otherwise.
- Legacy profiles without `transcriptConfig` load as subtitles disabled.

When in doubt, re-read the handoff doc race rules section before touching `user-preferences.ts` or studio mount logic.

## 5. UI / Profile Save Pathways (Branching Discipline)

Every named customization (profiles today, styles, future packs) must expose:
- Update in place (dirty + saved entity selected)
- Clone (clean saved entity)
- Save to new (dirty saved entity)
- First save (no active saved entity)

Nested dirty (profile + referenced custom style) must prompt for roll-up, never silently lose one side.

Reuse `studio-save-pathways.ts` and `studio-exit.ts`.

## 6. Phase & Sprint Hygiene

- One major integration per sprint (the "X-N" in branch docs).
- Definition of done is written in the branch plan before coding the phase.
- At end of phase: build/zip gate + relevant smoke + checkpoint tag optional.
- Update `claude-progress.md` and release notes only on real milestones.
- After a bad series (like BUG-017–024), the next changes are **smaller** and **more heavily gated** by the review checklist.

## 7. Import & Barrel Rules (Maintainability)

- Popup and settings code must **not** import barrels that pull WASM (voice or transcription).
- Direct imports for summary formatters only (`voice-summary.ts`, subtitle formatters).
- `src/voice/types.ts` and `src/transcription/types.ts` are leaves; `resolve-config` and heavy impls are never re-exported from index.

## 8. How to Keep v4 Development Smooth

1. Start every session by naming the fallback tag (see `/code-review`).
2. Make the change **within one phase scope**.
3. Respect the four big guardrails:
   - Semantic progress only
   - Separate queues + no unprofiled concurrency
   - Serialized prefs (`enqueuePrefsOp` + hydration gate + buildDraftConfig closure)
   - Layer order + fork-at-stop + preview=output
4. Verify with build + targeted smoke before considering the phase "done".
5. If anything feels fragile, stop and restore from the named tag first, then diagnose in a clean tree.

## Quick Reference Table — v4 Touch Points

| Area                    | Key files / rules                                      | Review trigger |
|-------------------------|--------------------------------------------------------|----------------|
| Transcription wire      | voice-recorder.ts (fork), transcribe-*.ts, offscreen   | eloquent-1/3   |
| Burn-in export          | transcoder.ts, ffmpeg-runner.ts (new strategy)         | eloquent-3     |
| Subtitles panel + preview | subtitle-controls.ts, mount-clip-studio.ts; semantics in `docs/design-studio.md` §7 | eloquent-2/4 |
| Profile + transcriptConfig | clip-profiles.ts, user-preferences.ts, studio save/exit | eloquent-4 + any prefs change |
| Vosk sandbox / CSP      | vosk-sandbox-*.ts, transcription-architecture.md, wxt.config | Any sandbox edit |
| General pipeline        | All of the above + engineering-principles.md           | Always         |

**This document exists so that the next agent (or you after a weekend) does not have to re-read five branch docs and three handoff files to remember the shape of safe v4 work.**

Update this file when a new hard rule is discovered. Treat it as living project law for the v4 cycle.
