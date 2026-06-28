# Static Voice Graph Studio — Design Document

**Canonical, committed redraft.** Supersedes the working draft at
`.ignore/voice-design-page-roadmap.md` (kept only as historical scratch).
This file wins on the topic of the public static Voice Studio companion page.

| | |
|---|---|
| **Repo** | `bra-khet/reddit-voice-notes-chrome` |
| **Baseline** | `main@4383593` (v5.3.1) → feature branch `feature/static-voice-studio` |
| **Status** | Phases 0–5 + 7-samples done (audio + round-trip QA confirmed 2026-06-28); Phase 6 Orientation hub (user-owned) + publish remain |
| **Public URL (target)** | `https://bra-khet.github.io/reddit-voice-notes-chrome/` (hub) · `/studio/` (the studio) |

---

## 1. What this is

A **completely static, self-contained web page** that replicates the Design
Studio's **Voice panel** (character chips, composer, intensity/turbo, audition)
with high fidelity, hosted on GitHub Pages. Anyone can demo, learn, and
experiment with character voices **without installing the extension**, and
**copy-paste voices both ways** with the live extension.

It is 100% separate from the extension: different origin, its own build, no
shared storage, **zero risk of interference**. It does **not** modify any
extension code — it *reuses* the extension's pure DSP modules to provide a
static front-end over them.

## 2. Locked architecture decisions (2026-06-27)

These were confirmed with the repo owner and drive everything below.

1. **Build:** **Vite + TypeScript**, as a self-contained mini-project under
   **`site/`** (its own `package.json`; never entangled with the WXT extension
   build at repo root).
2. **Deploy:** Vite builds to `site/dist/`; that output is published to the
   **root of a dedicated `gh-pages` branch**. GitHub Pages → *Deploy from a
   branch* → **`gh-pages` / `(root)`**. Keeps the extension's repo root pristine;
   nothing generated is committed to `main`.
3. **Verbatim DSP port via path alias.** The extension's folder structure is
   mirrored under `site/src/` and `@` is aliased to the `site/` root, so the
   ported modules are **byte-for-byte copies** (zero edits). Re-syncing after an
   extension DSP change is a literal file copy — see §4.

### 2.1 Base path

Project Pages are served under `/<repo>/`, so Vite `base` is
`'/reddit-voice-notes-chrome/'` even when deploying from the `gh-pages` root.
Hub → `…/reddit-voice-notes-chrome/`, studio → `…/reddit-voice-notes-chrome/studio/`.

## 3. Why this exists (product context)

The extension's Voice panel (see `docs/design-studio.md` §6) is powerful but
gated behind installation. People want to: hear "what a character voice sounds
like" before installing; learn the composer by playing live; test a voice they
built in the extension by pasting its JSON here (or vice-versa); and share a
single link in tutorials/Discord — "just open this, no install."

This is also the first surface of a future **Orientation hub** (an index page
that explains the 3-phase Reddit↔Studio workflow and links out to the tutorial
and this studio). The hub is **scaffolded as a placeholder in Phase 0** and
**fully written in Phase 6**. Until then, the studio's nav banner links to the
placeholder hub and is **clearly marked WIP** (see §7).

## 4. The port set (the whole "voice brain")

Everything the studio needs is **10 pure-data / string-emitting leaf modules** —
no WASM, no `chrome.*`, no DOM. They are copied **verbatim** under `site/src/`
mirroring their extension paths; `@` → `site/` makes even alias imports resolve
unchanged.

| Extension path → mirrored under `site/src/…` | Role |
|---|---|
| `src/voice/dsp/fragment-types.ts` | Canonical `StylizedGraph`, 21 fragment kinds, `FRAGMENT_DEFS`, normalize |
| `src/voice/dsp/preset-graphs.ts` | `CHARACTER_PRESETS` (Incognito, Cyber Oracle, NerdRage, …) |
| `src/voice/dsp/build-stylized-graph.ts` | `buildStylizedGraph`, `CANONICAL_CHAIN_ORDER`, `orderFragmentsCanonically` |
| `src/voice/dsp/renderer.ts` | Backend-agnostic renderer contract + intensity curves |
| `src/voice/dsp/ffmpeg-renderer.ts` | Emits the real `-af` / `-filter_complex` strings |
| `src/voice/dsp/ir-generator.ts` | **Procedural** reverb impulse response → WAV (no external IR assets) |
| `src/voice/dsp/resolve-graph.ts` | `resolveVoiceGraph(config)` → `StylizedGraph` |
| `src/voice/dsp/index.ts` | Barrel |
| `src/voice/types.ts` | `VoiceEffectConfig` + `normalizeVoiceEffectConfig` + intensity constants |
| `src/settings/clipboard-backup.ts` | The **`rvn-voice-character-v1`** copy/paste contract |

### 4.1 Fidelity is mechanical, not aspirational (preview = bake)

The extension's export and the studio's preview call the **same** code:

```
resolveVoiceGraph(config)                         // → StylizedGraph
  → buildStylizedGraph(graph, ffmpegRenderer)     // → { mode, af | filterComplex, auxInputs, … }
  → run that exact -af / -filter_complex through ffmpeg.wasm
```

Because `ffmpegRenderer` is the *same emitter* the extension's `ffmpeg-runner.ts`
feeds to its FFmpeg pass, the produced filter string is identical → the audio is
byte-identical. Convolution reverb is self-contained: `ir-generator.ts`
synthesizes the IR procedurally and hands it to FFmpeg as an aux `-i` WAV, so the
studio's ffmpeg.wasm invocation must **write those aux files to the FFmpeg FS**
(not just pass `-af`). There is **no second "demo DSP" to drift.**

### 4.2 Copy-paste contract

The clipboard envelope is exactly what the extension reads/writes:

```json
{ "type": "rvn-voice-character-v1", "exportedAt": "<ISO-8601>",
  "voice": { "enabled": true, "intensity": 7, "turbo": false, "graph": { … } } }
```

`serializeVoiceCharacter` / `parseVoiceCharacterPayload` (from the ported
`clipboard-backup.ts`) are the single (de)serializers — round-trips losslessly
with the live extension. Any schema change is a `type` version bump + migration
shim on **both** sides.

## 5. Scope

**In scope (MVP that feels complete):**
- Full voice authoring surface: Enable toggle, `CHARACTER_PRESETS` chips,
  Intensity slider + Turbo, the composer (7 fragment categories, core effects +
  "Show advanced" + per-fragment Fine-tune, toggles + sliders, Blank slate,
  Reset order). First manual edit forks a chip to **Custom** (mirrors the extension).
- Copy / Paste character (`rvn-voice-character-v1`), round-trip-perfect.
- Audition: "Last Voice Note" → 2–3 bundled sample clips; "One-Time Test" → live
  mic capture (transient, never persisted; mirrors `mic-test-capture.ts` + level
  meter); optional upload-your-own-clip fallback. Shared Stop + single player.
- Resolve + render path producing audibly identical output to the extension.
- Live summary chip (mirrors `formatVoiceEffectSummary`).
- In-memory `currentVoiceConfig` + optional `localStorage` `rvn-static-studio-last-voice`
  session restore. **Never** touches extension storage keys/origins.
- CVD-friendly, responsive UI reusing the Studio palette tokens.
- Works offline after first load (wasm cached).

**Out of scope (MVP):** Bar Style / Background / Subtitle panels; persistent
named profiles or cloud sync; writing any extension storage/IDB; a real-time Web
Audio graph (ffmpeg path is authoritative for fidelity); in-studio recording or
Reddit attach; subtitle burn-in / video export.

**Future (documented, not MVP):** A/B dry vs processed; auto re-test on change
(debounced); favorite test takes (local only); Web Audio "lite mode" toggle;
full tutorial/orientation integration.

## 6. Technical stack

- Single static site, no server. Vanilla HTML5 + modern CSS (Grid/Flex, custom
  properties) + ES modules, TypeScript for logic.
- Audio rendering (fidelity): `@ffmpeg/ffmpeg` (v0.12+) + **self-hosted**
  `ffmpeg-core.wasm` under `site/public/assets/ffmpeg/` (added in Phase 3).
- Assets ported: a curated subset of `public/assets/design-studio-v4/` SVGs (nav
  banner, section icons), the palette tokens from `studio-palette.css`, the exact
  `CHARACTER_PRESETS`.
- Security/CSP: plain HTTPS page → `getUserMedia` works per-origin; no
  `unsafe-eval`; wasm loaded explicitly.

## 7. Navigation / Orientation hub (WIP — future feature)

> **Work in progress.** The full Orientation index page is a **future feature**
> (Phase 6). Phase 0 ships a *placeholder* hub at the site root and a themed nav
> banner on the studio that anticipates it. Both the banner code and the hub
> carry `WIP:` comments flagging exactly what to wire up when the real index page
> lands. **Do not treat the banner's "Orientation" target as final.**

The studio header is a themed nav banner built from the existing vector assets
(`nav-chip-9slice.svg` + `chevron-back-32.svg` for the back chip, `mic-wave-32.svg`
wordmark icon, `profile-silhouette-32.svg`), with a visible **WIP badge**. It
links to the placeholder hub today; upgrade the link + remove the WIP badge when
the orientation page is built.

## 8. Implementation phases

| Phase | Scope | Status |
|---|---|---|
| **0** | Repo + Pages skeleton: `site/` Vite project, hub placeholder, studio skeleton, themed WIP nav banner, `.nojekyll`, deploy script + docs | ✅ done (`83e979a`) |
| **1** | Verbatim DSP port under `site/src/` + runtime smoke (`resolveVoiceGraph` → `buildStylizedGraph`; all 8 presets render) | ✅ done (`ef55824`) |
| **2** | Composer UI (accordions, toggles, native sliders, advanced/Fine-tune, Blank/Reset), character chips seed → Custom fork, live summary + filter-graph readout | ✅ done (`094bfe7`) — verified in-browser |
| **3** | Audition: self-hosted single-threaded ffmpeg.wasm, `processAudioWithGraph` (mirrors `process-audio.ts`, incl. aux-IR FS writes), mic One-Time Test + level meter, upload fallback, shared Stop / single player | ✅ done (`e2719cb`) — **audio render/fidelity + round-trip QA confirmed by user (2026-06-28)** |
| **4** | Copy/Paste (`rvn-voice-character-v1`) + localStorage session restore + toasts | ✅ done (`bdde6de`) — round-trip verified in-browser |
| **5** | Polish, a11y, empty states, error toasts — aria labels, `role=meter`, keyboard-native controls, reduced-motion, mic-permission/short-capture/render-fail messaging; self-hosted Chakra Petch **Bold** display face | ✅ done (`0607573`) — font verified live |
| **6** | **Orientation hub content** (3-phase workflow, why-the-demo, links to tutorial + studio, transfer guide) + finalize nav banner (drop WIP) | pending — **user-owned** (the nav banner stays WIP until this index page ships) |
| **7** | Bundled "Tina" sample chips (9-slice, rendered through the active graph) + favicon polish, link from `docs/design-studio.md`, publish + verify on Pages | ◐ sample chips ✅ done (`b33c8b3`) — verified live; remaining: favicon, doc link, publish/verify |
| **8** | Post-MVP (documented only): Web Audio lite mode, A/B, auto re-test, save favorite take, iframe/tab embed | pending |

> **Verification note (2026-06-27):** Phases 1, 2, 4 verified in a headless browser
> (DSP smoke; chip→summary→fork; copy/paste round-trip to `rvn-voice-character-v1`).
> Phase 3 verified as far as headless allows — clean build, lazy-chunked ffmpeg,
> UI mounts, self-hosted core serves (200, ~30 MB). The actual render + audio
> fidelity is the user's deploy-time QA (real mic/upload + ears) — it could not be
> exercised headlessly (Vite dev re-optimize churn + 30 MB wasm > 30 s eval cap).
>
> **Update (2026-06-28):** User confirmed audio render/fidelity and the copy-paste
> round-trip are good ("everything looks and sounds good"). Phase 5 font + Phase 7
> sample chips verified live: 5 chips render (Chakra Petch Bold, 9-slice frame),
> the no-effect branch plays the original clip, the active-effect branch enters the
> render pipeline, console clean. Only **Bold** is shipped (SemiBold dropped — no
> 600-weight tier in use).
>
> **⚠ Auditioning is DEV-only flaky (deferred):** under `vite dev` the audition
> render can freeze at "5%". Root cause: the dev server reloads the page (HMR /
> dependency re-optimization) and aborts the long ~30 MB `ffmpeg.load()`, which
> has no timeout → no fallback. **Production is unaffected** — the build statically
> bundles ffmpeg + the worker and has no reload mechanism. Confirmed 2026-06-28:
> the production build (`npm run preview`, served by the `voice-studio-prod`
> launch config) rendered a sample through the active graph correctly. **QA the
> audition against a build or a deploy, never against `vite dev`.**

## 9. Deploy mechanics (gh-pages root)

1. `cd site && npm install`
2. `npm run build` → `site/dist/` (includes `index.html`, `studio/index.html`,
   `assets/`, `.nojekyll`).
3. Publish `site/dist/**` to the **root** of the `gh-pages` branch
   (`npm run publish:pages`, a git-worktree push — no extra deps).
4. **One-time:** GitHub → Settings → Pages → *Deploy from a branch* →
   **`gh-pages` / `(root)`**.
5. Verify: hub at the root URL, `/studio/` shows the skeleton, no 404s.

## 10. Risks & mitigations

- **~25–30 MB wasm download** → self-host + explain first-load cost; document a
  future Web Audio "lite mode."
- **`getUserMedia` on github.io** → works on modern browsers over HTTPS;
  document the permission prompt.
- **Fidelity drift** → mitigated structurally by the verbatim port (§4); always
  side-by-side test against the extension at the same baseline.
- **Maintenance** → when extension DSP changes, re-copy the 10 files (a script
  can diff/copy); keep the studio pinned to a known baseline commit.

## 11. Success metrics

A new user opens the link, picks a character, tweaks 2–3 controls, runs a mic
test, and hears a transformed voice in < 60 s. JSON round-trips perfectly with
the live extension. No console errors, no storage pollution, works in incognito.
Pages deploy succeeds; URL is clean and shareable.

---

## Resume in a new chat (carry-forward)

- Static **Voice Studio** companion page. Source: **`site/`** (Vite + TS,
  self-contained). Served: Vite `dist/` → **`gh-pages` branch root**; base
  `/reddit-voice-notes-chrome/`. Branch: `feature/static-voice-studio`.
- The "voice brain" is **10 verbatim-copied leaf modules** under `site/src/`
  (mirror extension paths; `@`→`site/`). Fidelity = preview/export both call
  `resolveVoiceGraph` → `buildStylizedGraph(graph, ffmpegRenderer)` and run the
  identical `-af`/`-filter_complex` through ffmpeg.wasm. ConvReverb needs aux-IR
  WAVs written to the FFmpeg FS.
- Copy-paste contract = `rvn-voice-character-v1` (`clipboard-backup.ts`).
- Orientation hub + nav banner are **WIP placeholders** (full hub = Phase 6,
  **user-owned**); search `WIP:` comments. Leave these markers until that index
  page ships.
- **Status (2026-06-28): Phases 0–5 + 7-samples done; audio + round-trip QA
  confirmed.** Next = Phase 6 (Orientation hub, user-owned), then favicon +
  `docs/design-studio.md` link + publish/verify on Pages.
- **Never** modify extension code or touch extension storage. Keep `site/` 100%
  separate.
