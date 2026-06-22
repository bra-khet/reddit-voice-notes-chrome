# eloquent-4 — subtitle management handoff (2026-06-22)

**Branch:** `eloquent`  
**Stable tags:**

| Tag | Commit | Meaning |
|-----|--------|---------|
| `v3.2.0` | `707709d` | Verified subtitle **burn-in** (BUG-025 drawtext-font) |
| `eloquent-4a-subtitle-mgmt` | `6c43775` | Edit-before-bake Studio UI (initial) |
| `v3.3.0` | `73e78f6` | **Release:** eloquent-4a verified — edit → bake → attach with edited SRT |
| `v3.3.1` | `ea636d3` | BUG-027 false **Update profile** highlight on Studio open |
| `v3.5.0` | `9df9e7a` | eloquent-4b subtitle editor polish + recorder Design Studio CTA |
| `v3.6.0` | `41e5818` | **Stable:** full edit→bake→attach loop + burn-in hardening (BUG-028…032) + pending transcript UX — user-verified multi-run |

**Prior profile baseline:** `eloquent-profile-nominal` (`8834d4e`) — still valid for prefs/profile race rules.

---

## Executive summary

eloquent-4 **phase A** shifts subtitle workflow from “auto-burn on record stop” to **review → edit → confirm → bake** in Design Studio. The Vosk `TranscriptResult.segments` JSON is the source of truth; users edit cues in a YouTube-style UI before a second FFmpeg pass burns hard subs.

**User-verified (2026-06-22):** Studio transcript preview, segment editor, Confirm & save, and bake complete with message *“Subtitles baked. Switch to your Reddit tab…”*. Full happy path verified: recorder reaches **stopped**, attach on Reddit works, and **edited SRT burns correctly**. Tagged **`v3.3.0`**. BUG-027 false **Update profile** highlight fixed in **`v3.3.1`**.

**User-verified (2026-06-22, `v3.6.0`):** Repeat recordings with and without transcript edits; **Pending → Ready** badges; apostrophe-heavy cues bake via `textfile=` (BUG-031); no transcribe relay warnings after SW/HMR reload (BUG-032). Tagged **`v3.6.0`** — restore point before eloquent-4b remainder / eloquent-5.

---

## Architecture — edit before bake

```
stopRecording() [Reddit content script]
  ├─ transcode → base.mp4 (recorder mp4Blob)     ← user can attach without subs
  ├─ relay base.mp4 → extension IDB (async)      ← Studio bake input
  └─ fork transcribe (if subtitles on)             ← background; no recorder bar %
       └─ relay transcript → extension IDB

Design Studio
  ├─ Load transcript from rvnSessionTranscript IDB
  ├─ Preview cues (read-only list)
  ├─ Edit modal (per-segment text + start/end)
  ├─ Confirm & save → IDB (original vs edited + confirmedAt)
  └─ Bake → burnInSubtitlesToMp4(base.mp4) → rvnLastBakedMp4 IDB
       └─ BAKED_MP4_READY_KEY → Reddit recorder applyBakedMp4()
```

**Compositing unchanged:** subtitles remain topmost FFmpeg burn-in — never drawn in `waveform.ts` RAF loop.

---

## Session transcript state (IDB)

**Store:** `rvnSessionTranscript` · key `last`

| Field | Role |
|-------|------|
| `originalResult` | Immutable Vosk baseline — **Discard** restores this |
| `editedResult` | Working / confirmed copy |
| `confirmedAt` | Set when user clicks **Confirm & save** |
| `capturedAt` | STT relay timestamp |

**Dirty semantics (UI):** `edited` vs `savedBaseline` (last confirmed), **not** vs Vosk original. After confirm, **Saved** badge shows and **Bake** enables.

**Profile storage:** `transcriptConfig` on profiles = **toggle + style only** (`transcriptConfigForProfileStorage` strips `result`). Transcript text/timing is **never** profile dirty state.

---

## Key files (eloquent-4a)

| Area | Files |
|------|--------|
| Segment editor UI | `src/ui/design-studio/subtitle-segment-editor.ts` |
| Subtitles panel + bake | `src/ui/design-studio/subtitle-controls.ts`, `subtitle-bake.ts` |
| Transcript helpers | `src/transcription/transcript-editing.ts` |
| Session IDB | `src/storage/session-transcript-db.ts` |
| Base MP4 for bake | `src/storage/last-base-mp4-db.ts`, `last-base-mp4-relay.ts` |
| Baked MP4 → recorder | `src/storage/last-baked-mp4-db.ts`, `baked-mp4-fetch.ts`, `messaging/baked-mp4-blob.ts` |
| Recorder orchestration | `src/recorder/voice-recorder.ts`, `src/ui/recorder-panel.ts` |
| Burn-in (unchanged) | `src/ffmpeg/subtitle-burnin.ts`, `burnin-client.ts` |

---

## Offscreen → content relay (BUG-032)

Transcode/transcribe progress and failures reach the Reddit content script via `tabs.sendMessage` (offscreen `runtime.sendMessage` does not reliably reach content scripts — see BUG-003).

**Registry:** `src/messaging/relay-registry.ts` persists `jobId → tabId` in `chrome.storage.session` so MV3 service worker restarts (WXT HMR) do not drop relays.

**Do not regress:** never `transcribeTabByJobId.delete(jobId)` before `relayTranscribeFailure`; register with `rememberRelayTab`; relay only offscreen-originated `MSG_*_PROGRESS|COMPLETE`.

---

## QA verified

| Step | Status |
|------|--------|
| Record with subtitles on → base MP4 | ✅ |
| Studio loads Vosk segments | ✅ |
| Edit modal → Apply to preview | ✅ |
| Confirm & save clears unsaved UI | ✅ (after `c68d4d6` baseline fix) |
| Bake completes in Studio | ✅ |
| Edited SRT burns into attached MP4 | ✅ |
| Baked MP4 relay to recorder + attach | ✅ (after BUG-026 fix) |
| Profile dirty on transcript edit only | ✅ isolated (style/toggle only) |
| False **Update profile** highlight on Studio open | ✅ fixed in **v3.3.1** (BUG-027) |
| Per-cue audio preview in segment editor | ✅ user-verified |
| OOB badge (`⚠ OOB`) when cue end past clip | ✅ (recorder timer; hidden when in-bounds) |
| Add cue in segment editor | ✅ user-verified |
| Recorder **Open Design Studio** CTA (subtitles on) | ✅ `v3.5.0` — `tabs.create` relay, no new permissions |
| Repeat bake with/without edits (multi-run) | ✅ `v3.6.0` — user-verified |
| Pending → Ready transcript badge on new recording | ✅ `v3.6.0` (BUG-031) |
| Apostrophe/comma-heavy cues burn correctly | ✅ `v3.6.0` (BUG-031 textfile) |
| No transcribe relay warning after dev reload | ✅ `v3.6.0` (BUG-032) |

---

## Bugs fixed in this arc

| ID | Symptom | Fix |
|----|---------|-----|
| **BUG-025** | Burn-in success log but no visible subs | drawtext-font + DejaVuSans.ttf (`v3.2.0`) |
| **eloquent-4a** | Confirm & save never cleared | `savedBaseline` vs `voskOriginal` dirty model |
| **eloquent-4a** | Bake disabled / appeared to hang | Dirty gate + status copy |
| **eloquent-4a** | Profile Update lit on transcript edit | `buildProfileStyleConfig()` — no `result` in profile match |
| **BUG-026** | Recorder stuck processing ~80% | Stopped before base-MP4 relay; transcribe off progress bar |
| **BUG-027** | **Update profile** highlighted on open, click no-op | Sync subtitle draft before profile dirty check (`v3.3.1`) |
| **BUG-028…030** | Burn-in regressions (colors, backdrop, silent SRT fallback, stale offscreen) | drawtext-only path; valid colors; offscreen recycle + code stamp |
| **BUG-031** | Apostrophes/commas break drawtext filter chain | Per-cue `textfile=` in WASM FS; unsaved bake guard; Pending/Ready badges |
| **BUG-032** | `No tab registered for transcribe relay` | `relay-registry.ts` session persistence; no map delete before `relay*Failure` |

See `docs/bug-archive.md` for full write-ups.

---

## BUG-026 — recorder popup stuck at 80% (detail)

### What the user saw

Studio bake succeeds, but Reddit **composer popup** stays on *Processing…* (~80%), so **Attach to Reddit** / **Download** never appear.

### Why

1. With subtitles on, transcribe progress was mapped to **56–80%** on the recorder bar while transcode had already finished.
2. `await relaySaveLastBaseMp4()` (large base64 `sendMessage`) ran **before** `setPhase('stopped')`, so a slow/hung relay prevented the UI from leaving processing.

### Fix (`BUG-026`)

- Transcribe fork: **no** recorder progress updates (`reportProgress: false`).
- `setPhase('stopped')` **immediately** after transcode; base-MP4 relay is fire-and-forget.
- `applyBakedMp4` may promote `processing → stopped` when base `mp4Blob` exists (baked relay recovery).

### Follow-up (optional)

Chunked base-MP4 relay (mirror personal-background blob pattern) if single-message relay fails on long clips.

---

## User flow (happy path)

1. Enable **Subtitles** in Design Studio (global toggle — affects profile style snapshot only).
2. Record on Reddit → wait for recorder **stopped** (MP4 ready).
3. Open Design Studio → review cue list.
4. **Edit transcript** → **Apply to preview** → **Confirm & save** (Saved badge).
5. **Bake subtitles into MP4** → status completes.
6. Switch to Reddit tab → toast *Captioned MP4 ready* → **Attach to Reddit**.

---

## Race / prefs rules (unchanged)

From `docs/eloquent-profile-handoff.md` — still mandatory:

1. All `rvnUserPrefs` mutations through `enqueuePrefsOp`.
2. Studio boot: `load → reconcile → mount(initialPrefs)`; `prefsHydrated` gate.
3. No `flushPersist()` before profile saves (BUG-021).
4. Transcript text lives in **session IDB**, not profile blobs.

---

## Open — eloquent-4b+ (not started)

| Item | Notes |
|------|-------|
| Segment-aware canvas preview | `drawSubtitlePreview()` still flat `previewText()` |
| Font picker | Deferred per plan |
| Chunked base-MP4 relay | If bake fails “no base MP4” on slow relay |
| Recorder “Bake here” button | Studio is primary path today |
| Profile subtitle UX polish | Embed `transcriptConfig` on legacy profiles via Update once |

---

## Restore / test

```bash
git checkout eloquent
npm install
npm run dev
# chrome://extensions → reload → record on Reddit → Studio → bake → attach
```

**Regression gate:** `npm run build` · record → stopped UI · transcript edit/save · bake · attach with visible subs.

---

## Related docs

- `eloquent-branch.md` — phase plan
- `docs/eloquent-profile-handoff.md` — profile race rules (still apply)
- `docs/bug-archive.md` — BUG-025, BUG-026
- `claude-progress.md` — session timeline