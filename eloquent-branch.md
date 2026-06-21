# `eloquent` branch — automated subtitles & transcription (Vosk WASM)

**Status:** Not started — branch from **`main` v3.1.0** (2026-06).  
**Target release:** v4.0.0 on `main` after merge from `eloquent`.  
**Baseline:** `main` v3.1.0 (Design Studio collapsible UX, voice effects, hardened transcode pipeline).

**Related docs:** `.ignore/transcript-design-notes.txt`, `docs/engineering-principles.md`, `dulcet-branch.md`, `claude-progress.md`

## Goal

Add **optional automated subtitles** so users can burn readable captions into Reddit voice notes — without risking the stable record → canvas → transcode → attach flow or the v3 visual + voice personalization stack.

## North star

> Voice clips that are accessible and legible on mute — client-side, offline, and opt-in — while the fast path for users who skip transcription stays identical to v3.

Prioritize **parallel, non-blocking STT** on raw captured audio, editable transcripts in Design Studio, and a **separate FFmpeg burn-in pass** so subtitles sit above bars and background. No server round-trips, no baking captions into the canvas draw loop.

**v4.0 gate (on `eloquent`):** Spike Vosk in isolation (eloquent-0), wire parallel transcription from recorder stop (eloquent-1), Studio transcript editor + style prefs (eloquent-2), subtitle burn-in export (eloquent-3), profile persistence + polish (eloquent-4), then harden and tag **v4.0.0** on `main` (eloquent-5).

## Current state (v3.1.0 on `main`)

| Layer | Today |
|-------|--------|
| **Capture** | `getUserMedia` → `MediaRecorder` → muxed WebM (≤2:00 enforced) |
| **Visualization** | Canvas waveform at 24 fps; preview pixels = encoded video pixels |
| **Transcode** | Offscreen FFmpeg.wasm — single job queue; voice `-af` optional; BUG-007 dup-storm fix |
| **Visual personalization** | Design Studio — Bar style, Background, Voice collapsible panels; clip profiles |
| **Voice effects** | Post-capture FFmpeg `-af`; duration-preserving default; raw WebM retained until export succeeds |
| **Subtitles** | **None** — no STT, no caption layer, no burn-in pass |

**Integration opportunity:** Transcription fits as a **parallel post-stop fork** of the raw WebM blob. The existing transcode path produces `base.mp4` (background + bars + processed audio). Subtitles are a **later compositing stage** — never drawn in `waveform.ts`.

## Compositing layers (v4 design principle — do not regress)

Final frame order, bottom → top:

1. **Background** — theme gradient/image/bokeh + personal background (existing canvas pipeline).
2. **Audio bars** — waveform bars + glow/effects (foreground over background; canvas).
3. **Subtitles** — topmost foreground; burned in via **second FFmpeg pass** on `base.mp4`.

```
base.mp4  = canvas (bg + bars) + AAC audio   ← existing transcode (unchanged semantics)
final.mp4 = base.mp4 + hard-burned subtitles ← new optional pass (eloquent-3+)
```

**Subtitle readability:** Provide a user-configurable **subtitle backdrop** (semi-opaque plate, rounded rect, or lower-third strip) so text stays readable over animated bars. Preview on the master Design Studio canvas; burn-in must mirror the same stacking (backdrop → shadow → main text).

**Cheap text effects (pipeline-friendly):** Drop-shadow cheat (offset duplicate), outline cheat (directional duplicates or `drawtext` stroke), glow (blurred duplicate at low opacity). Keep state in prefs/profile alongside transcript style.

## Focus areas

### Speech-to-text (Vosk WASM)

- **Input:** Raw audio from cloned WebM at `stopRecording()` — **not** voice-modulated export (best recognition; duration-preserving voice effects keep burn-in timing aligned on final MP4).
- **Engine:** Vosk WASM (~50 MB model bundled); load once, reuse across sessions where possible.
- **Output:** `{ text, segments: [{ start, end, text }, ...] }` with wall-clock timestamps.
- **UX:** Opt-in / recommended toggle — honest copy about longer processing and memory use; skip = current v3 fast path.

### Parallel pipeline

- Clone WebM immediately after `MediaRecorder.stop()`.
- **Copy 1** → existing `TRANSCODE_*` path → `base.mp4` (unchanged contract).
- **Copy 2** → new `TRANSCRIBE_*` path → transcript result (non-blocking; failure → no subtitles, not failed export).
- User confirms or edits transcript before burn-in; disabled or unconfirmed → deliver `base.mp4`.

### Design Studio UX

- New **Subtitles / Captions** collapsible panel in the studio stack (**above Voice** — topmost foreground layer in the product model).
- Collapsed summary chip pattern (reuse `studio-section-summaries.ts`).
- Editable segment list or plain transcript editor; light timing nudge if needed.
- Style controls: font, position, backdrop, shadow/outline toggles; preview on master Live preview canvas (not a separate tertiary preview).
- Dirty-state + **Update / Clone / Save to new** follows existing profile pathways.

### Profile & storage

- Embed `transcriptConfig` / `subtitleStyle` on `ClipProfile` — additive merge in `loadUserPreferences()`; legacy profiles load as subtitles-off.
- Session-scoped transcript result until user acts (in-memory or `sessionStorage`); edited text persisted on profile save when enabled.

### Export & Reddit compatibility

- Hard-burned subs for Reddit upload path (required).
- Optional future: plain MP4 + `.vtt` sidecar (out of v4.0 gate unless trivial).
- Generate `.srt` (or equivalent) from edited segments → FFmpeg `subtitles` / `drawtext` burn-in on `base.mp4`.

## Engineering constraints

Read **`docs/engineering-principles.md`** before pipeline, studio, or worker work.

| Rule | Rationale |
|------|-----------|
| **Stable pipeline first** | Transcode path bit-identical when subtitles disabled or transcription fails |
| **Separate WASM queue** | Vosk (~50 MB) must **not** share `enqueueTranscodeJob` with FFmpeg without profiling — dedicated transcription queue or isolated offscreen doc |
| **Semantic health checking** | Transcription progress must reflect model load %, audio decode, segment emission — not heartbeat-only liveness |
| **Non-destructive capture** | Raw WebM clone is fork-only; never mutate the blob handed to transcode |
| **Subtitles last** | No subtitle draw in `waveform.ts` RAF loop; burn-in is post-`base.mp4` |
| **Raw-audio STT** | Clone pre-voice-modulation audio track; accept word mismatch vs stylized delivery |
| **Opt-in model load** | Do not load Vosk model at extension startup; load on first enable or explicit user action |
| **Cancel propagation** | `AbortController` / session epoch must drain transcription jobs like transcode (BUG-005 pattern) |
| **Branching save pathways** | Subtitle edits on saved profile → dirty + **Update profile**; reuse `studio-save-pathways.ts` / `studio-exit.ts` |
| **Lean dependency footprint** | Vosk is the one justified WASM add-on; no cloud STT in v4.0 |
| **Ideally constrained capture** | Transcription unrelated to mic constraints — do not conflate with `mic-constraints.ts` |

### Worker strategy

**Preferred (eloquent-0 audit):** Extend existing offscreen document with `MSG_TRANSCRIBE_*` command types — reuse messaging layer; separate internal queue from FFmpeg.

**Alternative:** Dedicated second offscreen document for transcription — cleaner isolation if memory profiling shows FFmpeg + Vosk contention.

Both are acceptable; decide in eloquent-0 with a short memory budget note in `claude-progress.md`.

## Likely touch points

```
src/recorder/voice-recorder.ts      # stop → clone WebM; parallel transcode + transcribe fork
src/ffmpeg/transcoder.ts            # base.mp4 contract; optional second-pass hook (eloquent-3)
src/ffmpeg/ffmpeg-runner.ts         # subtitle burn-in strategy (drawtext / subtitles filter)
src/ffmpeg/transcode-queue.ts       # keep FFmpeg serialized — do not add Vosk here
src/messaging/types.ts              # MSG_TRANSCRIBE_START / PROGRESS / COMPLETE / CANCEL
entrypoints/offscreen/              # Vosk worker host + queue
src/transcription/                  # NEW — types, vosk loader, segment parser, srt builder
src/ui/design-studio/               # Subtitles panel; extend mount-clip-studio.ts
src/ui/design-studio/studio-section-summaries.ts  # collapsed subtitle summary chips
src/ui/design-studio/studio-save-pathways.ts
src/ui/design-studio/studio-exit.ts
src/settings/clip-profiles.ts       # embed transcriptConfig + subtitleStyle
src/settings/user-preferences.ts    # merge + normalize additive fields
src/recorder/waveform.ts            # preview-only subtitle overlay (optional eloquent-2) — NOT baked here
```

## Out of scope (v4.0)

- Cloud STT APIs (Google, Whisper hosted, etc.)
- Real-time live captions during recording
- Multi-language auto-detection UI (manual language pick may ship if trivial)
- Baking subtitles into canvas `captureStream` video track
- Re-architecting the primary WebM → MP4 transcode
- Forensic-perfect caption timing sync without user edit affordances
- Chunked transport / >2:00 recordings (unchanged v3 limitation)
- ML voice conversion (remains Dulcet/v3 territory)

## Resolved decisions (2026-06)

| Decision | Choice |
|----------|--------|
| STT input | **Raw audio** from cloned WebM (not voice-modulated export) |
| Vosk packaging | Bundled, **opt-in** in UI with honest perf/memory copy |
| Compositing | Subtitles **topmost**; separate FFmpeg pass after `base.mp4` |
| Failure mode | Transcription failure → silent fallback to no subtitles; export still succeeds |
| Reddit path | Hard-burned subs |

## Open questions (resolve during eloquent-0 / eloquent-2)

- Default language model (English-only v4.0 vs small multi-lang table)?
- Auto language detection vs manual picker?
- Segment editor UX: per-line timing handles vs plain text + auto re-segment?
- Preview: canvas text overlay vs static frame sample for style tweaks?
- Model delivery: ship in zip vs lazy download on first enable (size vs UX)?

## Data model sketch

```ts
interface TranscriptSegment {
  start: number;   // seconds
  end: number;
  text: string;
}

interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  source: 'vosk' | 'manual';
}

interface SubtitleStyleConfig {
  enabled: boolean;
  fontFamily?: string;
  fontSize?: number;
  position?: 'bottom' | 'top' | 'center';
  backdrop?: {
    enabled: boolean;
    opacity?: number;      // 0–1
    borderRadius?: number;
    fullWidth?: boolean;   // lower-third strip
  };
  shadow?: { enabled: boolean; offsetX?: number; offsetY?: number; opacity?: number };
  outline?: { enabled: boolean; width?: number };
}

interface TranscriptConfig {
  /** User opted in to transcription for this profile/session */
  transcriptionEnabled: boolean;
  /** Edited transcript (post-STT) */
  result?: TranscriptResult | null;
  style: SubtitleStyleConfig;
}

// Additive on ClipProfile:
interface ClipProfile {
  // …existing visual + voice fields…
  transcriptConfig?: TranscriptConfig | null;
}
```

Session-scoped `lastTranscriptResult` may live outside profiles until the user saves or confirms export.

## Version 4 phase plan (`eloquent` branch)

`main` = v3.1 stable (Design Studio UX + voice). `eloquent` = v4 (subtitles). Phases are sequential; each phase is **one major integration**.

| Phase | Name | Scope | Status |
|-------|------|-------|--------|
| **eloquent-0** | Spike & types | Vosk WASM isolated on WebM blob; freeze `TranscriptResult`, `TranscriptConfig`, `SubtitleStyleConfig`; worker/queue decision; manual harness page | Pending |
| **eloquent-1** | Parallel wire | `stopRecording()` clones WebM; fire `TRANSCODE_*` + `TRANSCRIBE_*` in parallel; log/store result; no Studio UI yet | Pending |
| **eloquent-2** | Studio editor | Subtitles panel in Design Studio; editable transcript; style + backdrop preview on master canvas; collapsed summary chips | Pending |
| **eloquent-3** | Burn-in export | `.srt` generation; second FFmpeg pass `base.mp4` → `final.mp4`; full E2E when user confirms subs | Pending |
| **eloquent-4** | Profiles & polish | `transcriptConfig` on `ClipProfile`; Update/Clone/Save to new + exit guard; opt-in toggle copy; progress indicators; timing nudge | Pending |
| **eloquent-5** | Harden & release | Memory/perf budget, error surfaces, Reddit upload QA, docs, prod zip, merge `eloquent` → `main`, tag **v4.0.0** | Pending |

### eloquent-0 — audit checklist

- [ ] Trace WebM blob from `voice-recorder.ts` `stopRecording()` — identify clone point before `transcodeWebmToMp4()`
- [ ] Profile FFmpeg offscreen heap usage at 2:00 cap; estimate headroom for Vosk model + inference buffers
- [ ] Spike: load Vosk WASM + English model in isolation; feed WebM audio; return segments
- [ ] Decide offscreen extension vs second offscreen document; document queue isolation
- [ ] Freeze types in `src/transcription/types.ts` (no UI, no recorder wire)
- [ ] Optional harness: `entrypoints/transcribe-harness/` — file picker, model load button, JSON result dump

#### eloquent-0 — target handoff diagram

```
stopRecording()
  → webmBlob (validated)
  → webmClone = blob.slice()                    # non-destructive fork
  ├─ transcodeWebmToMp4(webmBlob, …)           # existing path → base.mp4
  └─ transcribeWebm(webmClone, …)            # NEW parallel path → TranscriptResult
       → offscreen: extract audio → Vosk → segments
```

#### eloquent-0 — frozen artifacts (target)

| File | Contents |
|------|----------|
| `src/transcription/types.ts` | `TranscriptResult`, `TranscriptSegment`, `TranscriptConfig`, `SubtitleStyleConfig` |
| `src/transcription/vosk-loader.ts` | Model load, WASM init, singleton lifecycle |
| `src/transcription/transcribe-audio.ts` | WebM → PCM → Vosk inference |
| `src/transcription/srt-builder.ts` | Segments → `.srt` string (stub OK in eloquent-0) |
| `src/transcription/index.ts` | Barrel — mark offscreen/harness only if it pulls Vosk |

### eloquent-1 — definition of done

Recorder stop clones WebM and dispatches both jobs without blocking either on the other. Transcription result stored (memory/session). Logs show segments for a test clip. Transcode success/failure unchanged from v3. Transcription failure does not fail export.

### eloquent-2 — definition of done

User opens Design Studio after a recorded clip, sees transcript (or empty state with opt-in explainer), edits text, adjusts subtitle style, sees preview overlay on master canvas. Export still delivers `base.mp4` only until eloquent-3.

### eloquent-3 — definition of done

User confirms subtitles → export runs burn-in pass → final MP4 contains readable hard subs. Disabled or unconfirmed → `base.mp4` identical to v3. Cancel mid-burn-in does not orphan next recording.

### eloquent-4 — definition of done

Subtitle settings persist on named clip profiles with same branching save behavior as visual/voice fields. Opt-in toggle prevents model load until enabled. Non-blocking status for transcription in progress / failed.

### eloquent-5 — definition of done

Stable v4.0.0 build; README + release notes; feature fully opt-in; v3 users unaffected; `npm run build` + `npm run zip` pass; tag on `main`.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Memory pressure (FFmpeg + Vosk WASM) | Separate queue/worker; load model once; lazy load on opt-in; monitor `performance.memory` in eloquent-0 |
| Transcode blocked by transcription | Parallel async paths; never `await` transcribe before starting transcode |
| Transcription fails silently | Non-blocking UI status; always fall back to no subtitles |
| Timing drift vs `base.mp4` | Raw-audio STT + duration-preserving voice FX; light manual timing edit in Studio |
| STT words ≠ heard voice (effects on) | Document tradeoff; raw-audio decision stands |
| Bundle size (+~50 MB model) | Opt-in copy; consider lazy model fetch if zip exceeds comfort threshold |
| FFmpeg subtitle filter quirks in WASM | Early spike in eloquent-3; `drawtext` fallback if `subtitles` filter unavailable |
| Session zombie jobs (BUG-005 class) | `sessionEpoch` + abort for transcribe queue same as transcode |

## Testing checklist (per phase)

- Vosk harness returns segments for sample WebM (eloquent-0)
- Parallel jobs: transcode completes when transcribe slow/fails (eloquent-1+)
- Studio shows/edits transcript; preview reflects style (eloquent-2+)
- Confirmed subs → burned MP4; disabled → v3-identical output (eloquent-3+)
- Profile save / update / clone / discard on exit (eloquent-4+)
- Cancel during transcribe or burn-in (eloquent-1+ / eloquent-3+)
- Reddit upload with hard subs (eloquent-5)
- Memory acceptable at 2:00 cap on target hardware (eloquent-5)

## Branch workflow

```bash
git checkout main
git pull
git checkout -b eloquent
```

Work one **eloquent-X** phase per sprint. Checkpoint tags optional (`eloquent-0-vosk-spike`, `eloquent-2-studio-editor`, etc.). Merge to `main` only after eloquent-5 passes the v4.0 gate.

Restore stable v3 without transcription work:

```bash
git checkout main && npm install && npm run dev
```

## Relationship to v3 modules

| v3 module | eloquent interaction |
|-----------|---------------------|
| `src/voice/` | Unchanged export path; STT reads **raw** clone, not `-af` output |
| `src/ffmpeg/` | Primary transcode untouched; new burn-in strategy only |
| `src/ui/design-studio/` | New Subtitles panel; V4 NOTE comments in mount-clip-studio already mark stack slot |
| `src/recorder/waveform.ts` | Optional preview overlay only — not encode path |

**Import rule (mirror Dulcet):** Popup/settings must not import a `src/transcription` barrel that pulls Vosk WASM. Direct imports for summary formatters only.

## Post-v4 ideas

- Lazy model download per language
- `.vtt` sidecar export
- Auto-translate (would require external API — separate scope)
- Ephemeral ~30s mic test in Studio (deferred from v3; still valid polish)

---

**This branch keeps the v3.1 pipeline 100% intact while adding subtitles as a clean, optional, parallel feature.** Detailed compositing and pipeline notes: `.ignore/transcript-design-notes.txt`.