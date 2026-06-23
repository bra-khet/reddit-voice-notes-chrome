# Design Studio v4 — Asset catalog

Runtime base: `/assets/design-studio-v4/`  
Palette tokens: `entrypoints/design-studio/studio-palette.css`

## Layout shell (9-slice)

| File | Slice | Use |
|------|-------|-----|
| `panels/panel-frame-9slice.svg` | 10 | Cards, sub-panels, general surfaces |
| `panels/preview-window-frame.svg` | — | Hero 16:9 preview (fixed aspect) |
| `panels/profile-status-frame.svg` | — | Profile + status cluster |
| `panels/status-panel-frame.svg` | — | Four section status cards |
| `panels/card-footer-9slice.svg` | 8 12 8 12 | Card enter rail + chevron zone |
| `panels/subpanel-header-9slice.svg` | 10 14 10 14 | Sub-panel title + back zone |
| `panels/nav-chip-9slice.svg` | 10 | Icon-only enter/back chips |
| `panels/dialog-frame-9slice.svg` | 10 | Exit guard / bake unsaved modals |
| `buttons/button-frame-9slice.svg` | 8 | Scalable labeled buttons (HTML text inside) |

See `panels/9-slice-usage.md` for CSS recipes.

## Icons

| Path | Size | Role |
|------|------|------|
| `icons/waveform-bars-32.svg` | 32 | Bar style card |
| `icons/frame-icon-32.svg` | 32 | Background card |
| `icons/mic-wave-32.svg` | 32 | Voice card |
| `icons/caption-lines-32.svg` | 32 | Subtitles card |
| `icons/section-16/*` | 16 | Narrow stack variants |
| `icons/navigation/chevron-enter-32.svg` | 32 | Open sub-panel |
| `icons/navigation/chevron-enter-16.svg` | 16 | Open (narrow) |
| `icons/navigation/chevron-back-32.svg` | 32 | Sub-panel back |
| `icons/navigation/chevron-back-16.svg` | 16 | Back (narrow) |
| `icons/navigation/profile-silhouette-32.svg` | 32 | Profile cluster |
| `icons/navigation/profile-silhouette-16.svg` | 16 | Profile (narrow) |

## Status semantics (always pair with text)

| File | Meaning |
|------|---------|
| `status/status-indicator.svg` | Active / generic LED (amber) |
| `status/pending-indicator.svg` | In progress (cyan) |
| `status/warning-indicator.svg` | Needs attention (amber triangle) |
| `status/complete-check.svg` | Ready / saved (check) |
| `status/info-indicator.svg` | Neutral guidance (cyan i) |

## Buttons (fixed chrome + label baked)

| File | Semantic |
|------|----------|
| `buttons/button-update.svg` | Save / Update profile or style |
| `buttons/button-clone.svg` | Clone / Save to new |
| `buttons/button-delete.svg` | Delete |
| `buttons/button-done.svg` | Done / primary exit |
| `buttons/button-cancel.svg` | Cancel / discard prompt |

Prefer `button-frame-9slice.svg` + HTML text when label length varies.

## Controls (sub-panel polish)

| Folder | Contents |
|--------|----------|
| `knobs/` | housing, ticks, needle, radial decal, `volume-knob.svg` assembly |
| `sliders/` | physical track + tab |
| `chrome/` | dropdown, defeat toggle, 3×3 grid, bg thumbnail |

## Deprecated

- `displays/amber-futuristic-segmented.svg`
- `srt/timeline-ruler.svg`, `playhead.svg`, `segment-block.svg` (optional only)

## Theming

```css
.studio-v4-chrome {
  --theme-color: var(--studio-amber);
  --theme-glow: var(--studio-amber);
}
```

Import palette in `main.ts` before `style.css`.