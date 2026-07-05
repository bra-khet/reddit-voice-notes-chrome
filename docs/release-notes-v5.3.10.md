# Release notes — v5.3.10 **WebCodecs Per-Chunk Encoding**

**Tag:** `v5.3.10` · **Date:** 2026-07-05  
**Branch:** merged `feature/v5.3.10-webcodecs-encoding` → `main`  
**Restore:** `git checkout v5.3.10 && npm install && npm run dev`  
**Prior stable:** `v5.3.9` (Parallel Chunked Bake)  
**Design:** `docs/5.3.10-webcodecs-per-chunk-encoding.md` §0 As-Built Revision  
**ADR:** `docs/architecture/adr/0001-webcodecs-encoding-backbone.md`  
**Next:** **v5.4.0** Design Studio First — `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`

## Summary

v5.3.9 proved that parallel chunking cuts capture to ~0.3× realtime, but **normalize still consumed ~77% of full-bake wall time** (~111 s on a 60 s / 200-cue clip). That stage exists only to repair MediaRecorder output (VFR timestamps, tail frames, implicit VP8A alpha).

v5.3.10 replaces per-chunk MediaRecorder with **dual-stream WebCodecs VP8 encoding** (color + alpha-as-gray IVF segments), stitches in pure TypeScript (~ms), and composites via **`alphamerge` inside the existing x264 burn-in pass**. Streams are **composite-ready by construction** — integer global-frame PTS, frame-exact segments, explicit alpha — so **normalize is eliminated on the WebCodecs path**, not merely faster.

**Result:** 60 s rich-effects bakes drop from **~228–310 s** (legacy MediaRecorder) to **~46–50 s** (**sub-real-time**, 0.77–0.83× clip duration). Visual quality is indistinguishable from the legacy path, including dense overlapping cues.

## User QA (2026-07-05) — **PASS**

**Source:** `.ignore/sub-QA-5.3.10/` · Overlay Lab, session segment set, rich effects (gradient + wave + rainbow halo + dual border). Toggle **on** = WebCodecs + v5.3.9 chunking; **off** = legacy MediaRecorder (serial capture + normalize + composite).

### Overlay render only

| Cues | Toggle | Total | Capture `wallMs` | `realtimeFactor` | `encoderType` |
|------|--------|-------|------------------|------------------|---------------|
| 20 | **ON** | **7.4 s** | 7.4 s | **0.12×** | `webcodecs` |
| 20 | OFF | 63.9 s | 63.6 s | 1.06× | `mediarecorder` |
| 232 | **ON** | **6.7 s** | 6.8 s | **0.11×** | `webcodecs` |
| 232 | OFF | 69.0 s | 68.2 s | 1.15× | `mediarecorder` |

**Speedup:** ~8.6–10.4× vs legacy render. Console calibration: `vp8 (alpha luma white=234, black=17, limited range)` → calibrated `lutyuv` expansion tier selected. Orchestrator: `4 segments, 7391ms (0.12× realtime), stitch 4ms`.

### Full canvas bake

| Cues | Toggle | Total | Capture | Normalize | Composite | `totalRealtimeFactor` |
|------|--------|-------|---------|-----------|-----------|------------------------|
| 20 | **ON** | **46.2 s** | 5.5 s (0.09×) | **null** | 40.7 s | **0.77×** |
| 20 | OFF | 228.2 s | 63.6 s | 145.9 s (64%) | 18.5 s | 3.80× |
| 232 | **ON** | **49.9 s** | 6.8 s (0.11×) | **null** | 43.1 s | **0.83×** |
| 232 | OFF | 310.4 s | 77.4 s | 206.9 s (67%) | 26.0 s | 5.17× |

**Speedup:** ~4.9–6.2× vs legacy full bake; ~2.9× vs v5.3.9 parallel (~145 s on similar dense clip).

### QA verdict

| Goal | Result |
|------|--------|
| Eliminate normalize on WebCodecs path | **PASS** — `normalizeMs` always null |
| Faster-than-real-time encode | **PASS** — 0.09–0.12× capture; 0.77–0.83× end-to-end bake |
| Sub-real-time 60 s rich-effects bake | **PASS** — ~46–50 s (user: ≤30 s was a ballpark; outcome accepted as full pass) |
| Visual / alpha fidelity | **PASS** — no discernible difference vs legacy; dense overlapping cues OK |
| Limited-range alpha calibration | **PASS** — probe + `burnin-webcodecs-alphamerge-unpremultiply-gray` tier |
| Legacy fallback (toggle off) | **PASS** — MediaRecorder + normalize path unchanged |
| Segment telemetry for 5.4.0 | **PASS** — timing JSON v3: `encoderType`, `encode` aggregates, `webcodecs-segment` entries |

**Post-ship bottleneck:** composite (`alphamerge` + wasm x264) is now ~88% of WebCodecs bake wall (~41–43 s). Encode and normalize are solved; further gains are composite-stage work (optional 5.4.x follow-on).

## Highlights

| Change | Detail |
|--------|--------|
| **Encoding layer** | `src/encoding/` — `encoded-segment.ts`, `ivf.ts`, `webcodecs-support.ts` (calibration probe), `overlay-webcodecs-encoder.ts` (dual VP8, backpressure, yields) |
| **Orchestrator** | `subtitle-overlay-webcodecs.ts` — reuses v5.3.9 planner; returns dual IVF + segment metas or null → MediaRecorder fallback |
| **Paint seam** | `createOverlayFramePainter` in `subtitle-overlay-renderer.ts` — encoder-agnostic, worker-portable |
| **Composite** | `overlay-alphamerge-args.ts` — 3 tiers; `subtitle-burnin.ts` `buildWebCodecsOverlayStrategies` |
| **Bake** | `subtitle-canvas-bake.ts` — `encoder: 'auto' \| 'webcodecs' \| 'mediarecorder'`; WebCodecs failure retries full MediaRecorder pipeline |
| **Flag** | `experimental.webCodecsBake` (default **false**; production `true` → `'auto'`) |
| **Lab** | "WebCodecs encode (v5.3.10)" toggle on render **and** bake; timing JSON **v3** |
| **Tests** | `test-ivf` (7) · `test-overlay-alphamerge-args` (6) · `test-encoded-segment` (5) · timing-summary (4) |

## Fallback chain

```
experimental.webCodecsBake (default off; true → auto)
  → capability + calibration probe
    → WebCodecs dual IVF encode + TS stitch
      → alphamerge composite tiers
        → on failure: mediarecorder-parallel → serial → drawtext (perf guard)
```

## Restore / test

```bash
git checkout v5.3.10 && npm install && npm run dev
node scripts/test-ivf.mjs
node scripts/test-overlay-alphamerge-args.mjs
node scripts/test-encoded-segment.mjs
node scripts/test-chunk-planner.mjs
npm run build
```

Overlay Lab → session set → WebCodecs toggle ON → render (check `webcodecs-result`, `encoderType: 'webcodecs'`) → full bake → compare timing JSON vs toggle OFF.

## v5.4.0 handoff

This release completes the **5.3.x subtitle bake performance arc** (5.3.5 cache → 5.3.8 Oklch → 5.3.9 chunking → 5.3.10 WebCodecs). The encoding backbone ships:

- **Painter** — render any global frame on demand (`createOverlayFramePainter`)
- **Segments with metadata** — `EncodedOverlaySegmentMeta` for selective re-encode
- **Worker-portable encode loop** — no DOM in the hot path
- **Instrumentation** — per-segment paint/encode/bytes in timing JSON

See design doc §0.8 and `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`.