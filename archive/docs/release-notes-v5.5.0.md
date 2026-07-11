# Release notes — v5.5.0 **Browser-side Full Composite**

**Tag:** `v5.5.0` · **Date:** 2026-07-07
**Branch:** merged `feature/v5.5.0-browser-composite` → `main` (2026-07-07)
**Prior stable:** `v5.4.0` (Design Studio First)
**Restore:** `git checkout main && npm install && npm run dev`
**Decision + execution plan:** [ADR-0003](architecture/adr/0003-composite-stage-elimination.md) · [`v5.5.0-browser-composite-migration.md`](v5.5.0-browser-composite-migration.md)

---

> **The headline:** the FFmpeg alphamerge composite wall — ~43 s of every WebCodecs bake — can now be skipped entirely. Decode the base MP4 in-page, paint subtitles with the same canvas painter at each frame's exact output timestamp, encode, and mux back to MP4. Visual quality matches legacy; bakes are dramatically faster when the path is enabled. The feature ships **opt-in** behind an Overlay Lab toggle until a separate default-flip decision.

---

## ✨ Highlights / What's New

| | |
|---|---|
| ⚡ **Browser composite fast path** | Eliminates the FFmpeg `alphamerge` + x264 composite stage (~88% of WebCodecs bake wall on v5.4.0). A ~119 s / 40-cue clip bakes in single-digit seconds on the new path vs the legacy composite tier. |
| 🎨 **Same painter, same quality** | Uses `createOverlayFramePainter` at each decoded base-frame PTS (24 fps). User QA: **visually identical** to toggle-OFF legacy bakes on rich-effects clips (R9). |
| 🔀 **Full fallback chain preserved** | `browser-composite → WebCodecs-IVF + FFmpeg alphamerge → MediaRecorder-parallel → serial → drawtext`. Probe failure or any error falls through to legacy with a console warning — never a broken artifact. |
| 🧪 **Opt-in via Overlay Lab** | `experimental.browserComposite` defaults **false**. Enable **"Browser composite (v5.5.0)"** in Overlay Lab to try the fast path. Toggle OFF forces the legacy composite sweep (R12 regression harness). |
| 🛡️ **QA hardening included** | AAC priming PTS fix, cue-editor OOB/preview stamp wiring, and unfocused-tab cap-stop recording fixes ship in this release. |

---

## 🆕 New Features

### Browser-side full composite (`src/composite/*`)

- **`browser-composite.ts`** — orchestrator: demux base MP4 via `mediabunny@1.50.6`, decode with `VideoSampleSink`, blend overlay with a single source-over `drawImage`, encode via `CanvasSource`, passthrough AAC packets, mux to in-memory fast-start MP4.
- **`browser-composite-support.ts`** — capability probe on the *actual* base track: `canDecode()` + first-frame decode round trip + encodable output codec (`avc` → `vp9`). Null ⇒ legacy path (R11).
- **`composite-plan.ts`** — pure helpers: honest progress model (frame + packet counters, zero creep timers), output validation, R13 size guard, fidelity anchor timestamps. Node-tested (`test-browser-composite-plan.mjs`, 17 checks).
- **`composite-fidelity.ts`** — R9 frame extraction at planner anchor timestamps (Lab A/B surface = follow-up).

### Wiring & preferences

- `composite: 'browser' | 'ffmpeg'` option on `bakeWithCanvasOverlay` (explicit at both call sites).
- `experimental.browserComposite` + `resolveOverlayCompositeStrategy` in `user-preferences.ts` (default **false**).
- Overlay Lab toggle **"Browser composite (v5.5.0)"**; timing schema **v4** adds `browserCompositeMs` (never folded into `compositeMs`).
- Four new honest chronos stages: `browser-composite-decode`, `-paint`, `-encode`, `-mux`.

---

## 🔧 Improvements & Hardening

### AAC priming PTS (browser composite mux)

Base MP4 audio passthrough could carry slightly negative AAC priming PTS (~−11 ms). The mediabunny muxer rejected with `Timestamps must be non-negative`. Audio timestamps are now rebased in `browser-composite.ts` / `composite-plan.ts` before mux.

### Cue editor OOB badges + stale audio preview

The segment editor trusted stale `rvnLastRecording` meta without TakeManager/H6 verification — all cues except the first showed false out-of-bounds badges; per-cue preview played a stale ~2 s WebM. Now resolves clip duration and stamp-verified `baseMp4`/`baseRecording` via `segment-editor-clip-source.ts`.

### Background cap-stop recording (unfocused tab)

When the Studio tab was unfocused at the 2:00 cap, Chrome throttled `requestAnimationFrame` and `<video>` metadata probes → false WebM preflight timeout, truncated video track, deck stuck on "Processing…", frozen animation in the capture.

- `WaveformRenderer`: `setInterval` pump when `document.hidden` + `flushFrameForCapture()` before stop.
- `voice-recorder.ts`: seal + `requestFrame()` before MediaRecorder stop.
- `webm-preflight.ts`: structural fallback when metadata probe times out.
- `take-manager.ts`: `recordArtifact('baseMp4')` promotes `processing` → `ready`.
- `mount-clip-studio.ts`: `visibilitychange` reconcile.

User QA: unfocused cap-stop **PASS** — animation and movement captured correctly.

---

## ⚠️ Known Limitations

- **Opt-in only.** `experimental.browserComposite` defaults **false**. Production bakes still use the v5.4.0 WebCodecs + FFmpeg alphamerge path unless the Lab toggle is ON. Phase-2 default flip is a separate decision.
- **Chrome throttles unfocused bakes.** Browser composite (like all in-tab encode work) runs faster when the Studio tab is focused. Expected; not a regression.
- **30 MB baked MP4 cap (R13).** `saveLastBakedMp4` silently drops blobs > 30 MB. Composite video bitrate is pinned at 1.5 Mbps. User QA at 2:00 cap: browser composite ~22 MB, legacy ~15 MB — comfortable headroom, not enough for 3:00.
- **Production-grade, not bit-identical (R9).** Canvas blend replaces alphamerge machinery on the fast path. User QA reports visually identical output; formal Lab A/B surface is a follow-up.
- **Fidelity Lab A/B UI not built.** `composite-fidelity.ts` ships; side-by-side review surface is post-tag follow-up.
- **All v5.4.0 limitations unchanged** (composite cost on legacy path, H11 display window, demo site parity, etc.) when browser composite is OFF.

---

## ⬆️ Upgrade / Migration Notes

- **No user action required.** Existing profiles, takes, and preferences are untouched.
- **Browser composite is opt-in.** Set `experimental.browserComposite: true` in storage, or toggle ON in Overlay Lab. No one-time migration flips this flag.
- **New dependency:** `mediabunny@1.50.6` (pinned exact). Tree-shaken demux/decode/encode/mux surface adds ~707 KB to the Design Studio bundle — negligible vs the ~32 MB FFmpeg WASM the fast path avoids exercising.
- **Fallback chain unchanged for default users.** WebCodecs bake remains default-on from v5.4.0; only the composite *stage* has a new first tier when the flag is enabled.

---

## 🧪 Verification

**Automated (2026-07-07):**
- `node scripts/test-browser-composite-plan.mjs` — **17 checks**
- `node scripts/test-take-manager.mjs` — **24 checks**
- `node scripts/test-webm-preflight.mjs` — **4 checks**
- `node scripts/test-segment-editor-clip-source.mjs` — **4 checks**
- `npm run build` PASS · `tsc` 4 pre-existing warnings only

**Manual QA — user sign-off 2026-07-07 (Phase 0 gate PASS, two machines):**

| Scenario | Result |
|----------|--------|
| Lab bake, browser composite ON (~119 s / 40 cues) | **PASS** — fast bake, honest chronos |
| R9 visual parity vs toggle-OFF legacy | **PASS** — identical quality |
| R12 legacy sweep + honest fallbacks | **PASS** — long-clip timeouts → expected legacy tiers |
| Post-bake e2e: bake → Reddit attach → re-bake | **PASS** |
| R13 output size @ 2:00 cap | **PASS** — ~22 MB composite / ~15 MB legacy |
| R11 capability matrix (machine 1 + machine 2) | **PASS** — no throughput cliffs; all strategies work on second machine |
| Cue editor OOB + per-cue preview | **PASS** |
| Cap-stop recording, tab unfocused | **PASS** |

---

## 📌 Post-merge / pre-tag checklist

- [x] Phase 0 QA gate closed (two machines)
- [x] Release notes (this doc)
- [x] Version bump `5.4.0` → `5.5.0`
- [x] Merge `feature/v5.5.0-browser-composite` → `main`
- [x] `git tag v5.5.0` on `main`
- [ ] `git push origin main --tags` when ready

---

## 🛠️ Engineering detail

### Composite flow (when enabled)

```
bakeSubtitlesInStudio → bakeWithCanvasOverlay
  ├─ composite === 'browser' ?
  │    renderBrowserComposite (mediabunny demux/decode/blend/encode/mux)
  │    ── error → fall through ↓
  ├─ WebCodecs dual-IVF → FFmpeg alphamerge (unchanged)
  └─ MediaRecorder → drawtext (unchanged)
```

### Honest chronos (R8)

Progress ratios derive from real frame/packet counters — no creep timers on the browser composite path. Stage labels attribute cost to decode, paint (includes decode wait), encode, and mux separately.

### Phase 2 (not in this release)

Default flip `experimental.browserComposite: true` + rollout migration, retire alphamerge tiers for the constructed path, architecture doc catch-up. R11 second-machine matrix now **PASS** — default flip is an explicit product decision, not blocked on QA.

---

*Closing the composite-stage arc started in v5.3.10: encode is fast, normalize is gone, and now the alphamerge wall has a browser-native bypass. Legacy paths remain the safety net. Thanks for the thorough two-machine QA.*

Co-authored-by: bra-khet <bra.khet.git@gmail.com>