# Reddit Voice Notes — Session Progress

## Archive Notice (Living Document)

This is the **living** progress file, focused on work **after v5.10.0 (Raw Trim Apply)**. Completed sprint-by-sprint history is preserved verbatim:

- v5.9.0 → v5.10.0 raw-trim-apply arc (incl. real-browser QA): [`archive/progress/claude-progress-through-v5.10.0.md`](archive/progress/claude-progress-through-v5.10.0.md)
- v5.8.0 → v5.9.0 timeline-and-trim arc: [`archive/progress/claude-progress-through-v5.9.0.md`](archive/progress/claude-progress-through-v5.9.0.md)
- v5.4.0 → v5.7.0 editing-suite arc: [`archive/progress/claude-progress-pre-v5.8.0.md`](archive/progress/claude-progress-pre-v5.8.0.md)
- v1.0.0 → v5.3.10 history: [`archive/progress/claude-progress-pre-v5.4.0.md`](archive/progress/claude-progress-pre-v5.4.0.md)
- Milestone index: [`docs/HISTORY.md`](docs/HISTORY.md)

The full prior content is intact so this file can stay small and actionable. Add new session entries below the current-work section; run `/docs-archiving` (Refresh) after the next tagged milestone or major feature.

## Baseline — v5.10.0 Raw Trim Apply (**SHIPPED · QA PASS · tagged**)

**Stable:** `v5.10.0` · **Tag:** `v5.10.0` · **Code:** 2026-07-11 · **Real-browser QA:** **PASS 2026-07-12** · **Push:** deferred (user pushes)

**Apply trim** now cuts the raw capture WebM with the base MP4: pure `planRawTrimLeg` gate → `applyTrimToWebM` (mediabunny, **audio-only** Opus) → fresh `baseRecording` stamp in the same atomic write. **Post-trim voice re-apply / Change Voice work again.** Raw-leg failure demotes honestly to the v5.9 stamp-drop lock and never fails the MP4 trim. `rawAudio: 'trimmed' | 'dropped' | 'none'`. Zero Voice-panel code — unlock is emergent (H6 stamp + `savedAt` poll).

Authoritative references:

- As-built design: [`docs/v5.10.0-raw-trim-apply-roadmap.md`](docs/v5.10.0-raw-trim-apply-roadmap.md) §10
- Release notes: [`docs/release-notes-v5.10.0.md`](docs/release-notes-v5.10.0.md)
- Prior leg (atomic MP4 apply): [`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md); notes *(archived)* [`archive/docs/release-notes-v5.9.0.md`](archive/docs/release-notes-v5.9.0.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md) — map **v2.8**, extension-points **v1.10**, backlog **v2.6**, ADRs 0001–0005
- Full shipped ledger: [`docs/HISTORY.md`](docs/HISTORY.md)

**Verify (at ship):** timeline **22** · take-manager **34** · Node sweep green · `npm run build` PASS @ 5.10.0 · `tsc` = 3 documented pre-existing. **No post-QA code fixes.**

**QA note (accepted, not a defect):** manual DevTools delete of `rvnLastRecording` can leave the open path stale until a full extension reload — normal users never nuke IDB by hand.

## H13 + H14/BUG-038 hardening — **MERGED to main (2026-07-12) · no version bump**

**Branch:** `feature/h13-persist-before-stamp` (from tagged `v5.10.0`) → **`main`**.  
**Scope:** architecture hardening only — **not a release**; package remains **5.10.0**.

### H13 — persist-before-stamp (**RESOLVED · browser QA PASS**)

`saveLastBaseMp4` / `saveLastBakedMp4` / `saveLastRecording` **throw** on unpersistable size (bounds exported: `LAST_BASE_MP4_*`, `LAST_BAKED_MP4_*`, `LAST_RECORDING_*`) and **propagate IDB failures**, and return **authoritative persisted meta** (`savedAt`/`byteLength`/`mimeType`/`durationSeconds`; non-finite duration → 0). Four mutation choke points stamp/signal **only** from that meta:

- `background.ts` — both save handlers (failed save → honest `ok:false`, no stamp, no `LAST_RECORDING_READY`) + `persistOrphanStudioTranscodeResult`
- `subtitle-bake.ts` — `BAKED_MP4_READY_KEY` + take promotion from returned meta (`TakeBakeResult.savedAt` → `updateFromBake`)
- `voice-reapply.ts` — both commit stamps from returned metas
- `trim-apply.ts` — base stamp from meta; raw-leg **save** failure demotes to honest v5.9 stamp-drop (I19 IDB half) and never fails the trim

H6 reads untouched. Bonus: fixed pre-existing `background.ts` TS2345 on orphan path (`tsc` 3 → 2).

**Node:** `test-artifact-store-writes.mjs` **28/28**.

### H14 / BUG-038 — tab-close transcript (**RESOLVED · browser QA PASS**)

Exposed by H13 QA item 7: Vosk/`Transcribe job finished` succeeded, but the initiating page owned COMPLETE → IDB save + timeout, so closing the tab dropped both the real transcript and the scaffold. Fix:

- Background retains accepted-job terminal context (duration/language) + **125 s** watchdog
- `prepareTranscribeCompletionForPersistence` normalizes success / timeout / inference scaffolds off the page
- Persist to `rvnSessionTranscript` **before** `SESSION_TRANSCRIPT_READY_KEY`; cancelled/superseded/late jobs cannot publish
- Studio pagehide **detaches** while STT pending (no accidental CANCEL); page-local guard 135 s so it cannot race the background owner
- `saveSessionTranscript` rethrows IDB failures (no ready after failed write)
- **No Retry UI** — Vosk was healthy; retry would mask the missing terminal owner

**Node:** `test-transcribe-failure.mjs` **12/12**. **Real-browser:** user confirmed transcript survives tab close mid-processing (cases that previously failed).

### Docs at merge

Map **v2.11** · extension-points **v1.12** · backlog **v2.9** · bug-archive BUG-038 verification closed · design-studio / transcription-architecture carry-forwards refreshed.

### Other open work

1. **▶ Next: H8 browser A→B acceptance re-run** (implementation complete below).
2. Then scope **v6.0 “Polish & Visual Maturity”** ([`docs/v5.9.0-trim-apply-roadmap.md`](docs/v5.9.0-trim-apply-roadmap.md) §9).
3. Optional: user **push** of `main` (and any remote tags still deferred from v5.10).

## H8 recovery voice provenance — **RESOLVED in code 2026-07-12 · no version bump**

**Branch:** `feature/h8-recovery-voice-provenance` from `main` @ v5.10.0 + H13/H14. Product/package remains **5.10.0**.

### Consultation / repro notes (user QA)

- **Normal Stop → finish / tab-close while job lives:** voice is bound at **Stop**; orphan persist finishes that job. Switching profiles mid-flight does **not** retarget it. **Not H8.**
- **H8 path:** first job **dies incomplete** (hard extension reload / crash) → draft + `baseRecording`, no `baseMp4`, `inflight === false` → `resumeDraftTranscodeInner` starts a **new** transcode with **`prefs.voiceEffect` at resume**.
- **User repro:** hard-reload mid-transcode → edit `rvnUserPrefs` / `voiceEffect` in DevTools → reopen Design Studio → recovered MP4 uses the **new** voice. Confirmed this *is* H8.
- **Why hard to hit in product UI:** voice prefs are primarily written from Design Studio (`saveVoiceEffectPreferences` in `voice-controls.ts`); opening Studio also kicks recovery. Changing prefs *before* resume without DevTools is awkward today. Practical user incidence is low; value is **correctness + future-proofing** (new settings surfaces, multi-page, crash then later prefs edit) so recovery does not silently depend on “prefs only change inside Studio after mount.”

### Implementation

`CurrentTake.captureVoiceIntent` is an optional, JSON-safe additive field with normalized voice config + `voiceEffectUserIntentKey`; TakeManager parses it as an opaque object and remains dependency-free. Recorder writes it in the initial `beginTake`, then refreshes it in an **awaited atomic processing patch before transcode** and passes that exact config to the first job. Recovery prefers the take-owned config, promotes capture-origin `TakeVoiceStamp` (including FFmpeg fallback) with `ready`, and loads current prefs only for legacy drafts. The ready deck now surfaces the legacy fallback note.

No Retry UI, multi-take history, rendered-audio blob, new store/key/message/context, H10 work, or v6 polish.

### Verification / carry-forward

- `node scripts/test-take-manager.mjs`: **37/37** (capture intent parse/malformed/merge)
- `node scripts/test-take-deck.mjs`: **13/13** (legacy ready note visible)
- `npm run build`: **PASS** at package 5.10.0
- `npx tsc --noEmit`: only **2 pre-existing** subtitle errors; no H8 error
- Manual pending: capture A → hard reload mid-transcode → set prefs B → reopen → recovered MP4 must sound like A; legacy snapshot without the field may use current prefs but must show the note
- Architecture: map **v2.12** · extension points **v1.13** · backlog **v2.10**

### Architecture hardening — v5.9→v5.10 incremental refresh (2026-07-12) — **DONE** (superseded by H13/H14 merge above)

Use [`TODO.md`](TODO.md) as the compact task ledger. Complete H8 browser acceptance before scoping v6.0.
