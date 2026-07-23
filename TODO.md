# TODO

## Prior stable — **v5.10.0 Raw Trim Apply** (tagged `v5.10.0` · real-browser QA PASS 2026-07-12)

**Design (as-built):** [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) · **Release notes:** [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)  
**Package:** `5.10.0` · **Push:** deferred (user pushes)

Trim keeps the voice: **Apply trim** also cuts the raw capture WebM (audio-only, mediabunny, sample-accurate Opus) and re-stamps `baseRecording` in the same atomic write — post-trim **voice re-apply / Change Voice** work. Raw-leg failure demotes honestly to the v5.9 lock. Node: timeline 22 · take-manager 34; build + tsc clean. Real-browser checklist **all PASS**.

## Current stable — **v5.11.0 preferences full-IDB migration** (SHIPPED · browser QA PASS 2026-07-13 · merged to `main` + tagged `v5.11.0`, push deferred)

**Merged:** `feature/v5.11.0-prefs-storage-refactor` → `main` (`853d3d8`) · **Tag:** `v5.11.0` · **Package:** `5.11.0` · **Source of truth:** [`docs/v5.11.0-prefs-storage-refactor.md`](docs/v5.11.0-prefs-storage-refactor.md) · **Release notes:** [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md)

**Implemented:** preserved `user-preferences.ts` API + BUG-023 queue; full `rvnUserPrefs` IndexedDB (`global`, `profiles`, `customStyles`); signal-only `rvnUserPrefs.v2`; transparent Reddit content-script → background IDB load/replace requests; delete-after-success/retryable v1 migration; transcript-result stripping; JSON Export/Import in the Studio profile cluster; per-save size telemetry/dev warnings; ADR-0006 and architecture map **v3.1**.

**Automated:** `test-user-prefs-storage.mjs` **12/12** · `npm run build` **PASS** · `npm run compile` only the same **2 pre-existing** subtitle errors.

**Real-browser QA (2026-07-13):** **PASS · blockers none.** Checklist `.ignore/QA-5.11.0/qa-checklist.md` — fresh install, v1 upgrade (real + planted), profile/style CRUD, hot-swap, Reddit cold-load relay + capture, Export/Import, DevTools rows, size telemetry, product smoke all ■. §3 force-fail ▲ PARTIAL accepted (fallback verified; Node covers inject). §14 skipped (H8 closed). No post-QA code fixes.

**Shipped:** merged → `main` (`853d3d8`) + tagged **v5.11.0** (2026-07-13; push user-owned) · release notes [`docs/release-notes-v5.11.0.md`](docs/release-notes-v5.11.0.md). **Next:** scope **v6.0**. Optional future: Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

## Current work — **v6.0 "Polish & Visual Maturity" · Tracks A/B/C/D code complete · package still 5.11.0**

Roadmaps from `.ignore/prep-v6.0.0/` via `/architecture-hardening`. **Branch:** `main` (Track D merged from `feature/v6.0.0-hosted-design-studio`). Package remains **5.11.0** until the explicit v6.0.0 release sprint.

| Track | Roadmap | ADR | Gist |
|-------|---------|-----|------|
| **D — hosted Design Studio** | [`docs/v6.0.0-hosted-design-studio.md`](docs/v6.0.0-hosted-design-studio.md) | none yet (0011 next) | Full Studio on GitHub Pages via a `browser` global shim — **COMPLETE · Phases 0–4 ✅ · real Pages 5.7 PASS · merged** |
| **A — audio-reactive visuals** | [`docs/v6.0.0-custom-styles-refactor.md`](docs/v6.0.0-custom-styles-refactor.md) | [0007](docs/architecture/adr/0007-audio-reactive-visualizer-core.md) + [0009](docs/architecture/adr/0009-registry-native-sparkle-bokeh.md) + [0010](docs/architecture/adr/0010-bubbles-label-stable-bokeh-id.md) | 6 spectra · 7 atmospheres · 7 stackables · Style Control Center · governor — **confidence QA PASS (Pass E) · merged** |
| **B — background layout** | [`docs/v6.0.0-background-panel-refactor.md`](docs/v6.0.0-background-panel-refactor.md) | [0008](docs/architecture/adr/0008-background-direct-manipulation-layout.md) **Accepted** | Layout core + direct manipulation + presets + effects/GIF/eye-dropper + framing — **full checklist PASS · merged** |
| **C — popup UI refresh** | [`docs/v6.0.0-popup-ui-refresh.md`](docs/v6.0.0-popup-ui-refresh.md) | none (presentational, under 0007 tokens) | Popup Cividis skin + elevated restart caution — **agent QA gate PASS · merged** |

**Track B status:** ✅ Phase 0–7 + final presentation refinement · ✅ full operator checklist including saved profile / identity hot-swap / Classic / popup · ✅ real blur/GIF **23/29 MiB PASS** · ✅ preview→record→bake parity · ✅ keyboard/contrast/reduced-motion · ✅ responsive precision frame + session-only A/B · ✅ focused **89/89**, tokens + size logic + build PASS · ✅ merged to `main` (`7d1c649`).

**Performance observation (deferred):** browser subtitle composite/burn-in is reportedly ~5–6× faster while the Studio window is minimized. Non-blocking; investigate focused-window RAF/render/GPU scheduling after Track B rather than changing the bake pipeline in Phase 6.

**Track A status:** ✅ full catalog + Style panel + governor · ✅ Pass E confidence · ✅ merged. **Accepted residual:** Conway long-horizon corner parking (documented; not a blocker).

**Track C status:** ✅ popup-only Cividis skin + elevated restart caution · ✅ agent gate PASS · ✅ merged · §8 real-extension eyeball residual optional.

**Track D status (COMPLETE · merged 2026-07-23):** ✅ Phases 0–4 · ✅ Vosk captions working (H-2 + terminal IDB/ready-key persist; relay **18/18**) · ✅ studio-side Cache-Storage wasm read · ✅ gate a11y 5.1–5.4 · ✅ multi-take memory 5.5 · ✅ living-doc tidy 5.8 · ✅ Pages CI without `.wxt/` / root `node_modules` · ✅ **real Pages deploy 5.7 operator PASS**. **No merge blockers.** Package stays **5.11.0** until explicit v6 release.

The seam is **one `browser` global shim**, not an interface — and it held: zero extension-source edits were needed *for the host boundary*. Record and the default browser-composite bake are already `browser.*`-free; transcode/burn-in/transcribe now **do** reuse `entrypoints/offscreen/main.ts` in-page over the loopback bus, with `demo/design-studio/host/web-pipeline-host.ts` playing `background.ts`'s relay slice and `src/messaging/relay-validate.ts` shared by both relays.

**Phase 0 as-built** (`dac1bf0`, `f96f5f8`, `+ assets`): demo `@` alias → repo root with the 12 duplicate DSP modules deleted · `demo/design-studio/host/` shim (storage over Pages-origin IDB, loopback runtime bus, `getURL` prefix swap) · Studio assets vendored whole-tree by `copy-studio-assets.mjs` · deploy workflow watches `src/**`. Gate met: **42 requests, 0 failures, 0 console output**; shim fidelity **11/11**; §0 standing regression green.

**Eight host-neutrality rules are now binding** (each one cost a real bug — full detail in [extension-points.md](docs/architecture/extension-points.md) → *Host adapter*):

1. Classify the host with `isOwnStorageOrigin()` ([`src/utils/host-origin.ts`](src/utils/host-origin.ts)) — **never** `location.protocol`.
2. Reach packaged assets via `browser.runtime.getURL()` — **never** a `'/assets/…'` literal. Build-enforced.
3. Keep `browser.*` inside function bodies in shared `src/`.
4. Root `tsconfig.json` excludes `demo/` — the two projects define `browser` differently.
5. **`npm run compile` must stay at zero errors.** The demo's build gates on `tsc`, so an extension type error is a Pages-deploy failure. The two long-tolerated subtitle diagnostics were fixed; that allowance is gone.
6. *(Phase 1)* A relay must **not** forward what the loopback bus already delivers — no `PROGRESS`/`COMPLETE` re-broadcast, and ignore `target:'offscreen'`. Both failures are **silent**: a duplicated `COMPLETE` reads as a phantom take.
7. *(Phase 1)* **A shim that faithfully resolves can be more dangerous than one that throws.** Both artifact relays assumed a background service worker existed; with none, `sendMessage` resolved and the catch-and-warn never fired, so every recording was dropped **silently**. Relays now fall back to a direct commit when unanswered *and* `isOwnStorageOrigin()`, sharing one choke point in [`artifact-commit.ts`](src/storage/artifact-commit.ts) (H13). Expect more of this class.
8. *(Phase 1)* Vendor packaged **multi-file** assets whole. `ffmpeg/esm/` is a module worker plus siblings; `demo/` mirrors the extension's `public/ffmpeg/` tree exactly so `getURL('ffmpeg/…')` needs no branch.

**Rules 1/2/3/8 are now machine-checked AND gate the build** — `npm run test:host-neutrality` ([script](scripts/test-host-neutrality.mjs)) resolves the hosted Studio's **real** module graph via an esbuild metafile (~210 shared `.ts` files from `demo/design-studio/main.ts`) and lints exactly those, so it widens with Phase 2 and never fires on extension-only code. Each rule negative-tested; it **cannot** catch rule 7 (behavioural). It is the first step of `demo`'s `build` (`test:host-neutrality && tsc --noEmit && vite build`), so a regression fails `cd demo && npm run build` before tsc/vite and blocks the Pages deploy — CI-safe with no root install (cwd-independent, esbuild from `demo/node_modules`). Still QA item 0.6 as a standalone check. The sweep found **no live hits** in shared code; five residual hazards are registered with an owning phase in the roadmap's §7.2 (**H-5 operator-confirmed 2026-07-22**).

**Checks (all closed):** ✅ **C2** app bundle 1.27 MB JS + 148 KB CSS (345 + 24 KB gzip) · ✅ **C3** Pages sends `max-age=600`, but revalidation returns **304 / 0 bytes / 0.58 s** — the warm-path risk is HTTP-cache *eviction* of a 31 MB entry, not expiry, so Cache Storage is still wanted · ✅ **C1** resolved 2026-07-22 — a full transcode produced **zero main-thread long tasks** (worker-based bake → no contention mechanism); operator confirmed a hidden tab throttles RAF to ~4 updates/3 s and that this is **not a bake blocker** (also explains the old "5–6× faster while minimized" note).

**Landed 2026-07-22 — naming + copy (presentational only, zero identifier renames):**

- **D1:** the lightweight Pages page is now **Voice Lab** (hub card/CTA, `<title>`, nav wordmark, README, module headers). The `/studio/` URL and `demo/src/studio/` path are unchanged.
- **Chronos failure policy:** Retry + **Open anyway** click-through with an adjacent warning naming the consequence ("baking may fail or time out"). Never a hard block, never silent — roadmap §5.1.
- **User-facing "Reddit" copy:** removed only where Reddit was presented as a **requirement** (false since v5.4 Studio-native capture). **Kept** provenance (`take.source === 'reddit'`), optional attach (after Download), Reddit-specific constraints, and the product name. Hub + Studio now share **Design → Capture → Polish**. Rule: [`docs/design-studio.md`](docs/design-studio.md) §8.5 · rationale: [roadmap §4.2](docs/v6.0.0-hosted-design-studio.md). Verified: `npm run compile` only the 2 pre-existing subtitle diagnostics · demo `tsc --noEmit` clean · hub + Voice Lab rendered console-clean.
- **Deferred:** Field Guide refresh (86 "Reddit" + 5 "Voice Studio"). **Settle first** — the tutorial exists as two near-identical copies (`docs/tutorial/tutorial.html` vs `demo/public/tutorial/index.html`, differing by one favicon line).

**QA workspace:** [`qa/QA-6.0.0/`](qa/QA-6.0.0/) · [`TODO-6.0.0.md`](qa/QA-6.0.0/TODO-6.0.0.md) · [`progress-QA-6.0.0.md`](qa/QA-6.0.0/progress-QA-6.0.0.md) · checklists [`track-b/qa-checklist.md`](qa/QA-6.0.0/track-b/qa-checklist.md) · [`track-d/qa-checklist.md`](qa/QA-6.0.0/track-d/qa-checklist.md)

**NEXT (post Track D merge):** explicit **v6.0.0 release boundary** — package/manifest bump, release notes, tag, docs-archiving Refresh / HISTORY row. **Pre-ship polish (recommended after code freeze or as a short pre-tag pass):** Field Guide tutorial refresh (86 "Reddit" + 5 "Voice Studio"; settle two-copy duplication first). Optional Track C §8 eyeball. Package remains **5.11.0** and `USER_PREFS_VERSION` remains **1** until that explicit release sprint. Push of `main`/tags remains **user-owned**.

**Non-negotiables:** capture-time visuals; Design-phase bg layout only (I1/I3); `normalize*` guards / no `USER_PREFS_VERSION` bump; no new deps/WASM/compositing layer; no Classic regression vs v5.11.0. **Track D adds:** no new execution context/message family/store; no behavioural change to the extension Studio (additive optional options only); Voice Lab + Field Guide green at every phase exit.

Optional future: Import merge/union mode ([`docs/future-ideas.md`](docs/future-ideas.md)).

## Hardening closed (2026-07-12) — **no version bump**

| Item | Outcome |
|------|---------|
| **H13** persist-before-stamp | **RESOLVED + browser QA PASS** — merged to `main`. `saveLast*` throw on size/IDB failure, return meta; four choke points stamp only from meta. Node **28/28**. |
| **H14 / BUG-038** tab-close transcript | **RESOLVED + browser QA PASS** — merged to `main`. Background owns terminal transcript commit + 125 s watchdog. Node **12/12**. |
| **H8** recovery voice provenance | **RESOLVED + browser QA PASS** — on `feature/v5.11.0-prefs-storage-refactor` (from `ad534df`). Take-owned `captureVoiceIntent`; recovery ignores mutated/nuked resume-time prefs. Node take-manager **37/37** · deck **13/13**. |

**Verify:** artifact-store writes 28 · transcribe-failure 12 · take-manager 37 · take-deck 13 · timeline 22 · build PASS · tsc 2 pre-existing. Push of `main` / tags remains user-owned.

## Shipped ledger

Full milestone index with living + archived doc pointers: [`docs/HISTORY.md`](docs/HISTORY.md).

| Version | Focus | More |
|---------|-------|------|
| **v5.10.0** | Raw WebM trim — post-trim voice re-apply — **QA PASS · tagged** | [notes](docs/release-notes-v5.10.0.md) |
| **v5.9.0** | Atomic trim apply — **tagged** | [notes](archive/docs/release-notes-v5.9.0.md) |
| **v5.8.0** | Timeline visual subtitle editor | [notes](archive/docs/release-notes-v5.8.0.md) |
| **v5.7.0** | Partial re-bake splice (Phase 2b) — default-on | [notes](archive/docs/release-notes-v5.7.0.md) |
| **v5.6.0** | Audio decoupling + voice re-apply + editing/timeline backend | [notes](archive/docs/release-notes-v5.6.0.md) |
| **v5.5.0 / v5.5.1** | Browser-side full composite + default-on | [HISTORY](docs/HISTORY.md) |
| **v5.4.0** | Design Studio First (standalone suite + Take lifecycle) | [HISTORY](docs/HISTORY.md) |
| **≤ v5.3.10** | WebCodecs backbone → v1.0.0 MVP | [HISTORY](docs/HISTORY.md) / `archive/` |

**Restore any time:** `git checkout main && npm install && npm run dev`

## Architecture hardening

**v6 Tracks A/B/C merged (2026-07-20)** — **map v3.22 · extension-points v1.37 · hardening backlog v2.13 · ADRs 0001–0010**. Background Layout v2 extends the existing normalized preference → preview → recorder → record-time canvas seam; no new context/message/store/signal/layer. Triggers in [`docs/architecture/README.md`](docs/architecture/README.md).
