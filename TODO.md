# TODO

## v5.4.0 — Design Studio First — **NEXT**

**Roadmap:** [`docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`](docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md)  
**Baseline:** `main` @ `v5.3.10`

Studio-native recording, persistent take management, standalone export. Reuse v5.3.10 encoding backbone (`createOverlayFramePainter`, `EncodedOverlaySegmentMeta`, WebCodecs orchestrator) — see design doc §0.8.

| Phase | Scope | Status |
|-------|-------|--------|
| Prep | `TakeManager` + session storage + messaging sync | pending |
| 1 | Current Take status strip + Download MP4 on main studio screen | pending |
| 2 | Re-record / live mic preview in main preview area | pending |
| 3 | Reddit as optional output target (not recording gateway) | pending |
| 4 | Polish, progressive disclosure, demo parity | pending |

**Optional before/during 5.4.0:** enable `experimental.webCodecsBake` default in production; composite-stage perf (~43 s alphamerge wall).

## v5.3.10 — WebCodecs Per-Chunk Encoding — **MERGED & TAGGED**

**Tag:** `v5.3.10` on `main` · **Release notes:** [`docs/release-notes-v5.3.10.md`](docs/release-notes-v5.3.10.md)  
**Design:** [`docs/5.3.10-webcodecs-per-chunk-encoding.md`](docs/5.3.10-webcodecs-per-chunk-encoding.md) §0 · **ADR:** [`docs/architecture/adr/0001-webcodecs-encoding-backbone.md`](docs/architecture/adr/0001-webcodecs-encoding-backbone.md)  
**Branch:** merged `feature/v5.3.10-webcodecs-encoding` (2026-07-05)  
**Push:** deferred (local tag + merge only)

| Deliverable | Status |
|-------------|--------|
| Dual VP8 WebCodecs encode + IVF stitch + alphamerge composite | **done** |
| Normalize eliminated on WebCodecs path | **done** |
| Calibration probe + fallback chain | **done** |
| Timing JSON v3 + Lab toggle on both buttons | **done** |
| User QA (`.ignore/sub-QA-5.3.10/`) | **done** — 46–50 s sub-real-time bake; visual pass |

## v5.3.9 — Parallel Chunked Bake — **MERGED & TAGGED** (`v5.3.9`)

**Release notes:** [`docs/release-notes-v5.3.9.md`](docs/release-notes-v5.3.9.md)

## v5.3.8 — Oklch — **TAGGED** (`v5.3.8`) · v5.3.7 — **TAGGED** (`v5.3.7`) · v5.3.6 — **TAGGED** (`v5.3.6`)

### Restore / test (v5.3.10)

```bash
git checkout v5.3.10 && npm install && npm run dev
node scripts/test-ivf.mjs
node scripts/test-overlay-alphamerge-args.mjs
node scripts/test-encoded-segment.mjs
node scripts/test-chunk-planner.mjs
npm run build
```

Overlay Lab → WebCodecs toggle ON → session set → render + full bake.

**Next push when ready:** `git push origin main --tags`