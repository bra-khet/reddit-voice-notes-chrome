# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on the current release boundary. The complete sprint-by-sprint record through the three v6.0 development tracks is preserved verbatim at [`archive/progress/claude-progress-through-v6.0.0-tracks.md`](archive/progress/claude-progress-through-v6.0.0-tracks.md). Earlier snapshots remain indexed by [`docs/HISTORY.md`](docs/HISTORY.md) and [`archive/README.md`](archive/README.md).

---

## Current stable — v5.11.0 preferences full-IDB migration

**SHIPPED · browser QA PASS 2026-07-13 · merged to `main` + tagged `v5.11.0` · push deferred.**

- Durable user-preference truth lives in extension-origin IndexedDB `rvnUserPrefs` (`global`, `profiles`, `customStyles`); `rvnUserPrefs.v2` is signal/revision only.
- Public `UserPreferencesV1` API and `USER_PREFS_VERSION = 1` remain stable. Content scripts use bounded background relays; one-time v1 migration is delete-after-success and retryable on failure.
- Studio profile management includes versioned JSON Export/Import and per-save size telemetry.
- Automated `test-user-prefs-storage.mjs` **12/12**; browser matrix PASS. Canonical design: [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md), [ADR-0006](docs/architecture/adr/0006-user-preferences-full-idb.md), [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md).

---

## v6.0 “Polish & Visual Maturity” — all development tracks merged

**Code/QA integration complete on `main` 2026-07-20 · package remains `5.11.0` until the explicit v6 release commit/tag · no push performed.**

| Track | Outcome | Canonical record |
|-------|---------|------------------|
| **A — audio-reactive visuals** | **Confidence QA PASS · merged.** Six spectra, seven atmospheres, seven ordered stackables, Style Control Center, shared bounded performance governor, caption-safe dim, Cividis tokens. Accepted residual: Conway can park in a dead-edge corner after a long run while other colonies remain active. | [`docs/v6.0.0-custom-styles-refactor.md`](docs/v6.0.0-custom-styles-refactor.md) · ADR-0007/0009/0010 |
| **B — background layout** | **Full operator checklist PASS · merged at `7d1c649`.** Direct hero/precision manipulation, responsive jog console, presets, dim/blur/blends/plate/Holo/GIF, eye-dropper, framing aids, live Theme-only compare, keyboard/ARIA, and one session-only next-take A/B layout. | [`docs/v6.0.0-background-panel-refactor.md`](docs/v6.0.0-background-panel-refactor.md) · [ADR-0008](docs/architecture/adr/0008-background-direct-manipulation-layout.md) · [`qa/QA-6.0.0/track-b/qa-checklist.md`](qa/QA-6.0.0/track-b/qa-checklist.md) |
| **C — popup UI refresh** | **Agent QA gate PASS · merged.** Popup-only Cividis overlay and elevated restart caution; optional real-extension appearance eyeball remains non-blocking. | [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md) |

### Track B final evidence

- Operator reports **all checklist items pass**, including enlarged Position Preview, next-take A/B, saved-profile load, identity hot-swap, Classic/default no-background, popup coherence, keyboard positioning/scaling/reset, High Contrast, reduced motion, and preview→record→bake parity.
- Final control refinement moved the Center reset into the precision stage with a dedicated inward-arrow frame glyph and removed the redundant legacy Fit/Fill + 3×3 position UI. Migration-compatible `scaleMode` / discrete `position` fields remain normalized and emitted.
- Focused Track B automation: **89/89**. Shared UI tokens: PASS. Visual-size logic: **5/5**. Production build: PASS.
- Required real blur+GIF artifact gate: **23 MiB base / 29 MiB baked — PASS** against 25/30 MiB caps. Upper-end non-blur creative sample 28/35 MiB remains informational, not the defined gate.
- `npm run compile` reports only the same two pre-existing subtitle diagnostics: `subtitle-canvas-bake.ts:158` (`number` vs `Timeout`) and `subtitle-overlay-lab.ts:130` (optional `enabled` vs required boolean).
- No new execution context, message family, store, signal, dependency, compositing layer, preference version, or post-capture background renderer. Backgrounds remain Design-phase configuration captured into the base video at record time (I1/I3/I22).

### Deferred observations (not v6 merge blockers)

- Subtitle browser-composite/burn-in reportedly runs roughly **5–6× faster while the Studio window is minimized**. Investigate focused-window RAF/render contention, browser scheduling, or GPU behavior before changing the compositor.
- Track C’s optional §8 real-extension visual eyeball remains available but is not a state/architecture gate.
- Optional future: preference Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

---

## v6.0 Track D — hosted Design Studio (IN FLIGHT · Phase 0 not started)

**Branch:** `feature/v6.0.0-hosted-design-studio` (cut from `main@a4df9a1`) · **Canonical:** [`docs/v6.0.0-hosted-design-studio.md`](docs/v6.0.0-hosted-design-studio.md) · **QA:** [`qa/QA-6.0.0/track-d/`](qa/QA-6.0.0/track-d/)

Track D is a **delivery** surface, not a feature surface: the full Design Studio served as a static GitHub Pages site so people can record → style → caption → bake → download without installing anything. Package stays `5.11.0`.

**The design document was redrafted on 2026-07-22** because the original draft's central architecture — a `StudioHost` interface threaded through the Studio tree — was wrong and would have required editing ~40 files, contradicting its own non-goals. Verified corrections that now drive the track:

- **The seam is a global, not an interface.** `browser` is a WXT auto-import — zero explicit imports across `src/`+`entrypoints/`, and **zero modules evaluate `browser.*` at module scope**. So one `globalThis.browser` shim installed as the web entry's first import is provably sufficient, with **zero** extension-source edits. Surface: 15 members.
- **Record and the flagship bake are already host-neutral.** `src/recorder/*`, `src/composite/*`, `src/encoding/*`, `studio-recorder.ts` contain no `browser.*`, and `browserComposite` has been default-on since v5.5.1. Only transcode / fallback burn-in / transcribe cross the offscreen boundary — reused by loading `entrypoints/offscreen/main.ts` **in-page** over a loopback bus, never by calling `ffmpeg-runner` directly (that would fork I5, cancel, and the progress contract).
- **Phase 0's first act is the `@` alias flip** (`demo/` → repo root), verified against a green Voice Lab *before* any new code. The 12 ported demo modules are byte-identical to `src/`, so the flip is safe — and it retires the documented "re-copy the DSP files" chore permanently.
- **The chronos gate is correctness, not polish.** `transcoder.ts` allows 45 s ACK / 90 s absolute *including WASM cold start*; over the network that ceiling is not safe unless FFmpeg is pre-warmed before the Studio mounts.
- **Measured first-load budget:** 31 MB FFmpeg core + 2.4 MB Studio assets required; 40 MB Vosk model optional. Replaces the draft's "~40–80 MB" guess.

**Load-bearing hazard to carry forward:** the shim's `storage.onChanged` must fire **for the writer's own writes** — real `chrome.storage` notifies every context including the writer, and both the take lifecycle (ADR-0002/I9) and the preference coordinator (I21) depend on it. With a single context, a "notify others" implementation notifies nobody.

**Open checks for Phase 0:** C1 in-page bake vs preview contention · C2 app bundle weight · C3 live Pages `Cache-Control` (if `max-age=600` holds, the warm path needs Cache Storage, not the HTTP cache).

### Decisions resolved + naming/copy sprint (2026-07-22)

- **D1 — naming.** The lightweight Pages page is now **Voice Lab**; "Design Studio" is unambiguous. Changed the hub destination card/CTA, `/studio/` `<title>`, nav-banner wordmark, `demo/README.md`, and module headers. **The `/studio/` URL and `demo/src/studio/` path are unchanged**, so no link or route work was needed.
- **Chronos gate failure policy.** Click-through is allowed — **Retry** plus **Open anyway** with a warning *adjacent to the button* naming the consequence ("baking may fail or time out"). Rejected: a hard block (traps users on a possibly transient failure) and a silent click-through (turns a diagnosable load failure into an inexplicable bake failure 90 s later).
- **User-facing "Reddit" copy policy — landed repo-wide.** The UI still described Reddit as *where recording happens*, which has been false since v5.4. Only that **requirement** class was removed. **Kept:** provenance (`take.source === 'reddit'` → "Live on the Reddit recorder…"), optional attach (ordered after Download), Reddit-specific constraints ("Reddit video comments allow up to about 3:00"), and the product name. The hub's phase rail moved from `Design → On Reddit → Back in Studio` to the Studio's own `Design → Capture → Polish` (*Design Studio → Record → Bake & Share*), closing a long-standing divergence. The popup's hint now leads with the Design Studio instead of "Open a Reddit comment box…".
- **Presentational only.** No identifier, storage key, message constant, CSS class, or architecture changed — `takeSource:'reddit'`, `attachToReddit`, `activateRedditTab`, `data-wf-switch-reddit`, `RecorderHostContext` all untouched. Verified: `npm run compile` reports only the two known pre-existing subtitle diagnostics; demo `tsc --noEmit` clean; hub + Voice Lab rendered console-clean on a live dev server.
- **Rule recorded** in [`docs/design-studio.md`](docs/design-studio.md) §8.5 (four classes: requirement → remove; provenance / optional destination / real constraint / product name → keep), with the rationale in the Track D roadmap §4.2.
- **Deferred:** the Field Guide refresh (**86** "Reddit" + **5** "Voice Studio" mentions), owner-scheduled before v6 ships. **Hazard:** the tutorial exists as two near-identical copies — `docs/tutorial/tutorial.html` and `demo/public/tutorial/index.html` — differing by exactly one favicon line. Settle that duplication before editing either.

---

## Architecture state

- Architecture map **v3.23**; extension points **v1.38** (Host adapter — v1 registered, unimplemented); hardening backlog **v2.13**; ADRs 0001–0010, with ADR-0008 Accepted and finalized for Track B; **0011 unallocated**.
- Six contexts remain unchanged: Reddit content script, background service worker, offscreen FFmpeg document, Vosk sandbox, Design Studio, popup. Track D adds a second **host** for the Design Studio context, not a seventh context.
- Background Layout v2 extends the existing personal-image draw slot: normalized preferences → Studio preview/direct manipulation → recorder hot-swap/relay → `drawUserBackgroundLayer` / `drawImageBackground`. Bake does not re-render it; subtitle-only post-base composition preserves captured background pixels.
- Canonical cross-cutting sources: [`docs/architecture/architecture-map.md`](docs/architecture/architecture-map.md), [`docs/architecture/extension-points.md`](docs/architecture/extension-points.md), [`docs/design-studio.md`](docs/design-studio.md).

---

## Immediate next

1. **Track D Phase 0** — flip the demo `@` alias to the repo root and confirm the Voice Lab still builds and auditions **before** writing any Design Studio code; then the `browser` shim skeleton, the `demo/design-studio/` scaffold, the `src/**` deploy path filter, and checks C1/C2/C3.
2. Decide and execute the explicit **v6.0.0 release boundary**: package/manifest version bump, release notes, final release build, and tag. Tracks A/B/C are complete; sequence the release relative to Track D deliberately.
3. User-owned push of `main` and tags remains deferred.
4. Treat the minimized-window bake-speed observation as a separate performance investigation, not a release blocker — Track D check C1 may shed light on it.

**Restore stable v5.11.0:** `git checkout v5.11.0 && npm install && npm run dev`
**Develop current main:** `git checkout main && npm install && npm run dev`
**Track D:** `git checkout feature/v6.0.0-hosted-design-studio && cd demo && npm install && npm run build && npm run preview` — QA the hosted surfaces against a **build**, never `vite dev`.

---

## Resume in a new chat

```text
Reddit Voice Notes: v6.0 Tracks A/B/C merged to main; package still 5.11.0 pending explicit v6 release/tag.
CURRENT BRANCH: feature/v6.0.0-hosted-design-studio (from main@a4df9a1) — Track D open, Phase 0 NOT started.
Track B merged at 7d1c649 with full operator checklist PASS: responsive direct background layout, presets/effects/GIF/plate/Holo, framing/live compare, keyboard/ARIA, session-only A/B; focused 89/89 + build PASS; blur+GIF 23/29 MiB PASS.
Architecture map v3.23, extension points v1.38, ADR-0008 Accepted/final, 0011 unallocated. No new context/message/store/signal/layer/dependency/USER_PREFS_VERSION.
Background is Design-phase and captured at record time (I1/I3/I22); no post-capture reposition or multi-format export.

TRACK D (docs/v6.0.0-hosted-design-studio.md — redrafted 2026-07-22; the earlier draft's StudioHost interface was WRONG):
  SEAM = ONE `browser` GLOBAL shim, not an interface. `browser` is a WXT auto-import (zero explicit imports)
  and NO src/ module evaluates browser.* at module scope, so a first-import side-effect shim suffices — 15 API
  members, ZERO extension-source edits (except an additive optional MountClipStudioOptions.hostCapabilities).
  Record + default browser-composite bake are ALREADY browser.*-free. Reuse entrypoints/offscreen/main.ts
  IN-PAGE over a loopback bus + a ~120-line START→ACK→_OFFSCREEN router. Never call ffmpeg-runner directly.
  PHASE 0 FIRST ACT: flip demo `@` alias demo/ → repo root (12 ported modules verified byte-identical),
  verify Voice Lab builds+auditions BEFORE new code. Retires the re-copy chore.
  HAZARD: shim storage.onChanged MUST fire for the writer's own writes (ADR-0002/I9 + I21).
  Chronos gate = correctness: transcoder ACK 45s / MAX 90s includes WASM cold start → pre-warm FFmpeg.
  Budget: 31 MB ffmpeg + 2.4 MB assets required, 40 MB Vosk optional.
  RESOLVED 2026-07-22: D1 = lightweight page is "Voice Lab" (/studio/ URL + demo/src/studio/ path UNCHANGED).
  Chronos failure = Retry + "Open anyway" click-through WITH an adjacent warning ("baking may fail or time
  out"); never a hard block, never silent.
  LANDED 2026-07-22: user-facing "Reddit" copy policy (roadmap §4.2, rule in docs/design-studio.md §8.5).
  Removed ONLY the requirement class ("record on Reddit first" — false since v5.4). KEPT provenance
  (take.source==='reddit'), optional attach after Download, real Reddit constraints, product name.
  Hub + Studio now share Design → Capture → Polish. ZERO identifier renames (takeSource:'reddit',
  attachToReddit, activateRedditTab, data-wf-switch-reddit untouched). Do NOT reintroduce the old phrasing.
  DEFERRED: Field Guide refresh (86 Reddit + 5 "Voice Studio"); it exists as TWO near-identical copies
  (docs/tutorial/tutorial.html vs demo/public/tutorial/index.html, one favicon line apart) — settle first.
  OPEN: checks C1/C2/C3 in Phase 0.
  QA hosted surfaces against a BUILD, never `vite dev`. Voice Lab + Field Guide green at EVERY phase exit.

Full pre-closeout history: archive/progress/claude-progress-through-v6.0.0-tracks.md.
NEXT: Track D Phase 0; then the explicit v6.0.0 version/release-notes/tag decision. Push is user-owned.
Run architecture-hardening resume if deeper context is needed.
```
