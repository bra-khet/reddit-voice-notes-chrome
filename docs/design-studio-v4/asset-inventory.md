# Design Studio v4 — Asset inventory & MVP punch list

**Imported:** 2026-06-23 from `svg-paths/design-studio-v4/vector-assets`  
**Runtime path:** `public/assets/design-studio-v4/` (extension URL: `/assets/design-studio-v4/...`)  
**Layout target:** `docs/design-studio.md` §10.1.1 (narrow scope) + §10.2 (hero + 1×4 strip)

## MVP verdict: **ready to start shell migration**

Enough assets exist for Phase 1: hero row, profile/status cluster, four status cards, sub-panel chrome, and baseline CVD-friendly chrome. Sub-panel **controls** can keep current HTML on first pass; vector knobs/sliders integrate in a later polish sprint.

---

## Critical — have (shell migration)

| Asset | Path | Use |
|-------|------|-----|
| 9-slice panel frame | `panels/panel-frame-9slice.svg` | Cards, sub-panels, dialogs |
| Hero preview frame | `panels/preview-window-frame.svg` | Live preview chrome |
| Profile/status frame | `panels/profile-status-frame.svg` | Top-right cluster |
| Status card frame | `panels/status-panel-frame.svg` | Four section cards |
| Panel header bar | `panels/panel-header-bar.svg` | Card title strip |
| Section icons (32px) | `icons/waveform-bars-32.svg`, `frame-icon-32.svg`, `mic-wave-32.svg`, `caption-lines-32.svg` | Bar / Background / Voice / Subtitles |
| Status LEDs | `status/status-indicator.svg`, `warning-indicator.svg`, `complete-check.svg` | Status strip + card badges |
| Profile actions | `buttons/button-update.svg`, `button-clone.svg`, `button-delete.svg` | Save/Update, Clone, Delete |
| 9-slice guide | `panels/9-slice-usage.md` | CSS `border-image` recipe |

## Critical — missing (non-blocking; CSS fallback OK for MVP)

| Gap | Priority | MVP workaround |
|-----|----------|----------------|
| **Card enter chevron** (`›` / open affordance) | P1 | Extract chevron from `chrome/dropdown.svg` or CSS `::after` |
| **Sub-panel back chevron** (`‹` / Back) | P1 | CSS unicode or mirrored dropdown chevron |
| **Pending / info status** (distinct from warning/complete) | P1 | Recolor `status-indicator.svg` via CSS (`--status-pending: cyan`) + label |
| **Done / primary exit** button chrome | P2 | Reuse `button-update.svg` or text button until dedicated asset |
| **`studio-palette.css` tokens** | P2 | Ship with migration (indigo/amber vars from spec) |

None of the above block layout/CSS prototype work.

## Deprecated / do not use (per author notes)

| Asset | Reason |
|-------|--------|
| `displays/amber-futuristic-segmented.svg` | Legacy WIP; poor contrast (amber on amber) |
| `srt/timeline-ruler.svg`, `srt/playhead.svg` | Not in product model; segment editor uses per-cue timecodes only |
| `srt/segment-block.svg` | Optional chrome only; existing HTML editor is source of truth |

## Usable later in sub-panel polish

| Category | Paths |
|----------|-------|
| Knobs | `knobs/knob-housing.svg`, `knob-ticks-amber.svg`, `knob-radial-speedometer-decal.svg` |
| Sliders | `sliders/physical-slider-track.svg`, `physical-slider-tab.svg` |
| Chrome | `chrome/dropdown.svg`, `defeat-toggle.svg`, `position-3x3-grid.svg`, `background-preview-thumbnail.svg` |
| Decals | `decals/panel-backlight-radial.svg`, `common/theme-glow-template.svg` |
| SRT timecode | `srt/timecode-display.svg` (optional segment editor skin) |

## Nice to have (post-MVP)

- Dedicated `chevron-enter.svg` + `chevron-back.svg` (24px + 16px)
- `button-done.svg` / neutral Cancel variant
- `icons/profile-silhouette-32.svg` for profile cluster
- Composite `volume-knob.svg` (housing + needle + decal) — spec referenced but never exported
- Hover / active / pressed SVG states for buttons and toggles
- 16px icon variants for narrow stack breakpoint
- Revised segmented display (indigo field + amber glyphs) if numeric status readouts are wanted
- Sub-panel overlay scrim texture (optional; CSS `backdrop-filter` likely sufficient)

## Related docs

| Doc | Role |
|-----|------|
| `docs/design-studio-v4/vector-ui-assets-spec.md` | Full spec, theming, vector vs CSS |
| `docs/design-studio-v4/feature-set-scaffold.md` | Logical tree for panel nesting |
| `docs/design-studio.md` §10 | Surgery map + layout + CVD + exit guard |

## GIMP authoring rule

SVG header comments: CSS `/* */` inside `<svg>`, avoid `<!-- -->` with `--` sequences. See `public/assets/design-studio-v4/README.md`.