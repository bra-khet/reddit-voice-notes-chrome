# Animated GIF Background Looping — Design & Implementation Phase

**Context**: Part of the ongoing v5 / UI refresh & polish work on the `dulcet` line (or main).  
**Codename / Scope**: `animated-gif-bg` (contained, low-risk feature addition)  
**Status**: Design complete — ready for implementation

---

### Purpose

Enable users to import animated GIFs as personal backgrounds. The GIF loops seamlessly and repeatedly in the exported MP4 video while changing almost nothing in the user interface or preview experience.

This is the natural next step after the schema-ready work already present in `image-db-types.ts` and `image-db.ts`. It delivers immediate user value (fun, expressive, looping backgrounds) with minimal surface area and full respect for the existing memory, preview, and fidelity contracts.

---

### Architectural Fit & Why Contained

The foundation was deliberately built for this:

- `resolveMediaKindForMime` already returns `'animated'` for `image/gif`.
- `BACKGROUND_MIME_TYPES`, `BackgroundMediaKind`, quotas (`MAX_SINGLE_IMAGE_BACKGROUND_BYTES` for GIFs, reserved video quota for later), `BackgroundAssetRecord`, and `pruneUnreferencedBackgrounds` are already kind-aware or generic.
- The import gate (`BACKGROUND_IMPORT_ENABLED_KINDS`) + explicit comments (“loops/video stored later behind a flag”, “until canvas loop support ships”) was the only blocker.
- Canvas path (`background-loader.ts`) uses `createImageBitmap` / `HTMLImageElement` + `drawImage` → first frame only. This is intentional and matches the documented “preview expressive, export quantized/approximated” philosophy (see `design-studio.md` §7.4 and `engineering-principles.md`).
- Blob relay (`BACKGROUND_BLOB_PORT`, chunked base64) and storage split (`chrome.storage.local` = ID only, IndexedDB = full blob + kind) already work for any media kind.
- FFmpeg transcode pipeline already integrates backgrounds during export and follows memory-aware patterns (separate transcode queue, semantic progress/heartbeats, wall-clock timeouts, time-sliced pre-bakes, single-pass style).

**No changes required** to core storage, relay, UI contracts, dirty tracking, or save pathways. The work is almost entirely “unlock the gate + implement the looping read-into-FFmpeg path.”

This is deliberately kept as a single contained phase (unlike the multi-branch DSP foundation work) because the risk surface is small and the value is immediate.

---

### Development Phase

#### Sub-Phase 1: Enable Import & Schema Polish (low risk, ~1–2 hours)

- In `src/storage/image-db-types.ts`:
  - Add `'animated'` to `BACKGROUND_IMPORT_ENABLED_KINDS`.
  - Update comments to reflect that animated GIF backgrounds are now supported for import and export looping (video kinds remain gated).
- In `image-db.ts`:
  - Confirm `assertImportAllowed` + `maxBytesForKind` already route `'animated'` correctly to the image quota (8 MiB). No logic change needed.
- Update `docs/engineering-principles.md` (Memory Management & Backgrounds section) and `docs/design-studio.md` (Background handling) with a short note on the new capability and the intentional preview-vs-export fidelity gap.
- Optional micro-polish: In the background status card or list item, show a subtle “Animated” or “Loops” indicator when `mediaKind === 'animated'` (only if it fits the current UI refresh without layout changes).

**Success criteria**:
- GIF files now import successfully and are stored with `mediaKind: 'animated'`.
- First-frame dimensions are correctly probed.
- All existing import, quota, prune, and reconcile behavior continues to work unchanged.

#### Sub-Phase 2: FFmpeg Export Looping Implementation (core work, ~4–8 hours)

**Goal**: Read the GIF blob into the WASM MEMFS and feed its frames repeatedly into the final MP4 as a looping background layer, using the same scale / position / dim / overlay logic as static backgrounds.

**Recommended strategy** (memory-efficient and aligned with existing patterns):

1. In the transcode command builder, detect `mediaKind === 'animated'` (fetch meta alongside blob or extend the relay payload lightly).
2. Write the GIF to MEMFS (e.g. `bg.gif`).
3. **Primary path (try first)**: Use `-stream_loop -1 -ignore_loop 0 -i bg.gif` (or equivalent) as the background input. Combine with the existing scale/pad/position/dim/overlay filter snippet and `-shortest` (or explicit duration) so the loop fills exactly the recording length.
4. **Fallback / explicit control path** (“100 ms frames easiest”): Add a tiny pre-pass that normalizes the GIF to a short, controlled loop clip:
   ```bash
   ffmpeg -y -ignore_loop 0 -i orig_bg.gif \
     -vf "fps=10,..." \
     -c:v libx264 -preset ultrafast -crf 28 \
     bg_loop.mp4
   ```
   Then use `-stream_loop -1 -i bg_loop.mp4` in the main command. This keeps peak heap comfortable inside the ~32 MB WASM limit and gives explicit frame-rate control.

5. Reuse all existing background filter logic (alignment, fit/fill, `USER_BACKGROUND_DIM_OVERLAY`, etc.).
6. Wire semantic progress, heartbeats, wall-clock timeout, and cancellation for any pre-pass (same guards used elsewhere in the transcode flow).
7. On any animated-path error: graceful fallback to static first-frame treatment with clear logging.

**Memory & performance notes**:
- `stream_loop` (or short pre-baked clip) avoids materializing thousands of frames.
- Matches existing patterns: chunked relays for large blobs, separate transcode queue, time-sliced pre-bakes (rainbow slices), and “quantized export approximations.”
- Pre-pass is fast (< 1 s for typical GIFs) and optional — start with direct `stream_loop`.

**Success criteria**:
- Exported MP4 shows the GIF looping smoothly and repeatedly for the full recording duration.
- Positioning, scaling, and dim overlay behave identically to static backgrounds.
- No regression on static image backgrounds or overall transcode stability/memory.
- Cancellation and progress reporting remain reliable.

#### Sub-Phase 3: Integration, Testing & Documentation ( ~2–4 hours)

- End-to-end tests with varied GIFs (short loop, long cycle, 1-frame, high-fps, near-max size, different aspect ratios).
- Memory stress test: max-size GIF + full-length recording.
- Confirm fallback path works cleanly.
- Final doc polish in `engineering-principles.md` and `design-studio.md` (explicitly note the preview = static first frame / export = full animation gap, consistent with other fidelity decisions).
- Optional: Add a one-line internal note explaining the design choice (canvas stays simple; looping lives in the FFmpeg export path).

**Success criteria**:
- Feature feels complete and polished.
- All tests pass, including edge cases and memory bounds.
- Documentation accurately reflects the implemented behavior and intentional gaps.

---

### Overall Success Criteria for the Phase

- Users can import animated GIFs as backgrounds with zero or near-zero UI change.
- Exported MP4 videos contain smoothly looping animated backgrounds.
- Preview and recorder canvas remain unchanged (first-frame static draw) — WYSIWYG for waveform is preserved.
- Memory usage stays within established WASM limits via `stream_loop` + optional controlled pre-bake.
- All existing contracts (storage split, relay, progress/timeout, cancellation, prune, save pathways) are respected.
- The implementation follows the project’s core principles: pipeline-native, graceful degradation, semantic health signals, documented fidelity gaps, and minimal surface area for new media kinds.

---

### Risks & Mitigations

- **WASM memory pressure on large/complex GIFs** → Primary `stream_loop` path + optional short pre-bake normalize at ~10 fps. Fallback to static on error.
- **Inconsistent preview vs export** → Explicitly documented as intentional (same pattern as other export approximations). Users get the correct deliverable (the MP4).
- **GIF decode variance in WASM** → Graceful fallback + testing across representative files.
- **Scope creep into full canvas animation** → Explicitly out of scope for this phase. Canvas animation (if desired later) would be a separate, higher-cost effort.

---

### References to Existing Patterns

- Chunked blob relay & storage split (`engineering-principles.md`)
- Semantic progress / heartbeats / wall-clock timeouts (transcode flow)
- Time-sliced / pre-bake approximations (rainbow slices, quantized export visuals)
- Fidelity gap documentation style (`design-studio.md` §7.4)
- “Schema-ready, gate later” approach used for video kinds

---