# TODO

## v5.3.4 — Subtitle canvas overlay (`feature/v5.3.4-subtitle-canvas-overlay`)

**Branch:** `feature/v5.3.4-subtitle-canvas-overlay`  
**Current status (2026-07-01):** Phases 1–3 complete (skeleton, render loop + capture, paint fidelity + compare harness + duplicate-layer glow fix). Glow/halo works but needs diffusion polish. Next is Phase 4 integration + professional visual polish items below.

**Primary goal of this redraft:** Add high-professional visual polish to the Canvas overlay renderer **before** wiring into burn-in. Focus on dual contrasting border, clean opinionated gradient, and rounded background bar. These give the biggest "pro" lift with low risk of cheesiness. Keep all changes self-contained inside the overlay renderer so they do not touch existing auto-split / cue-width logic in other parts of the system.

### Current progress (unchanged from last session)

| Phase | Status | Key commits |
|-------|--------|-------------|
| 1 — skeleton + dev harness | DONE | `2c8c450` |
| 2 — render loop + MediaRecorder | DONE | `88f856c` |
| 2½ — empty WebM / VP8 hardening | DONE | `224c361`, `9ab41fe` |
| 3 — paint fidelity + compare harness + glow fix | DONE | `c54e874`, `6a609ce`, `2334c6b` |
| 4 — burn-in pipeline integration (`useCanvasOverlay`, strategy, full bake button) | **NEXT** | — |
| 5 — polish, lab panel, docs | pending | — |

**Key modules (current):** `subtitle-overlay-renderer.ts` (main paint logic), `subtitle-overlay-fonts.ts`, `overlay-webm-finalize.ts`, `subtitle-overlay-compare.ts`, DEV UI in `subtitle-controls.ts`.

**User QA so far (all pass):** single render, download, scrub, side-by-side compare harness (drawtext vs canvas), halo + border modes after duplicate-layer fix.

---

## Immediate next work (post-Phase 3, before or during Phase 4)

### 1. Halo diffusion polish (existing open item — do first)
- Soft halo currently renders but is too sharp / too close to hard-border aesthetic.
- Task: In `subtitle-overlay-renderer.ts` (`paintGlowText` or new `paintHaloLayers`), try `buildGlowLayerSpecs(..., 'full')` on the canvas-only path (multi-ring gradient approach — we no longer have the 64-layer limit).
- Alternative / complement: add a tuned `shadowBlur` pass *under* the duplicate `fillText` layers for extra diffusion.
- Re-run the compare harness after changes. Goal: halo looks noticeably softer and more "glow-like" than the current border-style result while still matching the intended professional look.
- Update any comments that reference the old ring-based drawtext limitation.

### 2. Dual-layer contrasting outline / double border (new high-priority polish)
**Why this is a big value add:** You already use this successfully in GIMP. A clean inner + outer border with contrasting colors instantly reads as more expensive and readable on varied video backgrounds without looking cheap or overdone.

**Requirements:**
- Use the existing theme/accent color (current border color) as the **outer** layer.
- Use the "special color" (or secondary color) as the **inner** layer, or automatically derive a high-contrast companion if the user hasn't set a deliberate secondary.
- Keep it opinionated and polished: the two colors must have good contrast (not low-contrast pastels). Prefer automatic derivation when possible (simple luminance-based or complementary hue shift with clamped saturation/lightness) so most users get a good result without extra thought. Still expose the secondary/special color in `SubtitleStyleConfig` and the controls so power users can override.
- Implement in the Canvas path first (`paintGlowText` / new `paintDualBorderText` helper in `subtitle-overlay-renderer.ts`). Use layered `strokeText` or offset `fillText` passes (we already do duplicate layers for halo — extend the same pattern).
- Do **not** try to replicate this in the old drawtext fallback path for now (it would re-introduce the layer explosion we are escaping). Canvas overlay is the place for rich effects.
- Visual QA: Add or extend the compare harness to show "Single border" vs "Dual contrasting border" examples. Make sure it never looks "glowing neon" or cheap — aim for the clean, high-end subtitle look you see in good motion graphics.

**Suggested minimal API addition (keep it small):**
```ts
interface SubtitleStyleConfig {
  // existing...
  borderColor?: string;        // theme/accent (outer)
  secondaryBorderColor?: string; // special/derived (inner) — optional, auto-derived if absent
  borderMode?: 'single' | 'dual' | 'glow' | 'border'; // extend as needed
}
```
Add a small helper `resolveContrastingBorderColor(baseHex, specialHex?)` that returns a good inner color (you can keep it simple — e.g. darken/lighten by fixed amount or hue shift toward the special color while preserving readability).

### 3. Clean opinionated gradient effect on text (new)
**Goal:** A subtle, professional gradient on the text fill or stroke that feels expensive without user fiddling.

**Requirements:**
- Implement a clean, opinionated preset (not a full custom gradient UI yet). One good default that works across light/dark themes.
- Suggested starting point (you can tune after seeing it): subtle vertical gradient from slightly lighter version of the main text color at the top to the main color (or a very low-alpha mix with the secondary color) at the bottom. Or a gentle accent-to-theme gradient on the stroke.
- Apply in the Canvas `paintMainText` / `paintGlowText` path using `createLinearGradient`.
- Keep it self-contained inside the overlay renderer. Do not affect auto-split or cue width calculations elsewhere.
- Visual QA: Show in the compare harness with/without gradient. It should enhance readability and polish, not distract.

### 4. Rounded corners on background bar (new — cheap but high impact)
Sharp rectangular bars currently look cheap. Rounded corners instantly modernize the look.

**Requirements:**
- In the backdrop plate painting code (currently in `subtitle-overlay-renderer.ts` or shared with `subtitle-effects.ts`), switch from `fillRect` to `roundRect` (or manual rounded path) with a sensible radius (e.g. 4–8 px scaled to font size, or a fixed small value like 6 px at 1080p that still looks good when downscaled).
- Keep the existing padding / width calculation logic intact — the rounding is purely visual and self-contained. It must not change how many characters fit or trigger re-splitting.
- Make the radius a small constant or derive it from font size so it scales cleanly.
- Visual QA: Test with short and long cues. The bar should look intentional and high-end, not "pill" shaped unless you want that later.

### 5. Rainbow / hue-rotate glow mode (new) - add to the "Glow Color" under "Theme Glow" menu

**Requirements:**
- Add support for a time-based rainbow/hue-rotate glow mode in addition to the static and dual-border modes.
- The hue shift must be calculated **per frame** using the current render time (`currentTimeSeconds` or frame index) so the color change is smooth at the full target FPS (24/30 fps) instead of the old stepped effect.
- Keep it opinionated and polished: one clean default speed (e.g. full hue cycle every 5–8 seconds) that works well across most clips. Expose a simple `rainbowHueSpeed` (or `glowHueSpeed`) value in `SubtitleStyleConfig` so advanced users can adjust it.
- The rainbow effect must compose cleanly with the other new polish items (dual contrasting border, gradient, rounded bar, and improved halo diffusion).
- All logic must live inside `subtitle-overlay-renderer.ts` (extend `paintGlowText`, `paintHaloLayers`, or add a small `resolveGlowColor(style, currentTimeSeconds)` helper). Do not touch cue splitting, width calculation, or any logic outside the overlay renderer.
- When `glowMode` (or equivalent) is set to rainbow, the glow color becomes dynamic while everything else (positioning, backdrop plate, border layers, etc.) remains unchanged.

**Suggested minimal API addition (keep it small and consistent with the other polish items):**

```ts
interface SubtitleStyleConfig {
  // ... existing fields
  glowMode?: 'static' | 'dual' | 'rainbow' | 'border';
  rainbowHueSpeed?: number;        // degrees per second, optional, sensible default provided
  // or alternatively a single field:
  // glowHueSpeed?: number;        // 0 = static, >0 = rainbow at that speed
}
```

Add a lightweight helper:

```ts
function resolveGlowColor(
  style: SubtitleStyleConfig,
  currentTimeSeconds: number
): string {
  if (style.glowMode === 'rainbow' || style.rainbowHueSpeed) {
    const speed = style.rainbowHueSpeed ?? 45; // default ~8-second cycle
    const hue = (baseHue + currentTimeSeconds * speed) % 360;
    return hslToHex(hue, 85, 72); // tune saturation/lightness to taste
  }
  return style.borderColor ?? style.textColor; // fallback to existing static color
}
```

Call `resolveGlowColor(...)` inside the existing glow/halo painting functions so the rest of the code stays clean.

**Visual QA requirement:**  
Extend the dev compare harness (or the future Overlay Lab panel) with a “Rainbow glow” example. It should clearly show smooth hue rotation at video frame rate with no stepping, and it must still look good when combined with dual-border mode. Test on both short and longer cues.


---

## Phase 4 — Burn-in pipeline integration (unchanged scope, but now with polish items above)

- Add `useCanvasOverlay?: boolean` (and optionally `canvasOverlayStyle` overrides) to `SubtitleBurnInInput`.
- Create `buildCanvasOverlayStrategy(...)` that calls the renderer, writes `subtitle-overlay.webm`, then returns a minimal strategy with a simple `overlay` filter.
- Update `buildBurnInStrategies` to prefer the canvas path when glow/border/dual effects are active or cue count is high.
- Add dev button: **"Dev: Bake with Canvas Overlay (full pipeline)"** that runs a real end-to-end burn-in using the new strategy and lets you download/preview `final.mp4`.
- The rich effects (dual border, gradient, rounded bar, better halo) only need to exist in the Canvas renderer — the drawtext fallback can stay simpler.

## Phase 5 — Polish, lab panel, docs (expanded)

- Add a gated "v5.3.4 Subtitle Overlay Lab" panel in Design Studio (behind dev flag) that lets you:
  - Toggle dual border on/off + pick/see the secondary color
  - Toggle gradient on/off
  - Adjust (or just view) rounded bar radius
  - Side-by-side old vs new with the new effects
  - 15+ cue stress test
- Progress callbacks during long canvas renders.
- Performance guard: if canvas render exceeds threshold on a test clip, auto-fallback to drawtext + toast.
- Update `docs/transcription-architecture.md` and comments in `subtitle-burnin.ts` / `subtitle-effects.ts` with notes about the new Canvas-first rich effects path.
- Full 15+ cue QA with all new polish items enabled.

---

## Verification checklist for hand-off / next session

- [ ] Halo diffusion polish complete and visibly softer in compare harness
- [ ] Dual contrasting border implemented cleanly (outer theme + inner special/derived) and looks professional (not cheesy)
- [ ] Clean opinionated gradient present and enhances without distraction
- [ ] Background bar has rounded corners and still respects existing auto-split/width logic
- [ ] All changes self-contained in `subtitle-overlay-renderer.ts` (and small helpers)
- [ ] Compare harness and dev buttons updated to exercise the new effects
- [ ] Typecheck + `npm run build` clean
- [ ] No regression in existing drawtext path or auto-split behavior elsewhere in the app

## Restore / test

```bash
git checkout feature/v5.3.4-subtitle-canvas-overlay && npm install && npm run dev
```

Design Studio → Subtitles → DEV harness buttons. Record a clip on Reddit first so the compare harness has a base MP4 for the drawtext side.

---

**Notes for the implementer**
- The Canvas renderer is now the home for professional visual effects. We are no longer constrained by FFmpeg layer counts, so we can (and should) make the output look as good as your GIMP work.
- Keep auto-split / cue-width logic untouched — any sizing/measurement stays in its current home. The new renderer only paints what it is given.
- For the contrasting color: a small automatic helper is preferred for most users, with the existing "special color" as an override. Test on both light and dark video backgrounds.
- Gradient and rounded bar are "set and forget" polish — one good opinionated choice each is enough for this release.
- All of the above should be toggleable / previewable in the dev harness before Phase 4 wiring.

This redraft keeps the scope tight on the three high-value polish items you asked for while preserving the original architecture and existing working features. Ready to hand off.