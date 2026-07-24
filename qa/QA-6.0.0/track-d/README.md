# Track D — Hosted Design Studio (QA)

**Status:** **COMPLETE · merge candidate (2026-07-23)** · Phases 0–4 closed · real Pages 5.7 operator PASS · **Branch:** `feature/v6.0.0-hosted-design-studio` (cut from `main@a4df9a1`)
**Roadmap:** [archived Track D roadmap](../../../archive/docs/v6.0.0-checkpoint/track-roadmaps/v6.0.0-hosted-design-studio.md) · **ADR:** none yet (0011 is next; trigger = the host boundary growing past a relay shim)
**Checklist:** [`qa-checklist.md`](qa-checklist.md)

Track D ships the full Design Studio as a static GitHub Pages surface via a **`browser` global shim** — no new extension context, no new message family, no new preference version. Package stays `5.11.0`.

## What makes this track's QA different

Unlike Tracks A/B/C, most of Track D's risk is **not** in new product behaviour — it is in the host adapter faithfully impersonating the extension platform. A shim gap usually presents as *subtly wrong behaviour*, not an error (roadmap §8 R3). QA is therefore weighted toward:

1. **Shim fidelity** — especially `storage.onChanged` firing for the writer's own writes, which the take lifecycle (ADR-0002 / I9) and the preference coordinator (I21) both depend on.
2. **Standing regression** — the Voice Lab and Field Guide must be green at **every phase exit**, not only at the end. They share the Pages origin and (after the Phase 0 alias flip) the same source tree.
3. **Timeout safety** — `transcoder.ts` allows 45 s ACK / 90 s absolute *including WASM cold start*, so the chronos gate's pre-warm is a correctness gate, not polish.
4. **Parity, not pixel-identity** — the hosted Studio is feature-complete and tracks `main`; it is not held to moment-to-moment visual identity with the extension. Bake output *is* held to parity.

## Phase gates

| Phase | Gate | Status |
|---|---|---|
| 0 — alias flip + shim + scaffold | Voice Lab green **after the flip, before new code**; demo build clean; Studio mounts with no console errors; checks C1/C2/C3 run | ■ COMPLETE |
| 1 — record + take lifecycle | Record → base MP4 → download twice in a session; reload recovery | ■ COMPLETE |
| 2 — visual system + bake | Track A/B/C surfaces appear without per-surface fixes; bake parity vs extension on an identical profile | ■ gate substantially MET (structural + operator rich bake) |
| 3 — hub + chronos gate | Cold + warm runs observed; failure path shows Retry **and a warned Open anyway** under throttling | ■ **PASS operator 2026-07-22** (QA §4.1–4.10) |
| 4 — polish / a11y / docs / optional captions | Production build + real Pages deploy verified from a clean profile; optional Vosk tier | ■ **COMPLETE** (5.1–5.8 · Pages 5.7 operator PASS 2026-07-23) |

## Open checks (all closed through Phase 3)

| # | Check | Why it matters |
|---|---|---|
| **C1** | In-page bake vs live preview contention | ■ closed 2026-07-22 — zero main-thread long tasks (worker bake); hidden-tab RAF throttle is not a bake blocker |
| **C2** | App bundle weight (excluding vendored FFmpeg) | ■ 1.27 MB JS + 148 KB CSS |
| **C3** | Actual `Cache-Control` on the live Pages origin | ■ `max-age=600` + 304 revalidation; eviction risk still motivates Cache Storage (Phase 4 studio-side read) |

## Resolved decisions

- **D1 — naming · RESOLVED 2026-07-22.** The lightweight page is **Voice Lab**. The `/studio/` URL and `demo/src/studio/` path are unchanged, so no link or route work is needed. Roadmap §4.1.
- **Chronos failure policy · RESOLVED 2026-07-22.** Click-through is allowed: **Retry** plus **Open anyway** with an adjacent warning naming the consequence ("baking may fail or time out"). Never a hard block, never silent. Roadmap §5.1 — QA covers it at §4.6.
- **User-facing "Reddit" copy policy · LANDED 2026-07-22.** Only the *requirement* class was removed; provenance, optional attach, Reddit-specific constraints, and the product name stay. Zero identifier renames. Roadmap §4.2, rule mirrored in `docs/design-studio.md` §8.5.

## Deferred

**Tutorial refresh** — 86 "Reddit" and 5 "Voice Studio" mentions, owner-scheduled before v6 ships. It exists as **two near-identical copies** (`docs/tutorial/tutorial.html` and `demo/public/tutorial/index.html`, differing by one favicon line); settle that duplication before editing either. Roadmap §4.3.

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
