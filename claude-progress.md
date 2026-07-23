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
- `npm run compile` reports only the same two pre-existing subtitle diagnostics: `subtitle-canvas-bake.ts:158` (`number` vs `Timeout`) and `subtitle-overlay-lab.ts:130` (optional `enabled` vs required boolean). *(Historical: both were fixed in Track D Phase 0 — `npm run compile` is now zero-error and must stay so.)*
- No new execution context, message family, store, signal, dependency, compositing layer, preference version, or post-capture background renderer. Backgrounds remain Design-phase configuration captured into the base video at record time (I1/I3/I22).

### Deferred observations (not v6 merge blockers)

- Subtitle browser-composite/burn-in reportedly runs roughly **5–6× faster while the Studio window is minimized**. Investigate focused-window RAF/render contention, browser scheduling, or GPU behavior before changing the compositor.
- Track C’s optional §8 real-extension visual eyeball remains available but is not a state/architecture gate.
- Optional future: preference Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

---

## v6.0 Track D — hosted Design Studio (IN FLIGHT · **Phase 0 LANDED 2026-07-22**)

**Branch:** `feature/v6.0.0-hosted-design-studio` (cut from `main@a4df9a1`) · **Canonical:** [`docs/v6.0.0-hosted-design-studio.md`](docs/v6.0.0-hosted-design-studio.md) · **QA:** [`qa/QA-6.0.0/track-d/`](qa/QA-6.0.0/track-d/)

Track D is a **delivery** surface, not a feature surface: the full Design Studio served as a static GitHub Pages site so people can record → style → caption → bake → download without installing anything. Package stays `5.11.0`.

**The design document was redrafted on 2026-07-22** because the original draft's central architecture — a `StudioHost` interface threaded through the Studio tree — was wrong and would have required editing ~40 files, contradicting its own non-goals. Verified corrections that now drive the track:

- **The seam is a global, not an interface.** `browser` is a WXT auto-import — zero explicit imports across `src/`+`entrypoints/`, and **zero modules evaluate `browser.*` at module scope**. So one `globalThis.browser` shim installed as the web entry's first import is provably sufficient, with **zero** extension-source edits. Surface: 15 members.
- **Record and the flagship bake are already host-neutral.** `src/recorder/*`, `src/composite/*`, `src/encoding/*`, `studio-recorder.ts` contain no `browser.*`, and `browserComposite` has been default-on since v5.5.1. Only transcode / fallback burn-in / transcribe cross the offscreen boundary — reused by loading `entrypoints/offscreen/main.ts` **in-page** over a loopback bus, never by calling `ffmpeg-runner` directly (that would fork I5, cancel, and the progress contract).
- **Phase 0's first act is the `@` alias flip** (`demo/` → repo root), verified against a green Voice Lab *before* any new code. The 12 ported demo modules are byte-identical to `src/`, so the flip is safe — and it retires the documented "re-copy the DSP files" chore permanently.
- **The chronos gate is correctness, not polish.** `transcoder.ts` allows 45 s ACK / 90 s absolute *including WASM cold start*; over the network that ceiling is not safe unless FFmpeg is pre-warmed before the Studio mounts.
- **Measured first-load budget:** 31 MB FFmpeg core + 2.4 MB Studio assets required; 40 MB Vosk model optional. Replaces the draft's "~40–80 MB" guess.

**Load-bearing hazard to carry forward:** the shim's `storage.onChanged` must fire **for the writer's own writes** — real `chrome.storage` notifies every context including the writer, and both the take lifecycle (ADR-0002/I9) and the preference coordinator (I21) depend on it. With a single context, a "notify others" implementation notifies nobody.

### Phase 0 — as built (2026-07-22 · `dac1bf0`, `f96f5f8`, `+ assets`)

**The hosted Design Studio mounts and runs the real Studio source on a plain web origin.** Gate met on a clean load from a build: **42 requests, 0 failures, 0 console output**. Shim fidelity **11/11**. The Voice Lab, Field Guide and hub stayed green throughout (§0 standing regression).

Three sprints, sequenced so no failure could be attributed to two changes at once:

1. **Alias flip alone, no new code.** `@` → repo root; 12 byte-identical DSP copies deleted; Voice Lab verified green (build + real FFmpeg audition) before anything else was written. `demo/scripts/smoke.ts` broke because it reached the copies by *relative* path, bypassing `@` — the first proof that a "verbatim copy" model hides its own consumers.
2. **Shim + scaffold.** `demo/design-studio/host/{install-browser-shim,web-storage,web-runtime}.ts` + entry. `storage.onChanged` fires for the **writer's own writes**, verified.
3. **Assets.** `copy-studio-assets.mjs` mirrors `design-studio-v4` + `fonts` + `backgrounds` whole-tree, generated and git-ignored like the ffmpeg core.

**The central prediction held:** zero extension-source edits were needed *for the host boundary itself*. What did not hold were three shared-source assumptions, all the same class — **code that classifies its own host**:

- **`location.protocol` as a host test (R3, materialized).** `user-prefs-db.ts` read https as "content script" and routed prefs to a background that does not exist; `background-loader.ts` held the mirror-image test and the mirror-image bug (personal backgrounds would have silently failed). Both now call **`src/utils/host-origin.ts` → `isOwnStorageOrigin()`** — *does the extension's own base URL share my origin?* — identical for all three extension contexts, correct for the hosted one.
- **`'/assets/…'` literals.** A leading slash is the extension root in an extension and the *site* root on Pages. Three in `background-layout-controls.ts` (Track B) bypassed `getURL`; `demo/vite.config.ts` now fails the build on any survivor, in CSS or JS.
- **A shared type-check.** WXT's generated tsconfig includes `../**/*`, so the shim's ambient `browser` collided with WXT's across the whole extension. Root `tsconfig.json` now excludes `demo/`.

**One process change worth carrying:** the demo's build is `tsc --noEmit && vite build`, so it *gates* on type errors the extension merely tolerated. The two long-known subtitle diagnostics became Pages-deploy blockers and were fixed — **`npm run compile` is now clean for the first time, and must stay that way.**

**Checks:** ✅ **C2** — 1.27 MB JS + 148 KB CSS (345 + 24 KB gzipped), excluding the vendored core. ✅ **C3** — Pages does send `Cache-Control: max-age=600`, but a conditional re-request returns **304 / 0 bytes / 0.58 s**, so the core is *revalidated*, not re-downloaded. The real warm-path risk is HTTP-cache **eviction** of a 31 MB entry, which is what Cache Storage should address in Phase 3. ⬜ **C1** moved to Phase 1 — it needs a real bake, which needs the loopback pipeline.

### Decisions resolved + naming/copy sprint (2026-07-22)

- **D1 — naming.** The lightweight Pages page is now **Voice Lab**; "Design Studio" is unambiguous. Changed the hub destination card/CTA, `/studio/` `<title>`, nav-banner wordmark, `demo/README.md`, and module headers. **The `/studio/` URL and `demo/src/studio/` path are unchanged**, so no link or route work was needed.
- **Chronos gate failure policy.** Click-through is allowed — **Retry** plus **Open anyway** with a warning *adjacent to the button* naming the consequence ("baking may fail or time out"). Rejected: a hard block (traps users on a possibly transient failure) and a silent click-through (turns a diagnosable load failure into an inexplicable bake failure 90 s later).
- **User-facing "Reddit" copy policy — landed repo-wide.** The UI still described Reddit as *where recording happens*, which has been false since v5.4. Only that **requirement** class was removed. **Kept:** provenance (`take.source === 'reddit'` → "Live on the Reddit recorder…"), optional attach (ordered after Download), Reddit-specific constraints ("Reddit video comments allow up to about 3:00"), and the product name. The hub's phase rail moved from `Design → On Reddit → Back in Studio` to the Studio's own `Design → Capture → Polish` (*Design Studio → Record → Bake & Share*), closing a long-standing divergence. The popup's hint now leads with the Design Studio instead of "Open a Reddit comment box…".
- **Presentational only.** No identifier, storage key, message constant, CSS class, or architecture changed — `takeSource:'reddit'`, `attachToReddit`, `activateRedditTab`, `data-wf-switch-reddit`, `RecorderHostContext` all untouched. Verified: `npm run compile` reports only the two known pre-existing subtitle diagnostics; demo `tsc --noEmit` clean; hub + Voice Lab rendered console-clean on a live dev server.
- **Rule recorded** in [`docs/design-studio.md`](docs/design-studio.md) §8.5 (four classes: requirement → remove; provenance / optional destination / real constraint / product name → keep), with the rationale in the Track D roadmap §4.2.
- **Deferred:** the Field Guide refresh (**86** "Reddit" + **5** "Voice Studio" mentions), owner-scheduled before v6 ships. **Hazard:** the tutorial exists as two near-identical copies — `docs/tutorial/tutorial.html` and `demo/public/tutorial/index.html` — differing by exactly one favicon line. Settle that duplication before editing either.

---

## Architecture state

- Architecture map **v3.24**; extension points **v1.39** (Host adapter — v1 **implemented**, Phase 0); hardening backlog **v2.13**; ADRs 0001–0010, with ADR-0008 Accepted and finalized for Track B; **0011 unallocated**.
- Six contexts remain unchanged: Reddit content script, background service worker, offscreen FFmpeg document, Vosk sandbox, Design Studio, popup. Track D adds a second **host** for the Design Studio context, not a seventh context — now demonstrated, not just planned.
- Background Layout v2 extends the existing personal-image draw slot: normalized preferences → Studio preview/direct manipulation → recorder hot-swap/relay → `drawUserBackgroundLayer` / `drawImageBackground`. Bake does not re-render it; subtitle-only post-base composition preserves captured background pixels.
- Canonical cross-cutting sources: [`docs/architecture/architecture-map.md`](docs/architecture/architecture-map.md), [`docs/architecture/extension-points.md`](docs/architecture/extension-points.md), [`docs/design-studio.md`](docs/design-studio.md).

---

## Immediate next

1. **Track D Phase 3 — hub rework + chronos gate.** Phases 0 + 1 complete; **Phase 2 gate substantially met (operator 2026-07-22)**: a rich bake with a scaffolded subtitle cue succeeded via the **browser-composite tier** (not a drawtext degrade), MP4 plays, dims/duration match. Parity is **structural** — `src/composite/*` carries zero `browser.*`, so tier-1 output is a pure function of host-invariant inputs. Phase 3: add the Design-Studio hub card (primary), the amber chronos gate with warm-cache fast path, and the hosted narrative tail (`hostCapabilities.redditAttach: false`, §3.6). Gate: cold- and warm-cache runs both observed; failure + warned click-through with the network throttled.
   - **Phase 2 residual (not blockers):** the frame-wise extension-vs-hosted eyeball (operator-owed, but a *confirmation* of the structural argument), the record-time hot-swap sweep under RAF throttle (operator-owed), and the never-entered FFmpeg fallback tier (optional — the default browser-composite path is what ships). Bake-size cap (3.8) is a quick operator measurement.
   - **Captions are H-2 / Phase 4 and fail as-designed on the hosted surface** (Vosk model + sandbox unvendored; `vite preview` returns SPA HTML → *"Vosk sandbox failed to become ready"*). **Do NOT open a Vosk fix sprint unless Phase 4 captions are explicitly opened.** Manual subtitle scaffolding + rich bake works without STT.
   - Still worth doing while it is fresh: a focused Node suite for the relay slice. Its two invariants — **never re-broadcast `PROGRESS`/`COMPLETE`**, **ignore `target:'offscreen'`** — fail *silently*, so nothing else in the tree would catch a regression.
   - **Run `npm run test:host-neutrality` at every phase exit** — it is now the first step of the demo build and gates the Pages deploy, but the standalone run is the fast agent check. H-5 operator-confirmed.
2. Decide and execute the explicit **v6.0.0 release boundary**: package/manifest version bump, release notes, final release build, and tag. Tracks A/B/C are complete; sequence the release relative to Track D deliberately.
3. User-owned push of `main` and tags remains deferred.
4. ~~Minimized-window bake-speed mystery~~ **explained (C1 closed 2026-07-22):** a hidden tab throttles RAF to ~1.3 fps, so the preview stops competing with the worker-based bake for the main thread.

**Restore stable v5.11.0:** `git checkout v5.11.0 && npm install && npm run dev`
**Develop current main:** `git checkout main && npm install && npm run dev`
**Track D:** `git checkout feature/v6.0.0-hosted-design-studio && cd demo && npm install && npm run build && npm run preview` — QA the hosted surfaces against a **build**, never `vite dev`.

---

## Resume in a new chat

```text
Reddit Voice Notes: v6.0 Tracks A/B/C merged to main; package still 5.11.0 pending explicit v6 release/tag.
CURRENT BRANCH: feature/v6.0.0-hosted-design-studio (from main@a4df9a1) — Track D open, Phases 0 + 1 COMPLETE, Phase 2 gate substantially MET (operator 2026-07-22), Phase 3 next.
Track B merged at 7d1c649 with full operator checklist PASS: responsive direct background layout, presets/effects/GIF/plate/Holo, framing/live compare, keyboard/ARIA, session-only A/B; focused 89/89 + build PASS; blur+GIF 23/29 MiB PASS.
Architecture map v3.26, extension points v1.42, ADR-0008 Accepted/final, 0011 unallocated. No new context/message/store/signal/layer/dependency/USER_PREFS_VERSION.
Background is Design-phase and captured at record time (I1/I3/I22); no post-capture reposition or multi-format export.

TRACK D (docs/v6.0.0-hosted-design-studio.md — redrafted 2026-07-22; the earlier draft's StudioHost interface was WRONG):
  SEAM = ONE `browser` GLOBAL shim, not an interface. `browser` is a WXT auto-import (zero explicit imports)
  and NO src/ module evaluates browser.* at module scope, so a first-import side-effect shim suffices — 15 API
  members, ZERO extension-source edits (except an additive optional MountClipStudioOptions.hostCapabilities).
  Record + default browser-composite bake are ALREADY browser.*-free. Reuse entrypoints/offscreen/main.ts
  IN-PAGE over a loopback bus + a ~120-line START→ACK→_OFFSCREEN router. Never call ffmpeg-runner directly.
  PHASE 0 DONE (dac1bf0, f96f5f8, +assets): demo `@` → repo root, 12 duplicate modules DELETED,
  demo/design-studio/host/ shim built, Studio assets vendored whole-tree, deploy watches src/**.
  It MOUNTS: 42 requests / 0 failures / 0 console output; shim fidelity 11/11.
  PHASE 1 DONE (c3aad75 pipeline, 7400a57 lifecycle): offscreen/main.ts imported IN-PAGE (lazy,
  memoized on the PROMISE) + web-pipeline-host.ts playing background.ts's relay slice; message
  contract UNMODIFIED so I5/cancel/queue/progress are reused, not forked; validators shared via
  src/messaging/relay-validate.ts. GATE MET: record → base MP4 → download, TWICE, plus reload recovery.
  HAZARD (verified satisfied): shim storage.onChanged fires for the writer's own writes (ADR-0002/I9 + I21).
  HOST-NEUTRALITY RULES now binding — each cost a real bug:
    1. isOwnStorageOrigin() in src/utils/host-origin.ts, NEVER location.protocol.
    2. browser.runtime.getURL() for packaged assets, NEVER a '/assets/...' literal (build-enforced).
    3. browser.* stays inside function bodies in shared src/.
    4. Root tsconfig.json EXCLUDES demo/ (ambient `browser` collision with WXT's).
    5. `npm run compile` is ZERO-ERROR and must stay so — demo's build gates on tsc.
    6. A relay must NOT forward what the loopback bus already delivers: no PROGRESS/COMPLETE
       re-broadcast, ignore target:'offscreen'. Both failures are SILENT (dup COMPLETE = phantom take).
    7. A shim that faithfully RESOLVES can be worse than one that throws. Both artifact relays assumed
       a background SW existed; sendMessage RESOLVED, the catch never fired, every recording was dropped
       SILENTLY. Fall back to a direct commit only when unanswered AND isOwnStorageOrigin(); the
       persist→signal→stamp choke point lives ONCE in src/storage/artifact-commit.ts (H13).
    8. Vendor packaged MULTI-FILE assets whole (ffmpeg/esm/ is a module worker + siblings).
  RULES 1/2/3/8 ARE MACHINE-CHECKED AND GATE THE BUILD: `npm run test:host-neutrality` resolves the
  hosted Studio's REAL module graph (esbuild metafile from demo/design-studio/main.ts, ~210 shared .ts)
  and lints only those — graph-scoped, so it widens with Phase 2 and never fires on extension-only code.
  Negative-tested. It CANNOT catch rule 7 (behavioural). It is the FIRST STEP of demo's `build`
  (test:host-neutrality && tsc --noEmit && vite build), so a regression fails `cd demo && npm run build`
  before tsc/vite and BLOCKS THE PAGES DEPLOY (whose Build step is `npm run build`). CI-safe, no root
  install: cwd-independent (root from import.meta) + esbuild resolved from demo/node_modules. Roadmap
  §7.2 = 5-row hazard register, each with an owning phase: H-1 design-studio.html hard-code (Phase 3) ·
  H-2 unvendored Vosk (Phase 4) · H-3 "reload the extension" copy (Phase 4) · H-4 popup module-scope
  getURL (legitimate, do NOT "fix") · H-5 port relay unreachable — OPERATOR-CONFIRMED 2026-07-22 (QA 3.9
  kept as a standing watch through Phase 2).
  QA TRAP: `vite preview` answers MISSING files with 200 text/html, so absent assets look fine.
  Judge by content-type or performance.getEntriesByType('resource'), never status code.
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
  PHASE 2 GATE SUBSTANTIALLY MET (operator 2026-07-22): rich bake with a scaffolded subtitle cue
  succeeded via the BROWSER-COMPOSITE tier (renderBrowserComposite, NOT a drawtext degrade), MP4 plays,
  dims/duration match. Parity is STRUCTURAL: src/composite/* has ZERO browser.*, so tier-1 output is a
  pure function of host-invariant inputs (base MP4 bytes + style + segments + WebCodecs). Residual is
  operator-owed (frame-wise eyeball = a confirmation, not a discovery; record-time hot-swap under RAF
  throttle) or optional (FFmpeg fallback tier never entered — browser-composite is the shipped default).
  CAPTIONS = H-2/Phase 4, FAIL AS-DESIGNED (Vosk unvendored; vite preview returns SPA HTML → "Vosk
  sandbox failed to become ready") — do NOT fix outside an explicit Phase 4 captions sprint.
  CHECKS ALL CLOSED: C2 (1.27 MB JS + 148 KB CSS). C3 (max-age=600 BUT revalidation 304/0 bytes —
  warm-path risk is HTTP-cache EVICTION of a 31 MB entry, not expiry; Cache Storage still wanted).
  C1 RESOLVED: a full transcode produced ZERO main-thread long tasks (worker-based bake → no contention
  mechanism); operator confirmed a hidden tab throttles RAF to ~4/3s and that this is NOT a bake blocker
  (this also explains the old "5-6x faster while minimized" note).
  HARNESS LIMITS (all operator-owed): the pane BLOCKS getUserMedia, AUTO-DISMISSES window.confirm
  (Discard is confirm-gated), PAUSES RAF while hidden, and screenshots fail. QA RECIPE that works:
  override ONLY navigator.mediaDevices.getUserMedia with an oscillator stream — everything below the mic
  then runs for real; also stub HTMLAnchorElement.prototype.click and window.confirm.
  QA hosted surfaces against a BUILD, never `vite dev`. Voice Lab + Field Guide green at EVERY phase exit.

Full pre-closeout history: archive/progress/claude-progress-through-v6.0.0-tracks.md.
NEXT: Track D Phase 3 (hub card + amber chronos gate + hostCapabilities.redditAttach:false). Phase 2
gate substantially met; residual is operator-owed/optional. Captions = Phase 4 (H-2, fails as-designed).
Also wanted: a focused Node suite for the relay slice — rule 6's invariants fail SILENTLY.
Then the explicit v6.0.0 version/release-notes/tag decision. Push is user-owned.
Run architecture-hardening resume if deeper context is needed.
```
