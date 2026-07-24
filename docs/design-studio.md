# Design Studio — Current Product Contract

<!--
BUG FIX: Profile Reset looked busy while clean and could not restore Custom defaults
Fix: Recorded the dormant clean key and the atomic product-default destination for Custom setups.
Sync: reset-semantics.md; TODO.md; claude-progress.md
-->

## Archive Notice (Living Document)

The full pre-condensation reference—including legacy layouts, v4 assets, shipped plans, module histories, and QA notes—is preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/design-studio.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/design-studio.md). Historical source paths are mapped in [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md); milestones are indexed by [`HISTORY.md`](HISTORY.md).

## Product workflow

The canonical mental model is:

1. **Design** — choose Style, Background, Voice, and Subtitle appearance.
2. **Capture** — record in the extension or hosted Studio; record-time visuals become base-video pixels.
3. **Polish** — edit cues/timeline, trim, re-apply voice when raw audio is available, bake captions, and download/attach.

The extension Studio and hosted Studio mount the same `src/ui/design-studio/` source. The hosted surface is another host for the Studio context, not another product implementation.

## Surfaces

| Surface | Role | Storage origin |
|---------|------|----------------|
| Extension Design Studio | Full authoring, capture, polish, Reddit handoff | Extension origin |
| Hosted `/design-studio/` | Install-free full Studio and download | Pages origin, isolated from extension data |
| Reddit recorder panel | Capture/attach entry using shared preferences and renderer | Content script + background relays |
| Hosted `/studio/` Voice Lab | Voice-only audition and clipboard round-trip | Pages origin |

Hosted deployment details live in [`static-voice-studio-design.md`](static-voice-studio-design.md).

## Boot and lifecycle

```text
loadUserPreferences()
  → reconcileBackgroundPreferences()
  → mountClipStudio(app, { initialPrefs })
  → enable storage-driven updates after hydration

pagehide
  → unmount()
  → flush only the owning debounced writers
```

Rules:

- Never mount before normalized/reconciled initial preferences exist.
- Preference mutations serialize through `enqueuePrefsOp`; IDB commits precede `rvnUserPrefs.v2` publication.
- Ignore storage echoes during local saves and before hydration.
- Use `pagehide`, not `unload`, for teardown.
- Do not flush transcript session text into profile save/update paths.

## Durable state ownership

| State | Durable owner |
|-------|---------------|
| Global prefs, profiles, custom styles | `rvnUserPrefs` IDB: `global`, `profiles`, `customStyles` |
| Preference revision/migration signal | `chrome.storage.local` → `rvnUserPrefs.v2` |
| Subtitle enabled flag | `rvn.subtitles.enabled` |
| Workflow phase | `rvn.workflow.phase` |
| Current take metadata/status/stamps | `TakeManager` → `rvn.take.current` |
| Personal backgrounds | `rvnImageDb` |
| Raw capture | `rvnLastRecording` |
| Session transcript | `rvnSessionTranscript` |
| Clean/current base MP4 | `rvnLastBaseMp4` |
| Baked MP4 | `rvnLastBakedMp4` |

Preferences never contain media blobs or session cue text. The take snapshot never contains blobs; it references artifact stores through H6-verified stamps. Store commits finish before stamps/signals are published.

## Preview, capture, and composition

Preview/output is a product promise:

- Studio preview and record-time capture share theme resolution, background draw, audio-reactive visual registries, and `designOverrides`.
- Studio-native recording displays the actual capture canvas.
- Background layout is Design-phase only and is painted into the base video.
- Captions are a post-base layer painted by the shared subtitle painter at exact media PTS.
- Voice affects the audio track; re-apply remuxes newly rendered audio under existing video.

Final order is:

1. theme/personal background;
2. atmosphere → ordered accents → spectrum;
3. post-base captions.

There is no fourth visual layer. Reduced motion, High Contrast, caption-safe dim, and performance-governor behavior must match preview and capture.

## Panel contracts

### Style

- Six spectrum presets, seven atmosphere overlays plus Clean, and up to three ordered accents.
- `DesignOverrides` is the persisted customization surface; saved styles are named snapshots.
- **Return path** restores the selected saved snapshot (or unsaved Custom starter), or detaches the custom layer to reveal its bundled base preset; saved Style entities are never deleted by reset.
- The registry-backed governor reports Comfortable, Elevated, or Guarded cost. Guarded may suspend the costliest active accent without rewriting the saved list.
- Identity changes reset per-canvas runtime state; tuning changes preserve bounded smoothing/history.

Canonical structural decisions: [ADR-0007](architecture/adr/0007-audio-reactive-visualizer-core.md), [ADR-0009](architecture/adr/0009-registry-native-sparkle-bokeh.md), and [ADR-0010](architecture/adr/0010-bubbles-label-stable-bokeh-id.md).

### Background

- Personal images and animated GIFs share the ImageDB identity/storage/relay path.
- Normalized layout owns continuous position/scale, dim, blur, blend, solid plate, Holo, GIF behavior, and safe-text lock.
- Drag, zoom, precision controls, presets, undo/redo, and sampling all feed the same normalized layout.
- Crop/thirds, theme-only compare, and next-take A/B are transient Studio aids.
- Missing media falls back to the theme and never blocks recording.

Canonical decision: [ADR-0008](architecture/adr/0008-background-direct-manipulation-layout.md).

### Voice

- A voice is a graph or character preset resolved through the graph-native DSP contract.
- “Test with my voice,” Voice Lab audition, base transcode, and voice re-apply use the same graph builder.
- Character lock guards voice mutations without freezing unrelated panels.
- Clipboard import/export uses a versioned normalized envelope.

Canonical subsystem: [`dsp-foundation-design.md`](dsp-foundation-design.md).

### Subtitles and timeline

- Session transcript text/timing lives in transcript IDB; profiles retain only subtitle enable/style configuration.
- The timeline and list edit one `TranscriptResult` draft.
- Cue movement/resize snaps to the painter frame grid.
- Trim preview and Apply share cue-projection math.
- Bake prefers browser full composite, then the permanent fallback ladder.

Canonical subsystem: [`transcription-architecture.md`](transcription-architecture.md).

## Dirty-state and save semantics

Keep four independent layers:

| Layer | Persist target | Blocks Done | Blocks bake |
|-------|----------------|-------------|-------------|
| Profile | Saved profile | Yes | No |
| Custom style | Saved style | Yes | No |
| Transcript panel | Session transcript IDB | No | Yes |
| Segment modal | Applies to transcript draft | No | No |

<!--
BUG FIX: Custom (unsaved) profile edits had no primary save action
Fix: The reserved Save changes key now opens the existing Add-current dialog for a changed unsaved setup; saved profiles retain confirmed in-place updates.
Sync: mount-clip-studio.ts; profile-actions-menu.ts; TODO.md; claude-progress.md
-->
Named profiles/styles preserve four actions: first save, confirmed update, clean clone, and dirty fork/save-to-new. The Profile control deck groups Add, strategy-based Import, Rename, Clone / dirty Save as new, Export, and Delete in one accessible menu. Add can snapshot the current setup or start from clean product defaults. Add/Rename/Clone/Delete share one dialog primitive; Delete receives an emphasized second step. **Save changes** stays outside the menu in a reserved slot: for a changed `Custom (unsaved)` setup it opens the Add dialog with **Current setup** selected; for a dirty saved profile it retains the confirmed in-place update.

<!--
BUG FIX: Profile Reset looked busy while clean and could not restore Custom defaults
Fix: The reset key is now native-disabled while clean, restores saved snapshots when named, and restores all product-default Profile fields when Custom.
Sync: reset-semantics.md; profile-actions-menu.ts; mount-clip-studio.ts
-->
The neighboring reset key always occupies its reserved column but becomes active only when the selected setup has changes to discard. A dirty saved profile reapplies its snapshot through `applyClipProfile()`; a dirty `Custom (unsaved)` setup atomically restores product-default Style, Background, Voice, and Subtitle settings without deleting saved libraries or uploaded media. The four-column row never wraps. Profile writes continue through the serialized preference coordinator and existing normalizers.

Reset operations distinguish **Restore defaults** from **Clear override** only when both destinations are real. Background restores normalized layout while retaining selected media, or reveals the active theme without deleting the upload. Style restores its authored source, or detaches the custom layer and resolves the bundled base preset without deleting the saved Style. Both use the shared top-layer choice sheet and normal appearance writer; profile identity, transcript, take, and unrelated settings remain untouched. Canonical inventory and copy: [`reset-semantics.md`](reset-semantics.md).

## Preferences transfer

Export remains one complete, versioned, normalized preferences snapshot. Import presents two explicit strategies before the native file picker:

- **Merge with this Studio** (recommended): imported global/active settings take effect; unmatched local profiles and custom styles remain. An incoming entity replaces a local entity when either its stable ID or its trimmed, case-insensitive name matches. Style conflicts resolve before profiles, and retained local profiles are relinked if a same-name incoming style has a different ID.
- **Replace all preferences:** restore the imported snapshot exactly. Profiles and styles absent from the file are removed after an additional destructive confirmation.

Both paths validate the same v1 envelope, strip session transcript content, normalize styles before profiles, preserve the 12-profile/12-style caps, and commit once through `enqueuePrefsOp`. A merge that would exceed either cap fails before subtitle flags, IDB records, or the revision signal change; the user must delete entities or choose Replace. This is local deterministic union—not cloud sync, history reconciliation, or a CRDT.

## Integration rules

- Before changing a panel seam, read [`architecture/extension-points.md`](architecture/extension-points.md).
- Use existing normalizers, storage coordinators, save-pathway helpers, and UI primitives.
- New record-time visuals must register in the shared renderer, declare bounded cost, and pass preview/capture parity.
- New hosted behavior must preserve the host-neutrality rules and Pages build gate.
- New caption behavior must declare canvas/drawtext fallback expectations.
- Do not reopen a completed roadmap as current canon; link its archived artifact from [`archive/docs/MANIFEST.md`](../archive/docs/MANIFEST.md) when historical detail is needed.
