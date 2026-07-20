# Track C — Popup UI Refresh QA checklist

**Sprint:** v6.0.0 Track C — browser-action popup Cividis unification  
**Branch:** `feature/v6.0.0-popup-ui-refresh`  
**Roadmap:** [`docs/v6.0.0-popup-ui-refresh.md`](../../../docs/v6.0.0-popup-ui-refresh.md) §6 QA matrix  
**Workspace TODO / progress:** [`../TODO-6.0.0.md`](../TODO-6.0.0.md) · [`../progress-QA-6.0.0.md`](../progress-QA-6.0.0.md)  
**Fixture:** `npm run qa:popup-visual` → http://127.0.0.1:4175/ (production render builders + production CSS; no extension load needed)  
**Real-extension smoke:** load `.output/chrome-mv3-dev/` from this branch for the regression row only  
**Date:** 2026-07-19 (agent pass) · **Operator:** Claude Fable 5 agent gate · operator visual pass pending

**Why this gate exists:** Track C is purely presentational (no state, message, or storage change), so the gate is visual parity + the elevated restart-caution behavior + zero Studio leakage.

### Non-negotiables (any FAIL here fails the gate)

| Rule | Source |
|------|--------|
| `entrypoints/popup/style.css` untouched — it is the Studio's shared base layer | roadmap §0 Fact 2 |
| Design Studio renders identical to pre-Track-C | roadmap §6 Studio isolation |
| No off-axis hues in `popup-palette.css` (machine-checked by `test-ui-tokens.mjs`) | design-studio.md §10.3 |
| No IA / prefs / message / dependency changes | roadmap non-goals |

---

## 1. Automated gate (agent-run) — **PASS 2026-07-19**

- [x] `node scripts/test-ui-tokens.mjs` PASS (Cividis sync + popup adoption + banned-hex scan; the scan even caught banned hexes quoted in the palette's own header comment during development)
- [x] `npm run compile` — only the 2 pre-existing subtitle diagnostics
- [x] `npm run build` PASS (palette inlined into popup chunk; Studio chunk separate)

## 2. Fixture — dark theme (default) — **PASS (computed-style evidence)**

- [x] Deep-indigo body (`#12001f`), raised indigo section cards, hairline borders — no `#1a1a1b` / `#272729` visible
- [x] Header: amber mic brand mark (16×16 currentColor) + title row; version + README link muted indigo; README hover → amber (declared; hover state agent-sampled via focus twin)
- [x] Clip appearance card: summary line 1 strong (w600 `#e8e6f0`), detail line muted (no longer unstyled); CTA amber-action `#d4a020` with `#1a1000` text + `#9a7210` edge ring
- [x] Toggles: off = deep-indigo track + hairline inset ring (zero geometry change); on = amber fill + **dark knob `#1a1000`**; disabled/Coming-soon rows dim indigo `#6f6b90` + indigo badge
- [x] Help-tip "?" muted indigo w/ indigo-accent border; amber text/border on focus
- [x] Bottom Reload = quiet charcoal `#35353f` secondary

## 3. Fixture — elevated restart caution — **PASS (behavioral)**

- [x] Hidden on load (`display:none` while `[hidden]` — specificity fix verified)
- [x] Flipping an Audio toggle reveals the bar **directly under the header** (bar top 95px vs header bottom 83px, above hint)
- [x] Copy reads "Audio / recording settings changed — reload recommended." + inline amber **Reload now** button
- [x] Bar has `role="status"` + `aria-live="polite"`; Reload now invoked the (stubbed) `browser.runtime.reload`
- [x] Permanent bottom Reload still present while bar is visible

## 4. Fixture — focus & keyboard — **PASS (real Tab traversal)**

- [x] Tab order unchanged (README → caution Reload now → CTA → help tips/toggles in DOM order → Reload; disabled inputs skipped)
- [x] Amber `#ffd54f` focus ring on README link / Reload now / CTA / toggle inputs / help tips; secondary Reload ring indigo-muted `#8a86b0`

## 5. Fixture — density & responsiveness — **PASS**

- [x] No horizontal scroll at 300 px popup width
- [x] Vertical rhythm untouched by construction (skin recolors only; caution bar is the sole conditional block)

## 6. Fixture — light mode — **PASS (fresh-load)**

- [x] `prefers-color-scheme: light` → desaturated indigo/amber family (`#f4f2fa` body, white cards, `#dedaef` tracks, same amber actions); no Reddit blue anywhere (computed-checked)
- [x] Caution bar legible in light mode (`#6f520b` on amber tint)
- Note: flipping the emulated scheme on a *live* page left one stale-painted control in the harness (renderer-level; unmovable even by inline style; CSSOM audit confirmed the cascade is correct) — always evaluate light mode on a fresh load.

## 7. Studio isolation (fixture + real) — **PASS (git-verified)**

- [x] By construction: popup-palette.css imported only by the popup entry; optional operator eyeball via `npm run qa:style-control-center`
- [x] `git diff f1653c4..HEAD -- entrypoints/popup/style.css entrypoints/design-studio/` → empty (zero edits to the shared base + all Studio CSS)

## 8. Real-extension regression smoke — **OPERATOR (open)**

- [ ] Clip appearance summary updates live after a Studio change
- [ ] "Open Design Studio…" opens the Studio window
- [ ] README link opens GitHub README
- [ ] Both Reload buttons actually reload the extension
- [ ] Operator eyeball of the popup (dark + light) — pixel screenshots to `screenshot/`

---

## Verdict

**Overall:** **AGENT GATE PASS** (sections 1–7) · operator visual pass (§8) pending · **Blockers:** none  
**Evidence:** `logs/computed-style-qa-2026-07-19.json` (full computed-style/behavior/keyboard evidence) · pixel screenshots deferred — Browser-pane capture faulted for the whole session (screenshot/zoom timeouts while DOM/JS/keyboard tools worked); one `npm run qa:popup-visual` + eyeball closes it

## Notes

- APP_VERSION bug fix rides along (popup showed v5.10.0 on a 5.11.0 package); fixture header now shows v5.11.0.
- Light mode must be judged on a fresh page load; live scheme-flip can leave a stale-painted control in emulated harnesses (documented in the evidence JSON — not a product defect).
- Amber CTA (not Studio's violet `--studio-violet-confirm`) is intentional: Studio semantics assign amber to actions, violet to confirms; opening the Studio is an action (roadmap §2).
