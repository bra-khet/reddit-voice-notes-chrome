# Hosted product surfaces (`demo/`)

<!--
CHANGED: Document demo/ as the complete Pages product, not only the original lightweight voice demo.
WHY: The directory now owns the orientation hub, hosted Design Studio, Field Guide, and Voice Lab.
-->

The GitHub Pages build now contains four install-free surfaces:

- `/` — orientation hub
- `/design-studio/` — the full hosted Design Studio
- `/tutorial/` — the interactive Field Guide
- `/studio/` — Voice Lab, the lightweight voice-only surface

The hosted Studio reuses the extension's real source through a small browser-host shim; it does not
fork the product UI or DSP. Browser-origin storage remains separate from extension-origin storage.
Voice Lab still round-trips voice profiles with the extension through copy/paste.

> **Status: Track D complete and merged.** Hosted record → style → caption → timeline edit → bake →
> download passed real Pages QA. The orientation hub and Field Guide are live surfaces, not placeholders.
> Package/release versioning remains owned by the repository root release sprint.

## Run locally

```bash
cd demo
npm install
npm run dev        # http://localhost:5173/reddit-voice-notes-chrome/
```

- Hub:    `…/reddit-voice-notes-chrome/`
- Design Studio: `…/reddit-voice-notes-chrome/design-studio/`
- Field Guide: `…/reddit-voice-notes-chrome/tutorial/`
- Voice Lab: `…/reddit-voice-notes-chrome/studio/`

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

- **`vite.config.ts`** — multi-page (hub + Design Studio + Voice Lab),
  `base: '/reddit-voice-notes-chrome/'`, and the key alias **`@` → the repo root**.
- **The voice "brain" is the extension's own source — no longer a copy.** Since
  Track D Phase 0 (2026-07-22) the `@` alias points one level up, so
  `@/src/voice/types` resolves to the extension's real `src/voice/types.ts`.
  There is nothing to re-sync after a DSP change, and drift is impossible rather
  than merely discouraged. The 12 modules that used to live under `demo/src/voice`
  and `demo/src/settings` were verified byte-identical before deletion.
  **Consequence:** an extension change can now break this build, which is why the
  Pages workflow also watches `src/**`. See the living hosted-surface contract at
  `docs/static-voice-studio-design.md`; the completed Track D roadmap is indexed by
  `archive/docs/MANIFEST.md`.
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
- **Voice Lab navigation** (`src/studio/nav-banner.ts`) returns to the shipped Orientation hub.

### Working on a Pages surface

Start from `docs/static-voice-studio-design.md` for both hosted product surfaces or
`docs/tutorial/README.md` for Field Guide source ownership. QA the deployable build with
`npm run build && npm run preview`, never `vite dev`.
