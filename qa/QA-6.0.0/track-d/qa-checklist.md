# Track D — Hosted Design Studio · operator checklist

**Status:** skeleton — populated per phase as implementation lands
**Roadmap:** [`docs/v6.0.0-hosted-design-studio.md`](../../../docs/v6.0.0-hosted-design-studio.md) · **Track README:** [`README.md`](README.md)
**Operator:** _tbd_ · **Machine / browser:** _tbd_ · **Build under test:** _tbd_

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
| 2.1 | Mic permission prompt appears and is honoured on the Pages origin | ☐ |
| 2.2 | Record → live WYSIWYG preview → stop; take appears in the deck | ☐ |
| 2.3 | Base transcode completes through the in-page loopback pipeline | ✅ **agent 2026-07-22** — 30,690-byte MP4, real `ftyp` box; stages `queued → starting → writing-input → checking-assets → loading-wasm → transcoding-h264-aac → transcoding → done` |
| 2.4 | Progress UI advances (I5 semantics preserved — heartbeats do not reset the stall timer) | ▲ partial — relay verified to deliver every tick **exactly once** (one send → one receipt); the I5 *timer* assertion needs a job long enough to emit a `-heartbeat` stage, so it is owed on a real recording |
| 2.5 | Cancel mid-transcode leaves consistent state | ✅ **agent 2026-07-22** — terminal `COMPLETE ok:false "Transcode cancelled."`; no orphaned job |
| 2.6 | Take survives reload (recovery path) | ☐ |
| 2.7 | A second take does not corrupt the first | ✅ pipeline level, **agent 2026-07-22** — second job in the same session returned identical bytes in 74 ms at stage `20:ready` (engine reused). Take-level check still owed |
| 2.8 | Download produces a playable file | ☐ |
| 2.9 | Relay rejects a malformed payload with the shared validator's exact message | ✅ **agent 2026-07-22** — bad `byteLength` → `ok:false` *"WebM base64 length mismatch at relay (bytes=999999, chars=4, expected≈1333332)."*; missing `jobId` → *"Transcode request missing jobId."* |
| 2.10 | FFmpeg assets resolve with the RIGHT content-type (not the `vite preview` HTML fallback) | ✅ **agent 2026-07-22** — `ffmpeg-core.wasm` → `application/wasm` 32,232,419 B; `esm/worker.js`, `esm/const.js` → `text/javascript`. **Never judge this by status code alone** |
| 2.11 | Voice Lab still loads FFmpeg after the core path moved to `/ffmpeg/` | ✅ **agent 2026-07-22** — `loadFfmpeg()` → `loaded: true`, 299 ms |

---

## §3 Phase 2 — visual system + bake

| # | Item | Result |
|---|---|---|
| 3.1 | Track A — Style Control Center, spectra/atmospheres/stackables render and hot-swap | ☐ |
| 3.2 | Track B — Background Layout v2 direct manipulation, presets, treatments | ☐ |
| 3.3 | Any surface needing a per-surface fix has its **shim root cause** recorded in the roadmap | ☐ |
| 3.4 | Browser-composite bake produces a downloadable MP4 | ☐ |
| 3.5 | FFmpeg fallback tier produces a downloadable MP4 | ☐ |
| 3.6 | **Bake parity** — identical profile + source, extension vs hosted, compared frame-wise | ☐ |
| 3.7 | Preview → record → bake parity holds on the hosted surface (I1/I3/I22/I23) | ☐ |
| 3.8 | Bake size within the shared caps (base ≤25 MiB / baked ≤30 MiB on the 120 s gate) | ☐ |

---

## §4 Phase 3 — hub + chronos gate

| # | Item | Result |
|---|---|---|
| 4.1 | Naming reads correctly end to end: Voice Lab (light) vs Design Studio (full) — no stray "Voice Studio" | ☐ |
| 4.2 | Three destinations present; Design Studio is visually primary | ☐ |
| 4.3 | Card copy states the real first-load cost and the no-Reddit-posting limitation | ☐ |
| 4.4 | Cold cache — stages advance on real milestones, with byte progress on the engine fetch | ☐ |
| 4.5 | Warm cache — gate is brief or skipped | ☐ |
| 4.6 | Failure path — throttled/blocked fetch surfaces an error with **Retry** and **Open anyway**; the warning sits **adjacent to the button** (not a dismissible toast) and names the consequence, per §5.1 | ☐ |
| 4.7 | Click-through actually proceeds — the user is never trapped on the hub | ☐ |
| 4.8 | Hosted narrative replaces the attach story; `hostCapabilities.redditAttach:false` suppresses the CTA rather than leaving a dead button | ☐ |
| 4.9 | **Timeout safety** — first bake after a gated cold load completes inside `ABSOLUTE_MAX_MS` | ☐ |
| 4.10 | Deep link straight to `/design-studio/` on a cold cache degrades honestly (no hang) — the un-warmed state must be visible without ever passing the gate (§5.1) | ☐ |

---

## §5 Phase 4 — polish, a11y, closeout

| # | Item | Result |
|---|---|---|
| 5.1 | `prefers-reduced-motion` — gate is static text + progress | ☐ |
| 5.2 | Keyboard path through hub CTAs and the gate; focus never trapped | ☐ |
| 5.3 | Gate stages announced (`aria-live="polite"`) | ☐ |
| 5.4 | Contrast holds in the amber-action treatment | ☐ |
| 5.5 | Long multi-take session — no runaway memory | ☐ |
| 5.6 | Optional Vosk tier: either working, or explicitly cut and documented | ☐ |
| 5.7 | Production build + **real Pages deploy** verified from a clean profile | ☐ |
| 5.8 | Living docs updated; every roadmap **[?]** promoted to **[V]** or deleted | ☐ |

---

## Verdict

**Overall:** ☐ · **Blockers:** _tbd_ · **Accepted residuals:** _tbd_
