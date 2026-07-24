# Bug Archive — Prevention Index

<!--
CHANGED: Condensed full BUG-001–038 forensics into a current prevention and lookup index.
WHY: Root-cause narratives remain available in the archive, while the living layer should expose durable lessons and open risk.
-->

## Archive Notice (Living Document)

The complete symptoms, evidence, fixes, file lists, and postmortems are preserved at [`archive/docs/v6.0.0-checkpoint/living-snapshots/bug-archive.md`](../archive/docs/v6.0.0-checkpoint/living-snapshots/bug-archive.md). Milestone context lives in [`HISTORY.md`](HISTORY.md). This living file is the review index; follow the snapshot only when investigating a recurrence.

## Prevention rules by bug class

<!--
BUG FIX: Profile Reset looked busy while clean and could not restore Custom defaults
Fix: Added BUG-040 and made reset enablement derive from a real saved-snapshot or Custom-default destination.
Sync: design-studio.md; reset-semantics.md; TODO.md; claude-progress.md
-->

| Class | BUG IDs | Rule that remains active |
|-------|---------|--------------------------|
| Media validation, jobs, progress | 001–007 | Validate semantic artifacts; serialize jobs; distinguish liveness from progress; cancel/supersede explicitly; keep fallback tiers honest |
| Preference/UI save races | 008–009, 016–024, 027, 039–040 | Hydrate before mounting; serialize preference writes; keep session transcript separate from profiles; preserve branching save/reset pathways; derive action state from a real destination rather than saved identity alone |
| Vosk/CSP/terminal lifecycle | 010–015, 018, 026, 032, 034, 038 | Keep Vosk in the manifest sandbox; validate each origin boundary; serialize boot; let background own terminal persistence/watchdog |
| Subtitle composite fidelity | 025, 028, 030–031, 035–036 | Prefer shared canvas painter; bound drawtext layers; use punctuation-safe text files; preserve frame pacing and explicit fallback |
| Development tooling | 037 | Keep ignored bulk artifacts outside WXT watch paths on Windows |

## Bug lookup

| ID | Short description | Durable owner |
|----|-------------------|---------------|
| BUG-001 | Cap-stop transcode hang / permanent failure | Media validation + queue |
| BUG-002 | Detached `ArrayBuffer` | Binary ownership |
| BUG-003 | Client timeout on healthy jobs | Progress/timeout semantics |
| BUG-004 | Valid WebM rejected by preflight | Semantic validation |
| BUG-005 | Orphan jobs, double send, progress flicker | Cancellation/serialization |
| BUG-006 | Heartbeats mask an infinite stall | Semantic health |
| BUG-007 | FFmpeg frame-duplication storm | Timestamp validation/fallback |
| BUG-008 | Blank settings popup | UI boot safety |
| BUG-009 | Intensity slider drops bundled preset | Config resolution |
| BUG-010 | Vosk blob worker blocked by CSP | Sandbox topology |
| BUG-011 | Vosk IDBFS unavailable in blob worker | MEMFS fallback |
| BUG-012 | Vosk UMD import undefined | Sandbox bundling |
| BUG-013 | Null-origin sandbox cannot spawn extension worker | Blob-worker topology |
| BUG-014 | Invalid model URL base in blob worker | Absolute asset URLs |
| BUG-015 | Empty transcript after successful load | Inference drain/validation |
| BUG-016 | Subtitle prefs lost across Studio sessions | Preference ownership |
| BUG-017 | Subtitle toggle reverts on exit/discard | Teardown/save separation |
| BUG-018 | Transcribe timeout / empty segments | Terminal classification |
| BUG-019 | Subtitle flag lost in preference RMW | Serialized atomic update |
| BUG-020 | Stale transcript respawn / profile dirty | Session/profile separation |
| BUG-021 | Profile UI regression from dirty coupling | Independent dirty layers |
| BUG-022 | Profile style not applied on select | Hydration/apply order |
| BUG-023 | Studio UI stale while prefs are correct | Listener gates |
| BUG-024 | `getDraftConfig` aborts apply | Boot-path reference safety |
| BUG-025 | Bake succeeds with no visible subtitles | Pixel/semantic verification |
| BUG-026 | Recorder stuck at transcribing 80% | Terminal relay |
| BUG-027 | False Update-profile highlight | Normalized equality |
| BUG-028 | Glow bake invisible / misaligned | Painter fidelity |
| BUG-030 | Backdrop fix reintroduces silent burn-in | Strategy validation |
| BUG-031 | Drawtext fails on punctuation | `textfile=` |
| BUG-032 | No tab registered for relay | Relay ownership |
| BUG-034 | Cold-start transcription dispatch race | Serialized offscreen boot |
| BUG-035 | Drawtext filtergraph explosion | Layer budget/degradation |
| BUG-036 | Cue-cache subtitle timing drift | Non-blocking cache fill + pacing |
| BUG-037 | WXT dev crash watching ignored bulk files | Watch-scope hygiene |
| BUG-038 | Transcript lost after initiating tab closes | Background terminal owner |
| BUG-039 | Custom profile Save changes action hidden | Profile save-action policy |
| BUG-040 | Profile Reset busy while clean / inert for Custom | Profile reset destination policy |

BUG-029 and BUG-033 were never assigned in the preserved ledger.

## Open watch item — profile subtitle semantics

Legacy profiles may still lack embedded `transcriptConfig`; session transcript text remains intentionally outside profile blobs. Do not restore BUG-021’s eager transcript flush or couple session draft text to profile dirty state without a queue/hydration review.

The current profile-actions/reset ideas live in [`future-ideas.md`](future-ideas.md). DEF-001 records the accepted adversarial cold-start residual.

## Recurrence protocol

When a bug class recurs:

1. read the full archived entry;
2. identify which current invariant or seam failed;
3. update the owning living architecture doc;
4. add a new BUG ID only for a materially new root cause;
5. keep the original entry immutable.
