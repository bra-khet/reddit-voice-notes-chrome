# Track D — Hosted Design Studio · operator checklist

**Status:** Phases 0–3 closed (Phase 3 operator PASS 2026-07-22) · Phase 4 open
**Roadmap:** [`docs/v6.0.0-hosted-design-studio.md`](../../../docs/v6.0.0-hosted-design-studio.md) · **Track README:** [`README.md`](README.md)
**Operator:** owner · **Machine / browser:** production Chrome + `vite preview` build · **Build under test:** `feature/v6.0.0-hosted-design-studio` demo build

**Legend:** ■ PASS · ▲ PARTIAL (explain) · ✕ FAIL (blocker) · ☐ not yet run · — N/A this phase

> QA the hosted surface against a **build or a deploy**, never `vite dev`. The Voice Lab's audition freeze at "5%" under `vite dev` is a known dev-server artifact (HMR/re-optimization aborts the 31 MB `ffmpeg.load()`); the same failure mode applies to the Design Studio and will waste an operator session if forgotten.
>
> ```bash
> cd demo && npm run build && npm run preview
> ```
>
> **Second trap, found in Phase 0:** `vite preview` serves an **HTML fallback**, so a *missing* asset answers `200 text/html` instead of 404. Absent SVGs therefore look like successes in the network panel and merely render as broken images — while being hard 404s on real Pages. Judge assets by `content-type`, or assert over `performance.getEntriesByType('resource')`, never by status code alone.
>
> **Clearing state for a clean-profile run** means clearing **both** the shim's `rvnWebHostStorage` *and* the Studio's real `rvn*` databases on the Pages origin.

---

## §0 Standing regression — run at EVERY phase exit

The Voice Lab and Field Guide share the Pages origin and (after the Phase 0 alias flip) the same source tree. A Track D change must never be the reason either goes dark.

| # | Item | Result |
|---|---|---|
| 0.1 | `cd demo && npm run build` completes clean (`tsc --noEmit` + `vite build`) | ■ (2026-07-22, post-flip — 42 modules, built in 387 ms) |
| 0.2 | Field Guide loads at `/tutorial/`; no console errors | ■ (2026-07-22, `vite preview` :6174) |
| 0.3 | Voice Lab loads at `/studio/`; chips render; composer responds | ■ (2026-07-22 — 8 presets, composer categories, transfer cluster all render; console clean) |
| 0.4 | Voice Lab audition renders through the active graph (against a **build**) | ■ (2026-07-22 — Cyber Oracle @ Hamlet sample; `ffmpeg-core.js` + `.wasm` both 200; panel reached "Playing the rendered voice — this is what bakes") |
| 0.5 | `rvn-voice-character-v1` copy/paste round-trips with the extension | ▲ operator-owed. Clipboard read is blocked in the automation context. **Structurally stronger after the flip:** the Voice Lab now imports the extension's own `src/settings/clipboard-backup.ts`, so the envelope cannot diverge — only the two-app paste needs an eyeball |
| 0.6 | `npm run test:host-neutrality` passes — host-classification rules 1/2/3/8 against the hosted Studio's real module graph (roadmap §7.2) | ■ (2026-07-22 — 10/10; 210 shared `.ts` files. **Now the first step of `demo`'s `build`, so it also gates the Pages deploy** — a regression fails `cd demo && npm run build` before tsc/vite (proven both directions). Still agent-runnable standalone; does **not** cover rule 7. **Updated 2026-07-23 — 15/15; 211 files**: four new rule-8 checks assert the Vosk sandbox + model are vendored into `demo/public/` and the base64 worker patch is shared, not copied) |
| 0.9 | Vosk captions vendored + working on a build (H-2 / 5.6 agent half) | ■ (2026-07-23 — `voice-studio-prod` :6174. Sandbox `vosk-sandbox.html`+`.js` serve real bytes; iframe reaches **READY in 381 ms**; a real 16 s Hamlet sample decoded to 16 kHz and transcribed through the vendored 41 MB model — `ok:true`, 4 segments, accurate text, ~8 s incl. model load, **0 console errors**. This is the H-2 fix proven end-to-end without a mic) |
| 0.10 | Studio-side Cache-Storage wasm read (§3.5) serves the warm copy in the real runner | ■ (2026-07-23 — `voice-studio-prod` :6174. Seeded `rvn-ffmpeg-warm-v1` with the wasm; the gate's relative key and the runner's absolute `getURL` key **matched the same entry** (blob `application/wasm`, 31 MB). A named-cache miss returned undefined and **created no cache** (extension parity). Drove a real transcode through the loopback pipeline: the shipped `loadFfmpeg` logged **"FFmpeg core WASM served from warm Cache Storage"** + "FFmpeg WASM loaded", transcode succeeded, **0 `ffmpeg-core.wasm` HTTP requests** during the load) |
| 0.7 | `npm run test:relay-pipeline-host` passes — the relay slice's rule-6 invariants (silent failures) | ■ (2026-07-22 **15/15** · **updated 2026-07-23 — 18/18**). REAL relay host on REAL loopback bus; offscreen + session-transcript IDB faked. Covers START→ACK→`*_OFFSCREEN`, validation→ACK-false-no-dispatch, PROGRESS/COMPLETE **never re-broadcast**, offscreen-target **ignored**, burn-in→**transcode**-cancel, post-ACK failure as terminal COMPLETE, **and** terminal transcribe COMPLETE → IDB + ready key once (success + scaffold; stale COMPLETE no-op). **Negative-tested** re-broadcast / recursion / burnin-cancel |
| 0.8 | `npm run test:workflow-banner-host` passes — §3.6 Reddit-affordance suppression, both hosts | ■ (2026-07-22 — **6/6**; renders the real banner via linkedom. Default (no capability) keeps the `data-wf-switch-reddit` CTA + Reddit copy byte-identically; `redditAttach:false` suppresses the CTA in every state and swaps the copy to the install-the-extension narrative. Toggle-back test proves the flag is not one-way) |

---

## §0b Copy policy regression (roadmap §4.2 · `docs/design-studio.md` §8.5)

Landed 2026-07-22. Re-check whenever Studio, popup, or hub copy changes — the old phrasing is easy to reintroduce by muscle memory.

| # | Item | Result |
|---|---|---|
| 0b.1 | No surface says Reddit is needed to record, caption, bake, or download | ■ (2026-07-22) |
| 0b.2 | Provenance copy survives — a Reddit-sourced take still reads "Live on the Reddit recorder…" | ■ (2026-07-22) |
| 0b.3 | Attach copy survives and stays ordered **after** Download | ■ (2026-07-22) |
| 0b.4 | Hub + Studio agree on Design → Capture → Polish | ■ (2026-07-22) |
| 0b.5 | Zero identifier renames (`takeSource:'reddit'`, `attachToReddit`, `activateRedditTab`, `data-wf-switch-reddit`) | ■ (2026-07-22) |
| 0b.6 | `npm run compile` shows only the two known pre-existing subtitle diagnostics | ■ (2026-07-22) |
| 0b.7 | Real-extension eyeball of the changed Studio/popup strings | ☐ deferred to the next extension QA pass |

---

## §1 Phase 0 — alias flip, shim, scaffold

| # | Item | Result |
|---|---|---|
| 1.1 | **Alias flip verified in isolation** — §0 green after `@` → repo root, **before** any Design Studio code exists | ■ (2026-07-22 — sprint 1 added zero new code; §0.1–0.4 all green) |
| 1.2 | Ported duplicate modules under `demo/src/voice`, `demo/src/settings` removed; nothing still imports them | ■ (2026-07-22 — 12 files deleted after `diff -q` re-verified byte-identity; `demo/scripts/smoke.ts` repointed from `../src/…` to `../../src/…`; `npm run smoke` ALL PASS) |
| 1.3 | `demo/design-studio/` builds and `mountClipStudio` mounts to default state | ■ (2026-07-22 — 318 modules; phase rail, profile cluster, take deck, live preview, Style/Background/Voice/Subtitles all render) |
| 1.4 | Zero console errors/warnings on first mount from a clean profile | ■ (2026-07-22 — fresh tab: **42 requests, 0 failures, 0 console output**, 0 root-absolute URLs) |
| 1.5 | Preferences read + write against Pages-origin IDB; survive reload | ■ (2026-07-22 — `rvnUserPrefs` schemaVersion **2** with 1 global row, written by the real `loadUserPreferences()`; `storage.local` value survived reload) |
| 1.6 | Extension-origin storage provably untouched (DevTools → Application, both origins) | ▲ operator-owed. Browser-enforced by origin, and the Pages origin holds its own `rvnImageDb` / `rvnLastRecording` / `rvnLastBaseMp4` / `rvnSessionTranscript` / `rvnUserPrefs` / `rvnWebHostStorage`. The two-origin eyeball still wants a human |
| 1.7 | Deploy workflow path filter includes `src/**` | ■ (2026-07-22 — `.github/workflows/deploy-demo.yml`) |
| 1.8 | **C1** in-page bake vs preview contention — observation recorded | ☐ **moved to Phase 1** — needs a real bake, which needs the loopback pipeline |
| 1.9 | **C2** app bundle weight recorded (excluding vendored FFmpeg) | ■ (2026-07-22 — **1.27 MB JS + 148 KB CSS**; 345 + 24 KB gzipped) |
| 1.10 | **C3** live Pages `Cache-Control` headers recorded; warm-path decision made | ■ (2026-07-22 — `max-age=600` **confirmed**, but revalidation returns **304 / 0 bytes / 0.58 s**, so the core is not re-downloaded. Warm path still needs **Cache Storage**, for HTTP-cache *eviction* of a 31 MB entry — not for max-age) |
| 1.11 | Studio assets vendored; no root-absolute `/assets/` survives the build | ■ (2026-07-22 — `copy-studio-assets.mjs` mirrors design-studio-v4 + fonts + backgrounds; build now **fails** on any surviving root-absolute URL in CSS or JS) |
| 1.12 | All 6 font faces load (2 Chakra Petch + 4 DejaVu subtitle faces) | ■ (2026-07-22 — `document.fonts` all `loaded`) |

### §1a Shim fidelity (the highest-risk surface — roadmap §3.2)

| # | Item | Result |
|---|---|---|
All exercised in-page against a **build** on 2026-07-22 — 11/11 assertions true.

| # | Item | Result |
|---|---|---|
| 1a.1 | `storage.onChanged` fires **for the writer's own writes** (not only for other listeners) | ■ two writes → two events |
| 1a.2 | Change payload shape matches `{ [key]: { oldValue, newValue } }` | ■ incl. correct `oldValue` chaining and `area === 'local'` |
| 1a.3 | `sendMessage` with no listener **resolves** (does not throw / reject) | ■ resolves `undefined` |
| 1a.4 | `runtime.id` truthy — `isExtensionContextValid()` passes | ■ `'rvn-web-host'` |
| 1a.5 | `getURL` resolves under the Pages base path for all 10 call sites' asset classes | ■ exact-match assertion + every real asset request landed under the base |
| 1a.6 | `storage.local` writes are genuinely async and ordered | ■ a read issued before the write resolved saw the stale value; 3 unawaited writes → last one wins |
| 1a.7 | `storage.session` clears on reload; `storage.sync` reads back what it wrote | ■ session gone after reload; sync round-trips and is a **distinct namespace** from local |
| 1a.8 | `remove()` of an absent key emits **no** change event (chrome does not) | ■ |

---

## §2 Phase 1 — record + take lifecycle

| # | Item | Result |
|---|---|---|
| 2.1 | Mic permission prompt appears and is honoured on the Pages origin | ▲ **OPERATOR-OWED** — the automation pane blocks `getUserMedia` outright. Verified only that **denial** degrades honestly ("Microphone access was denied…" + Retry). The grant path needs a human |
| 2.2 | Record → live WYSIWYG preview → stop; take appears in the deck | ✅ **agent 2026-07-22** (synthetic mic; every layer below `getUserMedia` real) — "Mic live" preview, `recording` → `processing:baseRecording` → `ready:baseMp4+baseRecording`, deck shows 0:26 "Take ready" |
| 2.3 | Base transcode completes through the in-page loopback pipeline | ✅ **agent 2026-07-22** — 30,690-byte MP4, real `ftyp` box; stages `queued → starting → writing-input → checking-assets → loading-wasm → transcoding-h264-aac → transcoding → done` |
| 2.4 | Progress UI advances (I5 semantics preserved — heartbeats do not reset the stall timer) | ▲ partial — relay verified to deliver every tick **exactly once** (one send → one receipt); the I5 *timer* assertion needs a job long enough to emit a `-heartbeat` stage, so it is owed on a real recording |
| 2.5 | Cancel mid-transcode leaves consistent state | ✅ **agent 2026-07-22** — terminal `COMPLETE ok:false "Transcode cancelled."`; no orphaned job |
| 2.6 | Take survives reload (recovery path) | ✅ **agent 2026-07-22** — after a full page reload the take is intact (0:26, "Take ready") and the workflow phase is restored to POLISH & BAKE |
| 2.7 | A second take does not corrupt the first | ✅ pipeline level, **agent 2026-07-22** — second job in the same session returned identical bytes in 74 ms at stage `20:ready` (engine reused). Take-level check still owed |
| 2.8 | Download produces a playable file | ✅ **agent 2026-07-22** — `reddit-voice-note-<ts>.mp4`, `ftyp` present, **decoded by a `<video>` element at 26.46 s**. Second take's download matched its stamped byte length exactly (437,817 B) |
| 2.12 | Discard take clears the session | ✅ **agent 2026-07-22** — take `null`, UI back to "No take yet". NOTE: gated by `window.confirm`, which the automation pane auto-dismisses; the dialog itself is **operator-owed** |
| 2.13 | Second take replaces the first rather than accumulating | ✅ **agent 2026-07-22** — new take id, fresh 15.912 s artifacts, and both IDB stores hold **exactly one row** |
| 2.14 | **C1** — preview does not stutter during an in-page bake | ✅ **resolved 2026-07-22.** Agent measured **zero main-thread long tasks** across a full transcode (6 s clip → 96,817 B MP4 in 617 ms; `PerformanceObserver` `longtask`) — the bake runs in a real module worker, so there is **no mechanism** for main-thread contention. Operator confirmed the remaining half: a **background/hidden tab throttles RAF to ~4 updates / 3 s** (≈1.3 fps, the standard hidden-tab clamp) and this is **not a bake blocker**. That throttle also explains the long-standing *"5–6× faster while minimized"* note — a hidden tab's clamped RAF stops the preview competing for the main thread |
| 2.9 | Relay rejects a malformed payload with the shared validator's exact message | ✅ **agent 2026-07-22** — bad `byteLength` → `ok:false` *"WebM base64 length mismatch at relay (bytes=999999, chars=4, expected≈1333332)."*; missing `jobId` → *"Transcode request missing jobId."* |
| 2.10 | FFmpeg assets resolve with the RIGHT content-type (not the `vite preview` HTML fallback) | ✅ **agent 2026-07-22** — `ffmpeg-core.wasm` → `application/wasm` 32,232,419 B; `esm/worker.js`, `esm/const.js` → `text/javascript`. **Never judge this by status code alone** |
| 2.11 | Voice Lab still loads FFmpeg after the core path moved to `/ffmpeg/` | ✅ **agent 2026-07-22** — `loadFfmpeg()` → `loaded: true`, 299 ms |

---

## §3 Phase 2 — visual system + bake

| # | Item | Result |
|---|---|---|
| 3.1 | Track A — Style Control Center, spectra/atmospheres/stackables render and hot-swap | ◐ **partial.** Render confirmed at mount (Phase 0 — Style/Background/Voice/Subtitles all render) and the operator baked a rich take with a scaffolded subtitle cue end-to-end (2026-07-22). Live **hot-swap during record** leans on RAF, which a background tab throttles to ~4 updates/3 s (operator-confirmed, 2.14) — so the visible-window hot-swap sweep is operator-owed |
| 3.2 | Track B — Background Layout v2 direct manipulation, presets, treatments | ◐ **partial.** Controls mount and are in the hosted module graph (Phase 0 + §6 entry); **H-5 operator-confirmed** — personal/animated backgrounds load via direct IDB (3.9). The direct-manipulation / preset / treatment interaction sweep on the hosted surface is still owed |
| 3.3 | Any surface needing a per-surface fix has its **shim root cause** recorded in the roadmap | ✅ **2026-07-22** — the host-classification hazard register (roadmap §7.2) records the root cause of every gap found, each with an owning phase; no per-surface local patch was needed |
| 3.4 | Browser-composite bake produces a downloadable MP4 | ✅ **operator 2026-07-22** — a bake with a scaffolded subtitle cue succeeded via the **browser-composite tier** (`renderBrowserComposite`, not a `drawtext` degrade); the MP4 **plays** and its **dimensions/duration match** the source. This is the shipped default tier (`browserComposite` default-on) and `src/composite/*` carries **zero `browser.*`**, so the tier is host-invariant by construction (§6 Phase 2 entry) |
| 3.5 | FFmpeg fallback tier produces a downloadable MP4 | ☐ **not exercised — by design.** The default browser-composite tier succeeded (3.4), so the fallback ladder (webcodecs+alphamerge → mediarecorder → drawtext) was never entered. It is reachable through the in-page pipeline Phase 1 wired; forcing a probe reject to exercise it is optional, not a Phase 2 gate |
| 3.6 | **Bake parity** — identical profile + source, extension vs hosted, compared frame-wise | ◐ **partial — operator 2026-07-22.** Duration and dimensions match the source on the hosted bake. The frame-wise extension-vs-hosted eyeball stays operator-owed, but per §6 the composite path has no `browser.*`, so tier-1 output is a pure function of host-invariant inputs — the eyeball **confirms** the structural argument rather than discovering a gap |
| 3.7 | Preview → record → bake parity holds on the hosted surface (I1/I3/I22/I23) | ◐ **partial — operator 2026-07-22.** Record → base MP4 → bake produced a playable MP4 with matching dims/duration; the I1/I3/I22/I23 frame-wise invariants ride on the same structural-parity argument as 3.6 |
| 3.8 | Bake size within the shared caps (base ≤25 MiB / baked ≤30 MiB on the 120 s gate) | ☐ sizes not captured this round. The caps are enforced by the same code on both hosts; a hosted measurement is a quick operator add |
| 3.9 | **H-5** (roadmap §7.2) — a personal background and an animated GIF background both load through **direct IDB**, never the port relay (`runtime.connect` throws on the hosted host). Watch for the console warning `Personal background port relay failed` — its absence is the pass | ☑ **operator-confirmed 2026-07-22** (owner's check). Kept as a standing watch through Phase 2's real visual runs, but no longer provisional |

---

## §4 Phase 3 — hub + chronos gate

| # | Item | Result |
|---|---|---|
| 4.1 | Naming reads correctly end to end: Voice Lab (light) vs Design Studio (full) — no stray "Voice Studio" | ✅ **agent 2026-07-22** — hub reads "Design Studio" (flagship) + "Voice Lab" + "Field Guide"; no "Voice Studio" on the hub (`read_page` against the build). Tutorial's 5 occurrences remain deferred (§4.3) |
| 4.2 | Three destinations present; Design Studio is visually primary | ✅ **agent 2026-07-22** — new `.hub__flagship` "Start here" card sits **before** the secondary row (DOM-order verified) with the amber-pill CTA (dark text, 999px); Field Guide + Voice Lab demoted to a "Prefer something lighter?" row and Voice Lab's CTA is no longer `--primary`. No horizontal overflow at 1280 or 375; flagship stacks to column on mobile |
| 4.3 | Card copy states the real first-load cost and the no-Reddit-posting limitation | ✅ **agent 2026-07-22** — flagship note: "Loads about 35 MB of media engines on your first visit, then caches them. It can't post to Reddit on its own — download your MP4, or install the extension…" |
| 4.4 | Cold cache — stages advance on real milestones, with byte progress on the engine fetch | ■ **operator 2026-07-22** — genuinely cold + cleared site data + **Slow 3G**: stages and byte-progress bar advanced honestly, cold warm completed, navigated to Studio as expected. (Agent cold path already cached 30.7 MB + navigated with 0 console errors.) |
| 4.5 | Warm cache — gate is brief or skipped | ✅ **agent 2026-07-22** — with `rvn-ffmpeg-warm-v1` seeded, the second run took the warm branch: **0 wasm fetches from the hub**, straight to "Opening…" and navigated fast |
| 4.6 | Failure path — throttled/blocked fetch surfaces an error with **Retry** and **Open anyway**; the warning sits **adjacent to the button** (not a dismissible toast) and names the consequence, per §5.1 | ■ **operator 2026-07-22** — DevTools blocked `ffmpeg-core.wasm` mid-warm: error UI with **Retry** + **Open anyway**, adjacent warning naming the bake/timeout consequence (§5.1). |
| 4.7 | Click-through actually proceeds — the user is never trapped on the hub | ■ **operator 2026-07-22** — with wasm blocked, **Open anyway** proceeded to the Studio un-warmed; user never trapped on the hub. |
| 4.8 | Hosted narrative replaces the attach story; `hostCapabilities.redditAttach:false` suppresses the CTA rather than leaving a dead button | ■ **operator 2026-07-22** — capture/polish: no dead Reddit CTA; copy points at download / install the extension. (Also agent: `test:workflow-banner-host` 6/6; absent field ⇒ extension byte-identical.) |
| 4.9 | **Timeout safety** — first bake after a gated cold load completes inside `ABSOLUTE_MAX_MS` | ■ **operator 2026-07-22** — first bake after a gated cold open completed normally (well inside the 90 s absolute max). |
| 4.10 | Deep link straight to `/design-studio/` on a cold cache degrades honestly (no hang) — the un-warmed state must be visible without ever passing the gate (§5.1) | ■ **operator 2026-07-22** — direct `/design-studio/` (including under throttled cold conditions) loaded and worked without hanging; never required the hub gate. |

---

## §5 Phase 4 — polish, a11y, closeout

| # | Item | Result |
|---|---|---|
| 5.1 | `prefers-reduced-motion` — gate is static text + progress | ■ **agent 2026-07-23** (`voice-studio-prod` :6174). The gate has **zero keyframe animations** (CSSOM scan of every `.chronos*` rule returned none); its only motion is the bar-fill `width` transition, which the `@media (prefers-reduced-motion: reduce)` block disables (`transition: none`) along with the scrim blur. So under reduced motion it is genuinely static text + a snapping progress bar. The DevTools "Emulate prefers-reduced-motion" one-click eyeball is optional — the rule is structurally proven |
| 5.2 | Keyboard path through hub CTAs and the gate; focus never trapped | ■ **agent 2026-07-23**. Hub CTA is a native `<a href>` (no tabindex meddling → Enter-activatable). On open, focus moves onto the `.chronos__card`; while warming Tab is a contained no-op (kept on the card — honors `aria-modal` without trapping, the gate self-resolves); on failure focus moves to **Retry** and Tab/Shift+Tab wrap between exactly the two buttons (both prevented + `.focus()` verified). Focus never escapes to the inert background, yet either button always proceeds — never stuck. `role=dialog` + `aria-modal=true` + `aria-labelledby` confirmed in the a11y tree |
| 5.3 | Gate stages announced (`aria-live="polite"`) | ■ **agent 2026-07-23**. `.chronos__status` is `aria-live="polite"` and its text updates per stage (captured "Loading media engines…" → "Could not warm the media engines."). The error region is now `role="alert"`, unhidden **before** its text is written so the content mutation lands while visible — the failure reason + consequence are announced assertively. a11y tree exposes the region as `alert` containing the reason, Retry/Open-anyway, and the warning |
| 5.4 | Contrast holds in the amber-action treatment | ■ **agent 2026-07-23** (WCAG ratios computed from resolved tokens). Amber-action treatment (dark text on the amber gradient): **8.46:1** worst end / **14.23:1** bright end — clears AA and AAA. Every meaningful gate pair passes AA: title/error/active-stage **12.87:1**, status/ghost **6.61:1**, warn **6.81:1**, done-stage **5.16:1**. **Accepted residual:** *pending/upcoming* stage rows are 2.68:1 — an intentional inactive-state dim (WCAG 1.4.3 exempt), documented in `base.css`; raising it would collapse the pending/done/active progress hierarchy, and the current step is carried at 12.9:1 + the polite live region |
| 5.5 | Long multi-take session — no runaway memory | ☐ |
| 5.6 | Optional Vosk tier: either working, or explicitly cut and documented | ◐ **Vendored + agent-verified (0.9), 2026-07-23** · **terminal-delivery bug fixed 2026-07-23** — Vosk could finish (`applied: true`) while UI stayed Pending because the web relay omitted background's IDB + `SESSION_TRANSCRIPT_READY_KEY` side effect (rule 6 forbids COMPLETE re-broadcast, not persistence). Fix in `web-pipeline-host.ts`; relay suite **18/18**. Evidence: `logs/vosk-transcribe-bug-2.log` + `screenshot/vosk-transcribe-bug-2.png` (pre-fix). **Operator tail still open:** rebuild preview → mic record → Generated transcript leaves Pending with real cues → bake → captions in MP4 |
| 5.7 | Production build + **real Pages deploy** verified from a clean profile | ☐ |
| 5.8 | Living docs updated; every roadmap **[?]** promoted to **[V]** or deleted | ☐ |

---

## Verdict

**Phase 3 (hub + chronos):** ■ **PASS 2026-07-22** — agent implementation + in-harness cold/warm, plus full operator closeout of 4.4–4.10 (cold Slow 3G, first bake after gate, deep-link cold, blocked-wasm failure UI, hosted banner).

**Track overall:** ◐ **Phases 0–3 closed** · **Phase 4 in flight** — Vosk captions **vendored + agent-verified (H-2)**; **terminal UI delivery fixed** (IDB + ready key on web relay; re-test 5.6 operator tail); **studio-side Cache-Storage wasm read landed + real-runner-verified (§3.5; 0.10)**; **gate a11y 5.1–5.4 agent-verified 2026-07-23** (reduced-motion, keyboard/focus containment, `aria-live` + `role="alert"`, WCAG contrast); remaining Phase 4: multi-take memory (5.5), Pages deploy (5.7), living-doc tidy (5.8), and the 5.6 operator caption tail.

**Blockers:** none · **Accepted residuals:** Phase 2 frame-wise extension eyeball; record-time hot-swap under RAF throttle; FFmpeg fallback bake tier never entered; bake-size caps not re-measured (3.8). ~~auto-Vosk fails as-designed until Phase 4 vendors assets~~ **fixed 2026-07-23 — Vosk vendored, sandbox READY + real transcript proven on a build (H-2).**
