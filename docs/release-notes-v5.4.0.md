# Release notes — v5.4.0 **Design Studio First: Standalone Recording Suite**

**Tag:** `v5.4.0` (**deferred** — cut after this doc refresh) · **Date:** 2026-07-06
**Branch:** merged `feature/v5.4.0-standalone-design-studio` → `main` (2026-07-06)
**Prior stable:** `v5.3.10` (WebCodecs Per-Chunk Encoding)
**Restore:** `git checkout main && npm install && npm run dev`
**Roadmap (as-built §4 Phase 0 authoritative):** [`docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`](5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md)

---

> **The headline:** the Design Studio is no longer a companion to the Reddit recorder — it *is* the recording studio. Record, re-record, preview, edit, caption, bake, and export all live in one place, and your work survives tab closes, crashes, and context switches. Reddit becomes the one-click place you *publish* to, not the place you're forced to record in.

---

## ✨ Highlights / What's New

| | |
|---|---|
| 🎙️ **Record right in the Studio** | Native capture with a **live WYSIWYG preview** — the canvas you see recording is the exact canvas that gets encoded. Restyle mid-take and watch it change live. |
| 🗂️ **Your take is always there** | A new **Take lifecycle** keeps one authoritative session across every context. Close the tab, come back — your last take is right where you left it, downloadable and editable. |
| 🚀 **Faster captions, on by default** | The **WebCodecs + canvas overlay** bake path is now the production default: rich, animated subtitles bake **sub-real-time** (~46–50 s for a 60 s clip vs ~228–310 s on the old path), with FFmpeg `drawtext` retained as a always-works fallback. |
| 🔗 **Reddit is now the output target** | A finished Studio take attaches to the Reddit voice-note composer in one click. Never-baked takes attach too. |
| 🛡️ **Crash-safe by construction** | Artifact-stamp verification (H6) means a recovered session can never hand you the *wrong* recording after a crash-then-re-record. |

---

## 🆕 New Features

### Design Studio as the primary capture surface
- **Studio-native recording** via a headless recorder host (`src/recorder/recorder-host.ts`) with a deck-embedded transport (Record / Stop / Discard, chronos timer, cap track, processing bar).
- **Live preview = output, literally.** During an audition the `WaveformRenderer` canvas itself — the exact element `captureStream()` feeds MediaRecorder — swaps into the hero monitor (label → **LIVE MIC**). Zero copies, zero preview-vs-output drift.
- **Restyle while recording.** Theme, background, and bar-style edits hot-swap the live capture canvas mid-take through the existing prefs listener.
- The full downstream — voice preview, transcription fork, subtitle scaffold, bake — lights up identically to a Reddit capture, because the session's relays are context-agnostic.

### Current Take deck
- An always-visible hero card answering "what state is my take in, and what can I do right now?": state headline + duration and status chips (**DRAFT / BAKED / SUBS PENDING**).
- **Download MP4** as the primary universal export (captioned baked MP4 preferred, base MP4 otherwise), resolved from extension-origin IDB at click time.
- Record / Re-record and Discard as secondary actions.

### Take lifecycle system (cross-context session state)
- `src/session/take-manager.ts` is the **single source of truth** for the current take across the Studio page, Reddit content script, background worker, and offscreen document.
- Snapshot lives in `browser.storage.local` (`rvn.take.current`), synced by `storage.onChanged` — **deliberately not a new message family** (see [ADR-0002](architecture/adr/0002-take-lifecycle-storage-sync.md)). Blobs stay in the existing single-slot IDB stores; the snapshot carries freshness **artifact stamps** that reference them.
- **Auto-draft** on recorder close / tab teardown; **crashed transient sessions demote to recoverable drafts on read**; **discarding a re-record restores the previous take** (blobs are only ever written at stop).

### Reddit as output target (attach mode)
- With a completed Studio take, the voice-note button opens the panel in **attach mode**: a Studio-take card, **Attach Studio take** (primary), **Record new here** (secondary), and an **Edit in Design Studio** link.
- The chunked MP4 relay now serves both stores (`baked` | `base`), so **never-baked takes attach too**.
- The Reddit panel live-syncs with Studio state — open the composer *while* the Studio is recording and it shows attach-waiting chrome, morphing to attach mode when the take lands (no close/reopen needed).

---

## 🔧 Improvements & Hardening

### WebCodecs + canvas overlay bake — now the default path
- The v5.3.10 dual-stream WebCodecs encoding backbone is **promoted to the production default** (`experimental.webCodecsBake` / `experimental.parallelBake` default **true** since `bd7d60a`, resolved through `resolveOverlayBakeEncoder` with a one-time rollout migration — opt-out only).
- Full fallback chain preserved: **`webcodecs → mediarecorder-parallel → serial → drawtext`**. Any capability gap, calibration failure, or encoder error silently and safely degrades; `drawtext` remains the always-works floor.
- Result on rich-effects clips: **sub-real-time bakes** (~0.77–0.83× clip duration) with visual quality indistinguishable from the legacy path.

### Artifact-stamp verification (H6) — crash + re-record safety
- The single-slot IDB stores can be overwritten by a newer capture. A snapshot that survived a crash could previously point a recovery/attach/download at *another* take's bytes.
- **`takeArtifactMatchesStore(stamp, storeMeta, toleranceMs)`** now verifies a stamp against the live store meta (`savedAt` within tolerance, `byteLength` equal when both present) at **all three blob-consumption choke points**:
  - **Recovery resume** (`studio-take-recovery.ts`) — before re-transcoding a recovered WebM.
  - **Reddit attach** (`recorder-panel.ts`) — before pulling chunks (via a new lightweight `fetchBakedMp4Meta` query, so verification happens *before* megabytes move).
  - **Studio Download CTA** (`current-take-status.ts`) — before exporting.
- On mismatch: the dead stamp is dropped and an honest note surfaces — **"Recording superseded — re-record."** — never a silent wrong-blob adoption.
- **Bonus fix caught in the same pass:** recovery resume read a non-existent `recording.durationSeconds` (always `undefined`), so resumed base MP4s were saved with duration `0`; now reads `recording.meta.durationSeconds`.

### Resilience & recovery
- **Mid-processing tab-close recovery:** closing the Studio during post-stop transcode no longer aborts the offscreen job or strands a phantom `processing` state. On reopen, the session reconciles against the background transcode queue (`MSG_QUERY_TRANSCODE_INFLIGHT`) and auto-resumes WebM→MP4 conversion when needed.
- **Orphan-transcode persistence:** the background can persist a Studio transcode result whose initiating tab died mid-job.
- **Concurrent recordings are solid** (stress-tested): overlapping captures both record correctly, processing serializes, and the first take stays downloadable while the second processes. Freshness precedence resolves the winner.

### Architectural cleanup
- No new execution context and no new message family were needed for any of the above — the take lifecycle rides existing storage-sync primitives, and Studio-native recording reuses the unmodified `VoiceRecorderSession`.
- Living architecture docs refreshed to match: architecture map **v2.1**, extension-points **v1.4** (new *Take lifecycle* and *Studio capture host* seams), hardening backlog **v2.1** (with a WebCodecs/canvas risk register), and [ADR-0002](architecture/adr/0002-take-lifecycle-storage-sync.md) / [ADR-0003 stub](architecture/adr/0003-composite-stage-elimination.md).

---

## ⚠️ Known Limitations

- **Cosmetic — concurrent-recording handoff window.** When one recording finishes processing just before a second overlapping one does, the take display briefly shows the *second* take's length while the *first* is still the downloadable artifact. It self-corrects once the second finishes; downloads resolve to the correct blob throughout. Display-only (hardening item **H11**, closed as accepted).
- **Composite stage is the remaining bake cost.** With encode and normalize solved, the FFmpeg `alphamerge` + x264 composite pass is now ~88% of WebCodecs bake wall (~43 s of ~50 s). Sub-real-time and user-accepted; further gains are a v5.5+ decision (**ADR-0003 stub**, decision-first).
- **Discard clears the snapshot only.** Single-slot blobs are overwritten by the next take rather than deleted immediately.
- **Studio mic permission is per extension origin.** The Design Studio is a different origin from reddit.com, so `getUserMedia` prompts once there (lock icon in the address bar if denied).
- **Demo site has no capture pipeline.** `demo/src/studio/` standalone-flow parity is future work.
- **Deferred v5.4.x follow-ups:** encoder-fallback observability (**H10**, deferred by decision), capture-time voice-effect provenance on recovery (**H8**), and verifying/documenting the Studio-initiated progress relay mechanism (**H12**).

---

## ⬆️ Upgrade / Migration Notes

- **No user action required.** Existing profiles, custom styles, personal backgrounds, and preferences are untouched.
- **WebCodecs bake auto-enables** via a one-time preference migration (`resolveOverlayBakeEncoder`): stored rollout defaults of `false` flip to `true` once, while an explicit user opt-out is preserved. To force the legacy path, set `experimental.webCodecsBake: false`.
- **Pre-v5.4.0 sessions adopt cleanly.** An in-flight recording or a completed bake from before this release is picked up by the new Take lifecycle on first read (via `recordArtifact` orphan adoption / `updateFromBake`), so nothing is stranded.
- **Storage:** one new `chrome.storage.local` key, `rvn.take.current` (a small JSON snapshot — never blobs). No IDB schema changes; the five single-slot stores are unchanged.
- **First bake after upgrade** runs the calibration probe once to measure the encoder's alpha luma range; if the device can't support the fast path, it transparently falls back with no visible change other than a slower bake.

---

## 🧪 Verification

**Automated (2026-07-06):**
- `node scripts/test-take-manager.mjs` — **20 checks** (snapshot validation, stale-transient demotion, merge semantics, **H6 stamp cross-check**).
- `node scripts/test-take-deck.mjs` — **12 checks** (state → CTA/badge matrix).
- Full suite PASS · `npm run build` PASS · `npx tsc --noEmit` improved 6 → 4 pre-existing warnings (two recovery `durationSeconds` type errors fixed in the H6 pass; remaining 4 are the known baseline).

**Manual QA — user sign-off 2026-07-06 (checklist items 1–11 PASS):**
- Studio-native recording, live preview, restyle-while-recording, download.
- Mid-processing tab-close recovery (#4), Reddit-capture-during-Studio-open (#5), discard-restore (#6), Reddit-panel live sync (#11).
- Attach mode (baked + never-baked), "Record new here", classic fallback.
- Regression sweep: voice preview, Smart Split, segment editor, Overlay Lab, bake toggles, personal backgrounds, profiles.
- H6 recovery scenario (crash mid-processing → new recording → reopen): correct take resolved, no wrong-blob adoption.
- Concurrent recordings: both capture correctly, processing serial, first take downloadable throughout.

---

## 📌 Post-merge / pre-tag checklist

- [x] Architecture + release doc refresh (this pass)
- [x] H6 artifact-stamp hardening shipped and tested
- [x] `git tag v5.4.0` on `main`
- [ ] `git push origin main --tags` when ready

---

## 🛠️ Engineering detail & QA appendix

### Take state (Phase 0)
`src/session/take-manager.ts` — snapshot in `browser.storage.local` (`rvn.take.current`, synced by `storage.onChanged`, no message family). Blobs stay in the single-slot IDB stores with freshness stamps in the snapshot. Auto-draft on recorder close / tab teardown; crashed transient sessions demote to recoverable drafts on read; discarded recordings restore the previous take (blobs written only at stop). Stamp verification (H6) via `takeArtifactMatchesStore` + `clearArtifact` at every consumption point.

### Mid-processing tab-close recovery (as-built 2026-07-06)
1. `studio-recorder.ts` `pagehide` persists a draft via `persistTakeOnClose()` without `host.close()` (avoids an explicit transcode cancel).
2. `main.ts` `unmount()` → `studioRecorder.dispose()` skips full teardown while phase is `processing`.
3. `background.ts` may persist orphan Studio transcode MP4s when the Studio listener is gone (`persistOrphanStudioTranscodeResult`).
4. On reopen, `reconcileStudioTakeAfterTabReturn()` demotes phantom `processing`, then `resumeDraftTranscodeIfNeeded()` re-encodes the preserved WebM if needed — after verifying its artifact stamp against the store (H6).
5. Reddit `findAttachableTake()` calls the same resume helper so attach mode can appear after draft recovery.

### Encoding backbone
Bake/export flows through `subtitle-bake.ts` / `subtitle-canvas-bake.ts` with the v5.3.10 WebCodecs dual-stream path, now default-on, and the full fallback chain. `updateFromBake` is a post-save observer that promotes the take to `baked`. See [`docs/5.3.10-webcodecs-per-chunk-encoding.md`](5.3.10-webcodecs-per-chunk-encoding.md) §0 and [ADR-0001](architecture/adr/0001-webcodecs-encoding-backbone.md).

### QA checklist detail (item numbers as tracked)
1–3. Studio-native record → stop → processing → ready; subtitles arrive → bake → BAKED → captioned download.
4. Close Studio mid-processing → reopen → draft/ready, no lost session.
5. Record on Reddit → open Studio during processing → live "Processing…" → flips to ready when the relay lands.
6. Discard a re-record (Studio and Reddit) → previous take reappears intact.
7–9. Attach mode (baked attaches captions; unbaked attaches base MP4); "Record new here" classic flow; no-take opens the classic recorder directly.
10. Regression sweep — unchanged behavior.
11. Reddit composer opened *while* Studio records → attach-waiting chrome → morphs to attach mode when the take lands (no reopen).

---

*Closing the loop on the v5.4.0 arc: Design Studio First shipped, the Take lifecycle is the new backbone, WebCodecs bake is the default, and the crash-safety hardening (H6) is verified. Thanks for the thorough concurrent-recording stress test that let us close H11 with confidence.*

Co-authored-by: bra-khet <bra.khet.git@gmail.com>
Co-authored-by: Claude (Fable 5, Opus 4.8) <noreply@anthropic.com>
