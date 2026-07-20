# Track C — Popup UI Refresh QA checklist

**Sprint:** v6.0.0 Track C — browser-action popup Cividis unification  
**Branch:** `feature/v6.0.0-popup-ui-refresh`  
**Roadmap:** [`docs/v6.0.0-popup-ui-refresh.md`](../../../docs/v6.0.0-popup-ui-refresh.md) §6 QA matrix  
**Workspace TODO / progress:** [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md)  
**Fixture:** `npm run qa:popup-visual` → http://127.0.0.1:4175/ (production render builders + production CSS; no extension load needed)  
**Real-extension smoke:** load `.output/chrome-mv3-dev/` from this branch for the regression row only  
**Date:** _(fill in)_ · **Operator:** _(fill in)_

**Why this gate exists:** Track C is purely presentational (no state, message, or storage change), so the gate is visual parity + the elevated restart-caution behavior + zero Studio leakage.

### Non-negotiables (any FAIL here fails the gate)

| Rule | Source |
|------|--------|
| `entrypoints/popup/style.css` untouched — it is the Studio's shared base layer | roadmap §0 Fact 2 |
| Design Studio renders identical to pre-Track-C | roadmap §6 Studio isolation |
| No off-axis hues in `popup-palette.css` (machine-checked by `test-ui-tokens.mjs`) | design-studio.md §10.3 |
| No IA / prefs / message / dependency changes | roadmap non-goals |

---

## 1. Automated gate (agent-run)

- [ ] `node scripts/test-ui-tokens.mjs` PASS (Cividis sync + popup adoption + banned-hex scan)
- [ ] `npm run compile` — only the 2 pre-existing subtitle diagnostics
- [ ] `npm run build` PASS

## 2. Fixture — dark theme (default)

- [ ] Deep-indigo body (`#12001f`), raised indigo section cards, hairline borders — no `#1a1a1b` / `#272729` visible
- [ ] Header: amber mic brand mark + title row; version + README link muted indigo; README hover → amber
- [ ] Clip appearance card: summary line 1 strong, detail line muted (no longer unstyled); CTA is amber-action with dark text + edge ring
- [ ] Toggles: off = deep-indigo track + hairline edge; on = amber fill + **dark knob**; disabled/Coming-soon rows dim indigo + badge
- [ ] Help-tip "?" muted indigo; amber on hover/focus
- [ ] Bottom Reload = quiet charcoal secondary (never competes with caution)

## 3. Fixture — elevated restart caution

- [ ] Hidden on load
- [ ] Flipping any Audio toggle or the reduced-motion toggle reveals the bar **directly under the header**
- [ ] Copy reads "Audio / recording settings changed — reload recommended." + inline amber **Reload now** button
- [ ] Bar has `role="status"` + `aria-live="polite"`; Reload now triggers the (stubbed) `browser.runtime.reload`
- [ ] Permanent bottom Reload still present while bar is visible

## 4. Fixture — focus & keyboard

- [ ] Tab order unchanged (README → CTA → toggles → help tips → Reload)
- [ ] Every interactive element shows an **amber** focus ring (secondary Reload: indigo-muted ring)

## 5. Fixture — density & responsiveness

- [ ] No horizontal scroll at 300 px min-width
- [ ] Vertical rhythm matches pre-refresh (no layout shift beyond the caution bar when triggered)

## 6. Fixture — light mode

- [ ] `prefers-color-scheme: light` → desaturated indigo/amber family; readable; no Reddit blue anywhere
- [ ] Caution bar legible in light mode

## 7. Studio isolation (fixture + real)

- [ ] Design Studio (real extension or Style fixture) spot-check: buttons / selects / toggles / micro text unchanged
- [ ] `git diff` confirms zero edits to `entrypoints/popup/style.css` and all Studio CSS

## 8. Real-extension regression smoke

- [ ] Clip appearance summary updates live after a Studio change
- [ ] "Open Design Studio…" opens the Studio window
- [ ] README link opens GitHub README
- [ ] Both Reload buttons actually reload the extension

---

## Verdict

**Overall:** _(PASS / FAIL)_ · **Blockers:** _(none / list)_  
**Evidence:** `screenshot/` (gitignored — reference filenames in notes)

## Notes

_(evidence paths, deviations, follow-ups)_
