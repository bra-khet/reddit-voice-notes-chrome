# Design Studio v4 Vector Assets

Test assets generated from voice notes (legacy UI) + feature-set analysis.

## Quick Start
- Open any `.svg` directly in a browser tab or vector editor.
- All files use generous `viewBox` values so they scale cleanly with CSS `width`/`height`.
- Theme colors are currently set to reference values. Replace hard-coded `#ffd54f` etc. with `currentColor` or CSS custom properties in production.

## Key Signature Assets (from your notes)
- `knobs/knob-radial-speedometer-decal.svg` — radial glowing intensity lines (backlight)
- `sliders/physical-slider-track.svg` + `physical-slider-tab.svg` — wide analog tab + feathered glowing track edges to black center
- `chrome/position-3x3-grid.svg` — background / alignment position widget

## Catalog

See **`CATALOG.md`** for the full file index. TypeScript paths: `src/ui/design-studio/studio-v4-assets.ts`.

## Panel Windows & Status (from ASCII layout + notes, 2026-06-23)
- `panels/panel-frame-9slice.svg` (square base for CSS border-image 9-slice)
- `panels/preview-window-frame.svg`, `status-panel-frame.svg`, `profile-status-frame.svg`
- `displays/amber-futuristic-segmented.svg` (clean sharp futuristic amber with glow)
- `icons/` 24-32px silhouettes (waveform, mic, captions, frames)
- `status/` indicators (LED, check, warning)
- `srt/` editor (segment-block, timeline, playhead, timecode)

Follow 9-slice: square symmetric SVG, % gradients, border-image in CSS for non-distorting corners on resize. All pseudo-3D pillowed to match buttons/sliders.

## Theming
```css
/* Example */
.knob-decal {
  --theme-color: #ffd54f;
}
.knob-decal .glow-line { stroke: var(--theme-color); }
```

See `../docs/vector-ui-assets-spec.md` for the full breakdown (vector vs CSS, handoff items, layering techniques).

## Colors (reference)
- Dark indigo: `#12001f`
- Accent dark: `#1d1f6e`
- Amber bright: `#ffd54f`

Make small tasteful variations as needed.

All SVGs are committed as the single source of truth for the vector work.

## Important: Comments for GIMP Compatibility
When creating or editing SVG assets intended to be opened/imported in GIMP:
- Use legacy CSS-style `/* ... */` comments for header/documentation blocks.
- Place them **inside** the `<svg>` ... `</svg>` tags (right after the opening `<svg>` element).
- Avoid (or minimize) XML-style `<!-- ... -->` comments, especially any containing double hyphens (`--`), such as CSS custom properties like `var(--theme-color)`.
- GIMP's SVG parser (older/strict) can fail to parse comments with `--` sequences inside `<!-- -->`.

Both principles must be followed: CSS-style `/* */` + inside the SVG root tags.

All assets in this folder have been updated to follow this convention (as of 2026-06-23). Follow this from now on for GIMP work.
