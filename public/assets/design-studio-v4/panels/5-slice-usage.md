# 5-Slice horizontal bar guide (experimental — not used in runtime)

Superseded for sub-panel header by `subpanel-header-9slice.svg` (baked chevron removed; HTML nav-chip only).

For **wide, short chrome bars** where the left zone must stay fixed and a middle stripe stretches — not uniform 9-slice.

Resolve URLs with `studioV4AssetUrl()` and `studioV4BorderImageSlices()` from `src/ui/design-studio/studio-v4-assets.ts`.

## Concept (five horizontal segments)

| # | Width (source art) | Behavior |
|---|-------------------|----------|
| 1 | 40px | **Fixed** — chip slot recess (HTML `nav-chip` + icon overlays; no baked chevron) |
| 2 | 8px | Left inner clear-bar cap |
| 3 | 24px+ | Middle stripe — stretches via top/bottom `border-image` edges |
| 4 | 8px | Right inner clear-bar cap |
| 5 | 14px | **Fixed** — right end cap |

CSS `border-image` maps segments 1+2 → **left slice** (48px), segment 5 → **right slice** (14px), segments 3+4 → **top/bottom** stretch.

## Runtime asset

| File | Slice | border-width | Use |
|------|-------|--------------|-----|
| `subpanel-header-5slice.svg` | `10 14 10 48` | `10px 14px 10px 48px` | `.studio__subpanel-chrome-status` |

## TypeScript

```ts
import { STUDIO_V4_ASSETS, studioV4BorderImageSlices } from '@/src/ui/design-studio/studio-v4-assets';

root.style.setProperty(
  '--studio-v4-border-subpanel-header',
  studioV4BorderImageSlices(STUDIO_V4_ASSETS.panels.subpanelHeader5Slice, 10, 14, 10, 48),
);
```

```css
border-width: 10px 14px 10px 48px;
border-image: var(--studio-v4-border-subpanel-header);
```

## Legacy

| File | Status |
|------|--------|
| `subpanel-header-9slice.svg` | Deprecated — baked chevron scales/bleeds under nav-chip |
| `subpanel-header-9slice.legacy.svg` | Frozen copy for reference |

## Rules

- Never bake navigation chevrons into stretchable bar assets — use HTML icons on `nav-chip-9slice`.
- Do not stack `profile-status-frame` background under a bar `border-image` (double chrome).
- Match `studio-palette.css` fill behind transparent centers (`--studio-bg-deep`).