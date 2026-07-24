> **Archive provenance:** Archived after the v6.0.0 stable checkpoint — 2026-07-23.
> Original living path: `docs/design-studio-v4/vector-ui-assets-spec.md`.
> Preserved as Design Studio v4 asset history; current Studio canon lives in `docs/design-studio.md`.

# Design Studio v4 — Vector UI Assets Specification

**Date**: 2026-06-23  
**Source**: Analysis of `voicenotes-legacyUI-notes.md` (legacy UI notes) + cross-reference with `references/design-studio-feature-set.md` and known control implementations (`radial-knob.ts`, `background-layout-controls.ts`, etc.).

**Goal**: Provide a collection of scalable, layered, depth-rich vector (SVG) test assets for the four main panels (Bar Style, Background, Voice, Subtitles) plus profile chrome. Focus on knobs, sliders, "chrome" (dropdowns, buttons, toggles), alignment/position widgets, and decorative decals that give the UI a premium physical/analog feel while supporting the dark-indigo + bright-purple/amber theme.

All assets are intended to be dropped into the v4 redesign (likely 2x2 or 3x2 grid of panels under a 16:9 preview + profile bar). They must support theming via the user's current `barColor` / design overrides (bright indigo/purple/amber variations).

## 1. Asset Inventory by Panel (Inferred from Notes)

### BAR STYLE
- Dropdown: style name (preset or custom)
- Dropdown: alignment (future: spacing)
- Dropdown: effects / visual flare (promote near top)
- **Knobs**: Hue (color wheel style), Saturation (0-100 volume-knob style), Brightness (0-100 volume-knob style)
- Buttons (3): Update/Save (bright indigo/purple), Clone/Copy (amber), Cancel/Delete (charcoal/cool gray) — reverse legacy order
- Chrome: panel frame, section dividers

### BACKGROUND
- Main dropdown + small pop-up preview thumbnail
- Controls for alignment, sizing (fit/fill), fill behavior
- **Position widget**: 3x3 grid (or draggable frame + buttons) emulating current image position control. Small buttons + frame chrome
- Chrome: layout preview frame

### VOICE
- Defeat toggle (on/off for effects)
- Dropdowns/toggles for preset profiles (future extensibility)
- **Knob**: Pitch (future additional: noise-cancel etc.)
- **Slider**: Intensity (0-10 or 0-100) + "turbo" toggle
- Chrome: panel header, defeat affordance

### SUBTITLES
- Dropdown: alignment (top / center / bottom)
- Slider: font size
- Dropdown: text color (grouped with size)
- Subsection: glow (dropdowns + defeatable toggle + intensity slider)
- Slider: backdrop plate opacity (with defeat toggle)
- Future: more custom style features

**Cross-cutting**:
- Radial / analog "speedometer" decals behind knobs (glowing theme-color intensity lines radiating outward — backlight effect)
- Physical-style sliders (wide analog tab + glowing track)
- General chrome: layered depth, bevels, inset frames, tick marks/housings
- Small buttons, dropdown arrows, toggle switches

## 2. Color & Theme Reference (from Notes + Prior)

- Dark indigo / backdrop: `#12001f`
- Accented dark / panels: `#1d1f6e`
- Bright indicators / amber (ticks, active glows, highlights): `#ffd54f`
- User theme colors will override (barColor drives glow + accents). Provide amber as hard-coded fallback for non-themed ticks.
- Allow small variations (e.g. slightly desaturated amber, deeper indigo for layers).

Use `currentColor` + CSS custom properties (`--theme-color`, `--theme-glow`) for runtime theming. Provide example classes.

## 3. Vector Graphics Scope — What We Are Producing Here

All files are standalone `.svg` (viewBox-based, no external dependencies). Optimized for embedding (`<img>`, inline, or `<svg><use>`), easy CSS override, and future Svelte/Vue components.

**Produced in this pass** (see `vector-assets/`):
- Knobs + housings + tick marks + radial speedometer glow decals
- Physical analog sliders (tab + track with edge glow + feathered black mask)
- Buttons (3 semantic variants with depth)
- Defeat toggle
- Dropdown trigger / menu affordance
- 3x3 position / alignment grid widget
- Common decals, frames, and glow templates
- Example composite test pieces (e.g. knob + decal assembly)

## 4. Vector vs. CSS / Styling Breakdown

| Component                  | Pure Vector (SVG)                          | Best as CSS / Combo                          | Handoff Needed from User                          |
|----------------------------|--------------------------------------------|----------------------------------------------|---------------------------------------------------|
| Knob base / housing        | Yes (circles, rings, bevel gradients)     | Subtle inner shadow / bevel via CSS filter  | Exact outer/inner radii, bevel height in px      |
| Tick marks (knob)          | Yes ( `<line>` or `<path>` at angles, amber ) | Color via `currentColor` or CSS var         | Count (e.g. 12 or 24), major/minor distinction   |
| Radial speedometer decal   | Yes (multiple rotated `<line>` + groups for intensity steps) + optional `<filter id="glow">` | Dynamic intensity (opacity / blur amount driven by value) via CSS classes or inline style. Real radial conic glow easier in CSS `conic-gradient` + mask for some effects | Intensity step count, max blur radius, whether lines should be dashed or solid |
| Knob indicator / needle    | Yes (triangle or line + cap)              | Glow on active value                        | Length, thickness, whether it has its own mini glow |
| Physical slider tab        | Yes (wide rounded rect + inner center glow area as separate `<rect>`/group) | Center faint glow + highlight via CSS       | Tab width/height ratio, corner radius, "physical" bevel amount |
| Slider track               | Yes (outer hard edge + inner gradient path or masked rect for "light bleeding" theme edges → black center) | Feathering / soft mask can be enhanced with CSS `mask-image` or multiple box-shadows | Track height, gap width, amount of feather (px)  |
| Dropdown                   | Yes (box + arrow + depth layers)          | Open state, hover, focus rings, preview thumbnail background | Arrow style (chevron vs triangle), preview size  |
| Buttons (Update/Clone/Delete) | Yes (rounded rect + gradient fills + strokes for layered depth) | Hover lift, active press, focus             | Padding, font metrics, shadow depth values       |
| Defeat toggle              | Yes (track + thumb with slight 3D)        | State transitions + glow on "on"            | Thumb size vs track, "on" color treatment        |
| 3x3 position grid          | Yes (9 cells + active highlight frame)    | Hover / drag feedback                       | Cell size, gutter, active indicator style        |
| Backlight / panel decals   | Yes (radial lines, soft offset duplicates) | Full variable glow intensity + theme tint at runtime best in CSS | Whether decal should be behind or clipped to panel |
| Complex real-time lighting | Limited (static gradients + filters)      | Strongly preferred: CSS custom properties + `filter: drop-shadow()`, `box-shadow`, pseudo-elements for bleeding glows | Any reference screenshots or GIMP layer groups showing exact light direction |

**Recommendation**: 
- Use SVG for **structure, proportions, tick geometry, tab shape, track profile**.
- Use CSS for **theming (color application), glow intensity response to value, hover/active depth, feathering that needs to animate**.
- Hybrid is ideal and encouraged. SVG can export groups like `<g id="glow-lines" class="theme-glow">` and `<g id="bevel">`.

Many "physical" effects (edge bleed, center faint glow) can be approximated very convincingly in SVG with:
- Multiple concentric / offset shapes
- Linear / radial gradients (theme color stops to transparent/black)
- Light `<filter>` gaussian blurs (note: filters have perf cost when many instances)
- Or leave the feathering to the consuming element's CSS `box-shadow` / `filter` while SVG provides the hard geometric mask.

## 5. Layering & Depth Techniques (for "more than just prompted" look)

- **Bevel / inset**: 2-3 strokes (dark outer, light inner highlight) + subtle gradient fill (dark indigo → slightly lighter mid-tone).
- **Glow layers**: Duplicate the important geometry at low opacity + larger stroke or `<feGaussianBlur>`, tinted with theme color.
- **Physical tab**: Outer dark ring + main fill + inner lighter "catch light" thin strip + center semi-transparent theme glow rect (low opacity).
- **Track glow bleed**: Outer hard stroke in theme (thin), slightly inset wider rect with gradient (theme at edges → black in center). Can use `<mask>` for extra softness.
- **Radial speedo**: 12–24 `<line>` elements rotated via `<g transform>`. Group into "low / med / high" intensity subsets. Add a very soft larger blurred duplicate behind everything for backlight.
- **Overall panel chrome**: Provide inset frame SVG that can be used as background or overlay with `opacity` and `mix-blend-mode` in CSS for extra polish.

Keep IDs and classes semantic so they can be targeted:
```svg
<g id="knob-glow" class="theme-glow intensity-3">...</g>
```

## 6. What You Need to Hand Off (for Refinement)

- **Measurements**: Preferred final rendered sizes (e.g. knob 64px diameter, slider track 200px wide × 12px tall, tab 28px wide). Current test assets use 100–200 unit viewBox for flexibility — scale via CSS or width/height attrs.
- **Exact top-of-panel padding**: How many px from the rounded black panel's inner top border should the knob/slider header title area sit? (Used to decide "comfortable" y offset for text + control.)
- **GIMP / raster references**: The current black placeholder panels + any existing knob/slider sketches. Especially useful for:
  - Exact curvature of rounded rects
  - How much the current "faint" titles sit inside vs. on the border
  - Any complex texture or noise you want emulated (we can approximate with SVG patterns or leave to CSS noise filters)
- **Dynamic behavior**: Max intensity steps for radial lines? Should glow lines be longer / brighter / more of them as value increases?
- **CSS target**: Will these live in Shadow DOM? Any existing CSS var names for `--bar-color`, `--glow-color`?
- **Performance note**: If many instances (e.g. 4 knobs + sliders per panel), prefer CSS shadows over heavy SVG filters.
- **Non-vector pieces**: If you want true 3D bevels, photographed metal, or very soft organic glows that change with live canvas preview, those can be small PNG/WebP overlays or CSS `backdrop-filter` + gradients. Provide the source raster and I can generate the companion assets.

## 7. File Organization

```
design-studio-v4/vector-assets/
├── knobs/
│   ├── knob-housing.svg
│   ├── knob-ticks-amber.svg
│   ├── knob-radial-speedometer-decal.svg   # the glowing backlight lines
│   └── volume-knob.svg
├── sliders/
│   ├── physical-slider-track.svg
│   └── physical-slider-tab.svg
├── buttons/
│   ├── button-update.svg
│   ├── button-clone.svg
│   └── button-delete.svg
├── chrome/
│   ├── dropdown.svg
│   ├── defeat-toggle.svg
│   └── position-3x3-grid.svg
├── decals/
│   └── panel-backlight-radial.svg
├── common/
│   └── theme-glow-template.svg
└── README.md   # quick usage + theming examples
```

(Also created a companion spec here: `docs/vector-ui-assets-spec.md`)

## 8. Next Steps & Variations

1. Open the SVGs directly in browser or Inkscape to inspect structure.
2. In the web UI, embed and override colors:
   ```css
   .my-knob { --theme-color: #ffd54f; }
   .my-knob .theme-glow { filter: drop-shadow(0 0 6px var(--theme-color)); }
   ```
3. Provide feedback on proportions / which ones feel "too flat" vs. "too busy".
4. Future passes can add:
   - More intensity variants of the radial decal
   - Animated versions (SMIL or just document the CSS keyframes)
   - Hover / active state variants
   - Mini preview thumbnail chrome for the Background dropdown
   - Refined 9-point grid with drag handle affordance

These assets are starting points — the notes emphasize wanting things that feel hand-crafted with layered depth rather than generic prompt output. The physical slider and radial speedometer decals are the highest-priority "signature" elements from your voice notes.

If you open any SVG and want a specific tweak (more lines, different feather stops, adjusted padding for the header area, etc.) just describe it and I'll iterate directly on the files.

## GIMP SVG Comment Compatibility (Added 2026-06-23)
All vector assets have been updated to use legacy CSS-style `/* ... */` comments for their header documentation blocks.

**Correct rule for this project (GIMP work):** 
- Use CSS-style `/* ... */` comments (the slash-star style).
- Place them **inside** the `<svg>` ... `</svg>` tags (immediately after the opening `<svg>` tag).
- Avoid XML-style `<!-- ... -->` comments that contain `--` sequences (e.g. `var(--theme-color)` or other double hyphens).
- GIMP's SVG parser is old/strict and fails on double hyphens inside XML comments.

Both design principles must be accounted for: CSS comment style + inside the SVG root element.

See `vector-assets/README.md` for the full note and enforcement. Follow this going forward when authoring SVGs for GIMP import or editing.

## Additional Assets from ASCII Layout + SRT Editor (2026-06-23 update)
From ASCII-panel-layout-plusnotes.txt and design docs:
- Hero row: Live Preview (16:9) + Profile Status (with small status box/avatar area)
- Bottom row status panels (chrome + clean indicators only, no full controls): BARSTYLE, BACKGRND, VOICE, SUBTITLE
- SRT subtitles editor extras in subtitles panel: segment blocks, timeline, playhead, timecodes.

### New Assets Created
- `panels/panel-frame-9slice.svg` — Square base (viewBox 0 0 100 100), 10-unit border for CSS border-image 9-slice. Pseudo-3D pillowed. **Use border-image for scaling** (see below).
- `panels/preview-window-frame.svg` — Wide hero preview container (16:9).
- `panels/status-panel-frame.svg` — Reusable for 4 bottom status panels (header for title + content for indicators).
- `panels/profile-status-frame.svg` — Compact for PROFILE STATUS.
- `displays/amber-futuristic-segmented.svg` — Clean sharp futuristic (not retro) amber segments with glow for timecodes/status/numbers. Sharp polygonal segments, layered glow.
- `icons/*.svg` (waveform-bars-32.svg, mic-wave-32.svg, caption-lines-32.svg, frame-icon-32.svg) — 24-32px silhouettes.
- `status/*.svg` — status-indicator (LED), complete-check, warning-indicator.
- `srt/segment-block.svg`, `timeline-ruler.svg`, `playhead.svg`, `timecode-display.svg` — SRT editor chrome (time + text areas, playhead, ruler with ticks).

### 9-Slice Scaling for Panel Windows
Critical for dynamic sizing (per external advice):
- Base SVG is symmetric square (viewBox="0 0 100 100") with defined border thickness (10 units).
- CSS: `border-image: url('panel-frame-9slice.svg') 10 10 10 10 fill; border-width: 10px;`
- Gradients use % (x1="0%" etc.) for scalable lighting.
- Corners fixed, only edges stretch.
- Use for all panel frames to keep pseudo-3D intact on resize.
- Proportional: size container differently (e.g. preview wide, status compact).

### Inferred Missing Assets Covered
- Panel primitives/frames (as recommended in feature-set.md)
- Status chrome/indicators for panels (LEDs, checks, warnings, progress hints)
- Subtitles/SRT specific (segments, timeline, timecodes using segments)
- Small silhouettes per ASCII
- Segmented displays (amber glow, futuristic sharp clean style)
- Followed pillowing/bordering/pseudo-3D from buttons/sliders (layered rects, gradients, highlights, rx for round, amber glows).

Update vector-ui-assets-spec.md and README as needed. All new assets in matching style, with /* */ comments inside <svg>, % gradients.

Commit changes.
