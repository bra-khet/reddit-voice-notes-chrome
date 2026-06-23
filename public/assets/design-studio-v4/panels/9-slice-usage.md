# 9-Slice Scaling for Panel Frames

## Base
Use `panel-frame-9slice.svg` (viewBox 0 0 100 100, 10-unit border).

## CSS
```css
.my-panel {
  border-image: url('panel-frame-9slice.svg') 10 10 10 10 fill;
  border-width: 10px;  /* matches slice */
  /* For preview wide: larger height/width on container */
  width: 100%;
  height: 200px; /* adjust */
}
```

## Why
Corners stay crisp (pseudo-3D bevels intact). Edges stretch. Gradients % scale lighting.

## For Different Panels
- Preview: wide container + same frame image.
- Status panels: square or custom aspect.
- Profile: compact.

Build symmetrically, % everywhere as done.

See vector-ui-assets-spec.md for full.