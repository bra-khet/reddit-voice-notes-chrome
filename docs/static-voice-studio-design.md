# Hosted Product Surfaces — Current Contract

<!--
CHANGED: Replaced the original static Voice Studio implementation plan with the shipped multi-surface Pages contract.
WHY: The same path is already referenced by demo documentation, while the old phase plan is now archive history.
-->

## Archive Notice (Living Document)

The original Voice Lab design/phase plan is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/static-voice-studio-design.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/static-voice-studio-design.md). The completed full-Studio roadmap is at [`archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-hosted-design-studio.md`](../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-hosted-design-studio.md); milestone context lives in [`HISTORY.md`](HISTORY.md).

## Shipped Pages surface

Source: `demo/`
Base URL: `/reddit-voice-notes-chrome/`

| Route | Product |
|-------|---------|
| `/` | Orientation hub |
| `/design-studio/` | Full hosted Design Studio |
| `/tutorial/` | Interactive Field Guide |
| `/studio/` | Lightweight Voice Lab |

The canonical Field Guide source is documented by [`tutorial/README.md`](tutorial/README.md).

## One-source rule

- Hosted Design Studio imports the extension’s real `src/` through the demo `@` alias.
- Voice Lab imports the real graph, renderer, and clipboard modules.
- No mirrored Studio or DSP implementation may be added under `demo/`.
- Extension and Pages storage are intentionally isolated by browser origin.
- Host differences live in `demo/design-studio/host/`; shared source must not classify itself by protocol/path.

## Hosted Studio host adapter

The Pages host installs a `browser` global shim before shared modules evaluate. Its loopback runtime and in-page pipeline host preserve the existing message contracts while collapsing background/offscreen responsibilities into the page.

Rules:

1. Use `isOwnStorageOrigin()` for storage ownership.
2. Use `browser.runtime.getURL()` for packaged assets.
3. Keep `browser.*` inside functions in shared modules.
4. Do not re-broadcast messages the loopback bus already delivered.
5. A resolved shim message does not prove a background handler committed an artifact; use the shared artifact-commit fallback.
6. Vendor complete FFmpeg/Vosk asset trees.
7. Keep root and demo TypeScript projects separate.
8. Gate every demo build with host-neutrality checks and zero-error TypeScript.

The exact seam inventory is in [`architecture/extension-points.md`](architecture/extension-points.md).

## Voice Lab fidelity

Voice Lab and the extension share:

- `resolveVoiceGraph`;
- `buildStylizedGraph(graph, ffmpegRenderer)`;
- the `rvn-voice-character-v1` clipboard envelope;
- auxiliary IR generation and FFmpeg execution rules.

Audition QA must use `npm run build && npm run preview` or a deployed build. Vite dev/HMR can interrupt the large FFmpeg load and is not a fidelity gate.

## Build and deploy

```bash
cd demo
npm install
npm run build
npm run preview
```

`.github/workflows/deploy-demo.yml` builds and publishes `demo/dist/` to GitHub Pages on relevant `main` changes. There is no `gh-pages` worktree flow.

Before publishing:

- verify all four routes under the configured base;
- check asset content types, not only HTTP 200;
- run host-neutrality, TypeScript, and Vite build gates;
- test one record/export on hosted Studio and one Voice Lab audition/profile round-trip;
- review the hub when route descriptions change.

## Boundaries

- Hosted Studio is another host, not a seventh extension execution context.
- Pages data does not sync automatically with extension data.
- Voice Lab remains the light voice-only surface; full capture/polish belongs to `/design-studio/`.
- The Field Guide HTML remains single-source at `demo/public/tutorial/index.html`.
