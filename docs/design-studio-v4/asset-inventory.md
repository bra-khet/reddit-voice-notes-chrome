# Design Studio v4 — Asset inventory

**Status:** Complete + **wired in v3.7.0** (2026-06-23)
**Runtime:** `public/assets/design-studio-v4/` · **Catalog:** `CATALOG.md`  
**TS index:** `src/ui/design-studio/studio-v4-assets.ts`  
**CSS:** `studio-palette.css`, `studio-v4-chrome.css`

## MVP verdict: **shipped (v3.7.0)**

All P1/P2 gaps closed. Runtime shell uses asset-based 9-slice chrome. Hero bezel: `panels/preview-window-frame.svg` (628×348 mask-cutout); rollback: `preview-window-frame.legacy.svg`. Negation chip: `nav-chip-negate-9slice.svg`.

## Navigation & status (added)

| Asset | Path |
|-------|------|
| Enter chevron | `icons/navigation/chevron-enter-32.svg`, `chevron-enter-16.svg` |
| Back chevron | `icons/navigation/chevron-back-32.svg`, `chevron-back-16.svg` |
| Profile silhouette | `icons/navigation/profile-silhouette-32.svg`, `profile-silhouette-16.svg` |
| Pending (cyan) | `status/pending-indicator.svg` |
| Info (guidance) | `status/info-indicator.svg` |
| Done / Cancel | `buttons/button-done.svg`, `button-cancel.svg` |

## 9-slice chrome (added)

| Asset | Path |
|-------|------|
| Button frame | `buttons/button-frame-9slice.svg` |
| Nav chip | `panels/nav-chip-9slice.svg` |
| Card footer rail | `panels/card-footer-9slice.svg` |
| Sub-panel header | `panels/subpanel-header-9slice.svg` |
| Dialog / modal | `panels/dialog-frame-9slice.svg` |

## Section icons 16px (added)

`icons/section-16/` — bar, background, voice, subtitles

## Knobs (added)

`knobs/knob-needle.svg`, `knobs/volume-knob.svg` (assembly reference)

## Deprecated — do not use

| Asset | Reason |
|-------|--------|
| `displays/amber-futuristic-segmented.svg` | Legacy WIP, poor contrast |
| `srt/timeline-ruler.svg`, `playhead.svg`, `segment-block.svg` | Not in product model |

## Nice to have (post-MVP)

- Hover / pressed SVG states for buttons and toggles
- Revised segmented display (indigo field + amber glyphs)
- `knob-radial-speedometer-decal` intensity step variants

## Fallback tags

| Tag | Meaning |
|-----|---------|
| `v3.6.0` | Last stable Studio behavior (pre-refresh) |
| `v3.6.0-pre-ui-refresh` | Design docs + initial asset import |
| `v3.6.0-ui-assets-ready` | Full v4 asset set + TS/CSS wiring |