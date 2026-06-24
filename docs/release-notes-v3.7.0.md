# Release notes — v3.7.0 (Design Studio v4 UI shell)

**Tag:** `v3.7.0` · **Branch:** `eloquent` · **Date:** 2026-06-23  
**Restore:** `git checkout v3.7.0 && npm install && npm run dev`  
**Prior stable:** `v3.6.0` (subtitle pipeline; legacy `<details>` Studio layout)

## Summary

v3.7.0 ships the **Design Studio v4 UI shell** on top of the v3.6 subtitle + profile stack. No pipeline, storage, or WASM contract changes. Reddit recorder gains a persistent **Go here first → Open Design Studio** CTA.

## Design Studio (`.studio-v4`)

| Area | Shipped |
|------|---------|
| **Layout** | Hero row (preview + profile/status) + 1×4 status card strip; narrow stack profile-above-preview |
| **Sub-panels** | Card tap → section shell (back, title, Done) + unified dirty exit guard |
| **Profile status** | Subtitles? + Ready? rows with guidance hints |
| **Live preview** | WYSIWYG canvas + mask-cutout bezel frame (628×348 artboard; shared box + clip-path) |
| **Chrome** | 9-slice panels, centered nav chips, negation back chip, CVD palette (`studio-v4-buttons.css`) |
| **Exit flows** | v4 guard button order: cancel left · discard middle · confirm right |

## Reddit recorder

- **Go here first** amber callout + violet **Open Design Studio** — visible from panel open (not post-record only).

## Deferred (non-blocking)

- Sub-panel knob/slider SVG integration in control bodies
- Main header Done button asset refresh
- In-Studio recording (§13.2)
- Segment-aware canvas preview polish (eloquent-4b remainder)

## Build

```bash
npm run build && npm run zip
# → .output/reddit-voice-notes-3.7.0-chrome.zip
```

## Docs

Canonical semantics: `docs/design-studio.md` §2, §10. Sprint arc: `claude-progress.md` § v3.7.0.