# Track D — Hosted Design Studio (QA)

**Status:** **OPEN · Phase 0 not started** · **Branch:** `feature/v6.0.0-hosted-design-studio` (cut from `main@a4df9a1`)
**Roadmap:** [`docs/v6.0.0-hosted-design-studio.md`](../../../docs/v6.0.0-hosted-design-studio.md) · **ADR:** none yet (0011 is next; trigger = the host boundary growing past a relay shim)
**Checklist:** [`qa-checklist.md`](qa-checklist.md)

Track D ships the full Design Studio as a static GitHub Pages surface via a **`browser` global shim** — no new extension context, no new message family, no new preference version. Package stays `5.11.0`.

## What makes this track's QA different

Unlike Tracks A/B/C, most of Track D's risk is **not** in new product behaviour — it is in the host adapter faithfully impersonating the extension platform. A shim gap usually presents as *subtly wrong behaviour*, not an error (roadmap §8 R3). QA is therefore weighted toward:

1. **Shim fidelity** — especially `storage.onChanged` firing for the writer's own writes, which the take lifecycle (ADR-0002 / I9) and the preference coordinator (I21) both depend on.
2. **Standing regression** — the Voice Studio and Field Guide must be green at **every phase exit**, not only at the end. They share the Pages origin and (after the Phase 0 alias flip) the same source tree.
3. **Timeout safety** — `transcoder.ts` allows 45 s ACK / 90 s absolute *including WASM cold start*, so the chronos gate's pre-warm is a correctness gate, not polish.
4. **Parity, not pixel-identity** — the hosted Studio is feature-complete and tracks `main`; it is not held to moment-to-moment visual identity with the extension. Bake output *is* held to parity.

## Phase gates

| Phase | Gate | Status |
|---|---|---|
| 0 — alias flip + shim + scaffold | Voice Studio green **after the flip, before new code**; demo build clean; Studio mounts with no console errors; checks C1/C2/C3 run | ☐ |
| 1 — record + take lifecycle | Record → base MP4 → download twice in a session; reload recovery | ☐ |
| 2 — visual system + bake | Track A/B/C surfaces appear without per-surface fixes; bake parity vs extension on an identical profile | ☐ |
| 3 — hub + chronos gate | D1 naming resolved first; cold + warm runs observed; failure/retry under throttling | ☐ |
| 4 — polish / a11y / docs | Production build + real Pages deploy verified from a clean profile | ☐ |

## Open checks (carried into Phase 0)

| # | Check | Why it matters |
|---|---|---|
| **C1** | In-page bake vs live preview contention | Relates to the unexplained "5–6× faster while minimized" observation in `claude-progress.md` |
| **C2** | App bundle weight (excluding vendored FFmpeg) | Completes the first-load budget in roadmap §3.5 |
| **C3** | Actual `Cache-Control` on the live Pages origin | If `max-age=600` holds, "later visits are instant" needs a Cache Storage layer, not the HTTP cache |

## Open decision

**D1 — naming.** `demo/index.html` already uses "Voice Studio" twice (phase card 01 and the lightweight destination). Recommendation: rename the lightweight page to **Voice Lab**. **Blocks Phase 3 copy; Phases 0–2 are unaffected.** Full options in roadmap §4.1.

## Evidence layout

```
qa/QA-6.0.0/track-d/
  README.md          ← this file
  qa-checklist.md    ← the operator gate
  logs/ · screenshot/ · artifacts/    (gitignored)
```

Bake-size gate reuses the shared harness:

```bash
npm run qa:visual-size -- --preset <id-or-label> --base <base.mp4> --baked <baked.mp4> [--json]
```
