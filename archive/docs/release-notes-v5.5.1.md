# Release notes — v5.5.1 **Browser composite default-on**

**Tag:** `v5.5.1` · **Date:** 2026-07-07
**Prior stable:** `v5.5.0`
**Restore:** `git checkout main && npm install && npm run dev`

---

> **The headline:** browser-side full composite is now the production default. v5.5.0 shipped it opt-in behind an Overlay Lab toggle — but the Lab is dev-only (`import.meta.env.DEV` or `localStorage rvn:subtitle-overlay-lab=1`), so production users had no GUI path to enable it. v5.5.1 fixes that by flipping `experimental.browserComposite` to **true** by default.

---

## What changed

- **`experimental.browserComposite` default `true`** — production bakes use the in-page mediabunny composite path (probe-gated; falls back to legacy FFmpeg composite on failure).
- **One-time rollout migration** — stored v5.5.0 rollout default `browserComposite: false` flips to `true` on first prefs read (`rvnBrowserCompositeRolloutMigrated` marker). Explicit future opt-out (`false`) is preserved.
- **Opt-out:** set `experimental.browserComposite: false` in `rvnUserPrefs` (no popup toggle yet; same pattern as early WebCodecs rollout).

## Unchanged

- Full fallback chain: `browser-composite → WebCodecs-IVF + FFmpeg alphamerge → MediaRecorder → drawtext`.
- Overlay Lab remains dev/QA-only; its browser-composite checkbox still overrides prefs for Lab bakes only.

## Verification

- `node scripts/test-browser-composite-plan.mjs` — 17/17
- `npm run build` PASS

---

*Rationale: Phase 0 QA + two-machine R11 matrix PASS; user reports flawless production-quality bakes with large speedup vs legacy composite.*