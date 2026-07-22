# Voice Lab (`demo/`)

A **static, install-free** GitHub Pages companion for
[reddit-voice-notes-chrome](../). It replicates the Design Studio's **Voice
panel** (character chips, composer, intensity/Turbo, audition) and round-trips
voices with the live extension via copy-paste.

It is **100% separate from the extension**: its own Vite build, its own origin,
no shared storage, and it never modifies extension code — it *reuses* the
extension's pure voice DSP modules. Full spec: [`../docs/static-voice-studio-design.md`](../docs/static-voice-studio-design.md).

> **Status: Phases 0–5 + 7 done; audio QA confirmed.** Verbatim DSP port, full
> composer + voice panel (chips, intensity/Turbo, fork-to-custom, live summary +
> filter-graph readout), audition via self-hosted ffmpeg.wasm (bundled "Tina"
> sample chips + mic test + upload), copy/paste transfer + session restore, and
> the self-hosted Chakra Petch display face (Phase 5). Render fidelity and the
> copy-paste round-trip are hands-on verified. **Remaining: Phase 6 — the
> Orientation index/hub content** (still a placeholder; the nav banner's `WIP:`
> markers retire when it ships).

## Run locally

```bash
cd demo
npm install
npm run dev        # http://localhost:5173/reddit-voice-notes-chrome/
```

- Hub:    `…/reddit-voice-notes-chrome/`
- Studio: `…/reddit-voice-notes-chrome/studio/`

## Build & preview

```bash
npm run build      # tsc --noEmit + vite build → ./dist
npm run preview    # serve ./dist exactly as it will deploy
```

> **Audition QA must use a build, not `vite dev`.** Under the dev server the
> audition render can freeze at "5%" (HMR/dep re-optimization reloads the page
> and aborts the ~30 MB `ffmpeg.load()`). Use `npm run preview` or a real deploy.
> See `vite.config.ts` for the full note.

## Deploy (automatic, GitHub Pages via Actions)

There is **nothing to run by hand.** On every push to `main` that touches
`demo/`, the workflow [`.github/workflows/deploy-demo.yml`](../.github/workflows/deploy-demo.yml)
builds `demo/dist/` and publishes it straight to GitHub Pages — **no `gh-pages`
branch, no publish script.**

**One-time setup:** GitHub → *Settings → Pages → Build and deployment → Source*
→ **GitHub Actions**.

## How it's wired (for the next developer)

- **`vite.config.ts`** — multi-page (`index.html` hub + `studio/index.html`),
  `base: '/reddit-voice-notes-chrome/'`, and the key alias **`@` → the repo root**.
- **The voice "brain" is the extension's own source — no longer a copy.** Since
  Track D Phase 0 (2026-07-22) the `@` alias points one level up, so
  `@/src/voice/types` resolves to the extension's real `src/voice/types.ts`.
  There is nothing to re-sync after a DSP change, and drift is impossible rather
  than merely discouraged. The 12 modules that used to live under `demo/src/voice`
  and `demo/src/settings` were verified byte-identical before deletion.
  **Consequence:** an extension change can now break this build, which is why the
  Pages workflow also watches `src/**`. (See `docs/v6.0.0-hosted-design-studio.md` §3.4.)
- **Fidelity = preview/export call the same code:** `resolveVoiceGraph` →
  `buildStylizedGraph(graph, ffmpegRenderer)` → the identical
  `-af` / `-filter_complex` run through ffmpeg.wasm.
- **Copy-paste contract:** `rvn-voice-character-v1` (the extension's own
  `src/settings/clipboard-backup.ts`, imported directly) — round-trips losslessly
  with the extension because it is literally the same module.
- **Sample chips (Phase 7):** `public/assets/samples/*.mp3` ("Tina" reading the
  sources in that folder's `README.md`). `src/studio/audition.ts` renders a
  clicked clip through the active graph, or plays it raw when no effect is on.
- **Display font:** Chakra Petch **Bold only**, self-hosted in
  `src/styles/fonts.css` from `src/assets/fonts/` (Vite-processed → base-correct).
- **Navigation banner is WIP** (`src/studio/nav-banner.ts`): it anticipates a
  future Orientation index page (Phase 6). Search the repo for `WIP:` to find
  everything that should be revisited when that page ships.

### Prompting the next phase

> "Continue the static voice studio at `demo/` (Vite + TS, now on `main`). Read
> `docs/static-voice-studio-design.md`, then do **Phase N**: <scope>. Keep
> `demo/` 100% separate from the extension; never modify extension code or touch
> extension storage."
