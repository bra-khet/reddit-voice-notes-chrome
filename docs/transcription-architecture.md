# Transcription architecture (eloquent / v4)

Design audit for client-side Vosk STT in a Chrome MV3 extension (2026). Read before changing the transcription pipeline.

## Problem statement

Add optional offline subtitles without breaking the stable path:

```
record → canvas WebM → FFmpeg transcode → attach/download MP4
```

## Chrome MV3 constraints (non-negotiable)

| Surface | CSP | `unsafe-eval` | `chrome.*` APIs | Typical origin |
|---------|-----|---------------|-----------------|----------------|
| **extension_pages** (popup, harness, offscreen, design-studio) | `script-src 'self' 'wasm-unsafe-eval'` | **Forbidden** | Yes | `chrome-extension://<id>` |
| **manifest sandbox** (`sandbox.pages`) | sandbox CSP with `'unsafe-eval'` + `worker-src blob:` | **Allowed** | **No** | Opaque / `null` in iframe |
| **content scripts** (reddit.com) | Page CSP + isolated world | N/A | Limited | `https://www.reddit.com` |
| **service worker** (background) | extension_pages equivalent | **Forbidden** | Yes | extension |

**Implication:** Vosk-browser (Emscripten `new Function()` + **blob Web Workers**) cannot run on extension_pages or in the main harness bundle. It must run inside a **manifest sandbox page** with both `'unsafe-eval'` and `worker-src blob:` (see BUG-010).

**Not the same as personal-background relay:** Image relay solved Reddit **page** CSP and MV3 **message size** limits via chunked base64 + `createImageBitmap`. Transcription solves **extension** CSP eval limits via sandbox isolation + `postMessage`.

## Layer model (compositing — unchanged from v4 design)

Bottom → top in final MP4:

1. Background (canvas)
2. Audio bars (canvas)
3. Subtitles (FFmpeg burn-in pass — eloquent-3+)

STT reads **raw audio** from cloned WebM (not voice-modulated export).

## Pipeline (eloquent-0 implemented)

```
┌─────────────────────────────────────────────────────────────────┐
│ Extension page (transcribe-harness / future offscreen client)   │
│  CSP: wasm-unsafe-eval only                                     │
│                                                                 │
│  1. WebM blob (recorder capture)                                │
│  2. decodeWebmToMonoPcm() — Web Audio, no eval                  │
│  3. hidden <iframe src="vosk-sandbox.html">                     │
│  4. postMessage({ samples, modelUrl }) ───────────────┐         │
└───────────────────────────────────────────────────────│─────────┘
                                                        │
┌───────────────────────────────────────────────────────▼─────────┐
│ Manifest sandbox: public/vosk-sandbox.html                        │
│  CSP: unsafe-eval allowed                                         │
│  Origin: opaque (null) — do NOT rely on event.origin matching     │
│                                                                   │
│  public/vosk-sandbox.js (esbuild bundle, ~6 MB, vosk-browser)     │
│  5. load Vosk model from vosk/model.tar.gz (extension URL)        │
│  6. acceptWaveformFloat → segments                                │
│  7. postMessage({ TranscriptResult }) ──────────────────┐         │
└─────────────────────────────────────────────────────────│─────────┘
                                                          │
┌─────────────────────────────────────────────────────────▼─────────┐
│ Extension page receives result (validate event.source === iframe)   │
└─────────────────────────────────────────────────────────────────────┘
```

Parallel future path (eloquent-1):

```
stopRecording()
  webmBlob (validated, retained for transcode)
  webmClone = blob.slice()
  ├─ transcodeWebmToMp4(webmBlob)     → base.mp4   [existing FFmpeg queue]
  └─ transcribeWebmBlob(webmClone)    → transcript [enqueueTranscribeJob]
```

**Never** run FFmpeg and Vosk concurrently until memory is profiled (~32 MB FFmpeg heap + ~40 MB model).

## Memory & worker isolation

| Component | Queue / isolation |
|-----------|-------------------|
| FFmpeg | `enqueueTranscodeJob` — single offscreen worker |
| Vosk | `enqueueTranscribeJob` — separate serialized queue |
| Vosk WASM worker | `public/vosk-emscripten-worker.js` (packaged `'self'` script — not blob:null; IDBFS needs extension origin) |

Model load is **opt-in** (eloquent-4 UI); not at extension startup.

## Why not WXT `entrypoints/vosk.sandbox`?

WXT dev mode injects Vite HMR scripts (`http://localhost:*/@vite/client`) into HTML entrypoints. Manifest sandbox pages load with **opaque/null origin** and cannot fetch localhost scripts (CORS). Production WXT build works; **dev breaks**.

**Fix:** Static sandbox shipped from `public/`:

- `public/vosk-sandbox.html` — listed in `manifest.sandbox.pages`
- `public/vosk-sandbox.js` — esbuild bundle via `npm run build:vosk-sandbox`
- `public/vosk-emscripten-worker.js` — extracted vosk Emscripten worker (BUG-011; avoids blob:null IDB denial)
- Rebuild after changing `vosk-sandbox-host.ts` or upgrading `vosk-browser`; reload extension

## postMessage security model

Sandbox iframe has opaque origin — **do not** compare `event.origin` to `location.origin`.

| Direction | Trust model | targetOrigin |
|-----------|-------------|--------------|
| Parent → sandbox | `event.source === window.parent` (in sandbox) | `'*'` |
| Sandbox → parent | `event.source === iframe.contentWindow` (in parent) | `'*'` |

PCM buffers use `postMessage` **transferable** `ArrayBuffer` (no base64 chunking needed for ≤2:00 16 kHz mono ≈ 8 MB).

## File map

| File | Role |
|------|------|
| `src/transcription/decode-webm-audio.ts` | WebM → mono 16 kHz PCM (extension page) |
| `src/transcription/vosk-sandbox-client.ts` | iframe bridge (extension pages) |
| `src/transcription/vosk-sandbox-host.ts` | Vosk inference (sandbox only) |
| `src/transcription/vosk-sandbox-entry.ts` | esbuild entry |
| `scripts/build-vosk-sandbox.mjs` | Bundle host → `public/vosk-sandbox.js` |
| `public/vosk-sandbox.html` | Manifest sandbox shell |
| `scripts/fetch-vosk-model.mjs` | Model → `public/vosk/model.tar.gz` |
| `entrypoints/transcribe-harness/` | Manual QA |
| `src/messaging/types.ts` | `MSG_TRANSCRIBE_*` (eloquent-1 wire) |

## Dev workflow

```bash
npm install                    # model + vosk-sandbox.js + ffmpeg
npm run dev                    # WXT dev server
# After editing vosk-sandbox-host.ts:
npm run build:vosk-sandbox && reload extension at chrome://extensions
```

Open `transcribe-harness.html` → load WebM from recorder → Transcribe.

## Phase status

| Phase | Scope | Status |
|-------|-------|--------|
| eloquent-0 | Spike, types, harness, sandbox architecture | **Done** |
| eloquent-1 | Parallel wire from `stopRecording()` | Pending |
| eloquent-2 | Design Studio editor | Pending |
| eloquent-3 | FFmpeg subtitle burn-in | Pending |

See `eloquent-branch.md` for full phase plan.