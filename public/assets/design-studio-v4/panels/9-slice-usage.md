# 9-Slice scaling guide

Resolve URLs with `studioV4AssetUrl()` from `src/ui/design-studio/studio-v4-assets.ts`.

## Frames

| Asset | Slice | border-width | Use |
|-------|-------|--------------|-----|
| `panel-frame-9slice.svg` | 10 | 10px | Cards, sub-panels, bodies |
| `dialog-frame-9slice.svg` | 10 | 10px | Exit guard, bake unsaved |
| `nav-chip-9slice.svg` | 10 | 10px | Enter/back icon chips |
| `button-frame-9slice.svg` | 8 | 8px | Scalable buttons (HTML label inside) |
| `card-footer-9slice.svg` | 8 12 8 12 | 8px 12px | Status card enter rail |
| `subpanel-header-5slice.svg` | `10 14 10 48` | `10px 14px 10px 48px` | Sub-panel header bar — see `5-slice-usage.md` |
| `subpanel-header-9slice.legacy.svg` | — | — | **Deprecated** (scaled baked chevron) |

## TypeScript helper

```ts
import { STUDIO_V4_ASSETS, studioV4BorderImage } from '@/src/ui/design-studio/studio-v4-assets';

element.style.borderImage = studioV4BorderImage(STUDIO_V4_ASSETS.panels.panelFrame9Slice, 10);
element.style.borderWidth = '10px';
element.classList.add('studio-v4__surface', 'studio-v4__surface--panel');
```

## CSS-only (extension page)

```css
border-image: url('/assets/design-studio-v4/panels/panel-frame-9slice.svg') 10 fill;
border-width: 10px;
border-style: solid;
```

Prefer `studioV4BorderImage()` so paths survive WXT build output.

## Rules

- Icons and chevrons stay **outside** the stretchable center (HTML overlay), not baked into stretch zones except `card-footer` / `subpanel-header` corner hints.
- Fixed-aspect frames (`preview-window-frame`, `status-panel-frame`) are not 9-slice.
- Match `studio-palette.css` tokens for fills behind transparent centers.