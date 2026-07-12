> **ARCHIVED DOCUMENT — do not edit.** Captured **2026-07-11** after the v5.9.0 milestone by `/docs-archiving` Refresh #2. This shipped release record is indexed from [`docs/HISTORY.md`](../../docs/HISTORY.md).

# Release notes — v5.7.0 **Partial Re-bake Splice**

**Tag:** `v5.7.0` · **Date:** 2026-07-08  
**Prior stable:** `v5.6.0`  
**Branch:** merged `feature/5.7.0-partial-rebake-splice` → `main`  
**Contract:** [`v5.6.0-audio-decoupling.md`](v5.6.0-audio-decoupling.md) §4.2 + §13 · [ADR-0005](architecture/adr/0005-partial-rebake-splice.md)  
**Restore:** `git checkout main && npm install && npm run dev`

---

> **The headline:** after a small subtitle cue edit, re-bake only the dirty keyframe-aligned spans and splice them into the previous baked MP4 — instead of re-compositing the whole clip. Self-verifying fidelity gate; every miss falls back to a correct full composite. Default **on** after single-machine real-browser QA (AVC + VP9).

---

## What shipped

- **Packet-level splice executor** (`src/composite/composite-splice.ts`) — scan → plan → re-encode dirty GOPs from the **clean base** + new cues → copy kept packets bit-exact → interleave → validate.
- **Pure splice plan** (`src/editing/splice-plan.ts`) — real keyframe alignment, region model, plan/output validation, chronos stages, `scanKeyframes` + `diagnoseKeyframeScanFailure`.
- **Fidelity gate** (`verifySpliceKeptFrames`) — kept-region frames must decode pixel-identical to the prior bake (catches the avcC hazard); boundary frames must decode. Miss → full composite.
- **Honest `coordinateRebake`** — reports `executed:'partial'` only when fidelity-verified bytes return; AbortError propagates (no silent full re-render on cancel).
- **VP9 splice-friendly encode** — `latencyMode: 'realtime'` for VP9 only so alt-ref reordering does not break the scan gate (AVC stays `quality`).
- **`experimental.partialRebakeSplice` default ON** — opt-out with `false`.

## Unchanged

- First bake of a session, style/backplate changes, coverage &gt; 60%, duration change, and non-splice-friendly artifacts → full composite.
- Fallback chain (I1), Reddit attach contract, H6 stamps, voice re-apply (v5.6.0).
- Session-local previous-bake cue snapshot (`lastBakeInputs`) — reopen Studio → first re-bake is full; artifact bytes retained.

## Real-browser QA sign-off (2026-07-08)

Single machine (Windows / Chrome). Living evidence: `.ignore/QA-5.7.0/` (gitignored).

| Section | Result |
|---------|--------|
| A Happy path (cue-edit splice) | **PASS** (AVC) |
| B Honesty + fidelity + abort | **PASS** (B3: close-window mid-splice retains prior MP4) |
| C1 AVC | **PASS** (splice + fidelity Δ0.00; intermittent avcC reject → full also correct) |
| C2 VP9 | **PASS** (`c2-a2-attempt-3.log`: 44/680 re-encoded, fidelity 8 kept/6 boundary ok, Δ0.00, **vp9**) |
| D Honest fallbacks | **PASS** |
| E Download / attach / artifact | **PASS** |

**Second machine:** not run. Written gate required C1 **or** C2 on ≥1 machine; this release has **both** codecs on one machine. Residual risk is hardware-encoder variance (more frequent AVC fidelity → full fallback, still correct). Optional follow-up: spot-check A2 on a second box before broad distribution.

## Opt-out

```js
// Studio / extension page DevTools
const p = await chrome.storage.local.get('rvn.userPreferences');
const prefs = p['rvn.userPreferences'] ?? {};
prefs.experimental = { ...(prefs.experimental ?? {}), partialRebakeSplice: false };
await chrome.storage.local.set({ 'rvn.userPreferences': prefs });
```

## Verify

```bash
node scripts/test-splice-plan.mjs          # 36
node scripts/test-partial-rebake-plan.mjs  # 13
node scripts/test-browser-composite-plan.mjs # 17
npm run build
```

## Not in this release

- Phase 3 trim UI + atomic artifact/cue/raw-WebM integration
- Mid-bake Cancel button (close-window abort works; optional polish)

---

*Push of `main` + tag deferred per repo convention unless you push.*
