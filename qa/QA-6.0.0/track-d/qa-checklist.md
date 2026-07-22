# Track D — Hosted Design Studio · operator checklist

**Status:** skeleton — populated per phase as implementation lands
**Roadmap:** [`docs/v6.0.0-hosted-design-studio.md`](../../../docs/v6.0.0-hosted-design-studio.md) · **Track README:** [`README.md`](README.md)
**Operator:** _tbd_ · **Machine / browser:** _tbd_ · **Build under test:** _tbd_

**Legend:** ■ PASS · ▲ PARTIAL (explain) · ✕ FAIL (blocker) · ☐ not yet run · — N/A this phase

> QA the hosted surface against a **build or a deploy**, never `vite dev`. The existing Voice Studio's audition freeze at "5%" under `vite dev` is a known dev-server artifact (HMR/re-optimization aborts the 31 MB `ffmpeg.load()`); the same failure mode applies to the Design Studio and will waste an operator session if forgotten.
>
> ```bash
> cd demo && npm run build && npm run preview
> ```

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
| 1.3 | `demo/design-studio/` builds and `mountClipStudio` mounts to default state | ☐ |
| 1.4 | Zero console errors/warnings on first mount from a clean profile | ☐ |
| 1.5 | Preferences read + write against Pages-origin IDB; survive reload | ☐ |
| 1.6 | Extension-origin storage provably untouched (DevTools → Application, both origins) | ☐ |
| 1.7 | Deploy workflow path filter includes `src/**` | ■ (2026-07-22 — `.github/workflows/deploy-demo.yml`) |
| 1.8 | **C1** in-page bake vs preview contention — observation recorded | ☐ |
| 1.9 | **C2** app bundle weight recorded (excluding vendored FFmpeg) | ☐ |
| 1.10 | **C3** live Pages `Cache-Control` headers recorded; warm-path decision made | ☐ |

### §1a Shim fidelity (the highest-risk surface — roadmap §3.2)

| # | Item | Result |
|---|---|---|
| 1a.1 | `storage.onChanged` fires **for the writer's own writes** (not only for other listeners) | ☐ |
| 1a.2 | Change payload shape matches `{ [key]: { oldValue, newValue } }` | ☐ |
| 1a.3 | `sendMessage` with no listener **resolves** (does not throw / reject) | ☐ |
| 1a.4 | `runtime.id` truthy — `isExtensionContextValid()` passes | ☐ |
| 1a.5 | `getURL` resolves under the Pages base path for all 10 call sites' asset classes | ☐ |
| 1a.6 | `storage.local` writes are genuinely async and ordered | ☐ |
| 1a.7 | `storage.session` clears on reload; `storage.sync` reads back what it wrote | ☐ |

---

## §2 Phase 1 — record + take lifecycle

| # | Item | Result |
|---|---|---|
| 2.1 | Mic permission prompt appears and is honoured on the Pages origin | ☐ |
| 2.2 | Record → live WYSIWYG preview → stop; take appears in the deck | ☐ |
| 2.3 | Base transcode completes through the in-page loopback pipeline | ☐ |
| 2.4 | Progress UI advances (I5 semantics preserved — heartbeats do not reset the stall timer) | ☐ |
| 2.5 | Cancel mid-transcode leaves consistent state | ☐ |
| 2.6 | Take survives reload (recovery path) | ☐ |
| 2.7 | A second take does not corrupt the first | ☐ |
| 2.8 | Download produces a playable file | ☐ |

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
