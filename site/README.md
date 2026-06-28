# Static Voice Studio (`site/`)

A **static, install-free** GitHub Pages companion for
[reddit-voice-notes-chrome](../). It replicates the Design Studio's **Voice
panel** (character chips, composer, intensity/Turbo, audition) and round-trips
voices with the live extension via copy-paste.

It is **100% separate from the extension**: its own Vite build, its own origin,
no shared storage, and it never modifies extension code — it *reuses* the
extension's pure voice DSP modules. Full spec: [`../docs/static-voice-studio-design.md`](../docs/static-voice-studio-design.md).

> **Status: Phase 0** — skeleton, themed (WIP) navigation, and the deploy
> pipeline. The voice authoring surface is built in Phases 1–5.

## Run locally

```bash
cd site
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

## Deploy (GitHub Pages, gh-pages branch root)

```bash
npm run build
npm run publish:pages   # pushes ./dist to the ROOT of the gh-pages branch (git worktree, no extra deps)
```

**One-time setup:** GitHub → *Settings → Pages → Deploy from a branch* →
**`gh-pages` / `(root)`**. The extension's `main` branch root stays pristine;
nothing built is committed there.

## How it's wired (for the next developer)

- **`vite.config.ts`** — multi-page (`index.html` hub + `studio/index.html`),
  `base: '/reddit-voice-notes-chrome/'`, and the key alias **`@` → `site/`**.
- **The voice "brain" is a verbatim port.** The 10 pure-data/string-emitter leaf
  modules from the extension are copied **unchanged** under `site/src/` mirroring
  their original paths; the `@` alias makes even `@/src/voice/types` imports
  resolve. Re-syncing after an extension DSP change is a file copy. (Added in
  Phase 1 — see the design doc §4.)
- **Fidelity = preview/export call the same code:** `resolveVoiceGraph` →
  `buildStylizedGraph(graph, ffmpegRenderer)` → the identical
  `-af` / `-filter_complex` run through ffmpeg.wasm (Phase 3).
- **Copy-paste contract:** `rvn-voice-character-v1` (the ported
  `clipboard-backup.ts`) — round-trips losslessly with the extension.
- **Navigation banner is WIP** (`src/studio/nav-banner.ts`): it anticipates a
  future Orientation index page (Phase 6). Search the repo for `WIP:` to find
  everything that should be revisited when that page ships.

### Prompting the next phase

> "Continue the static voice studio at `site/` (Vite + TS, branch
> `feature/static-voice-studio`). Read `docs/static-voice-studio-design.md`, then
> do **Phase N**: <scope>. Keep `site/` 100% separate from the extension; never
> modify extension code or touch extension storage."
