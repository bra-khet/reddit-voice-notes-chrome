# Hardening Backlog — Reddit Voice Notes

**Version:** v1.0 · **Updated:** 2026-06-24 · **Reflects:** `eloquent` (eloquent-5 hardening)  
**Status:** Ranked list of targeted hardening items for v4 completion. Each item cites evidence,
ROI score, blast radius, and explicit non-goals. Scored: `(impact × bug_likelihood) ÷ cost`.

Items are updated in place. Add new items here; never fork to `hardening-backlog-v2.md`.

---

## Summary table

| # | Item | ROI | Status |
|---|------|-----|--------|
| H1 | `subtitle-effects.ts` undefined argument to `normalizeHexColor` | High | **Resolved** (this session) |
| H2 | `voice-recorder.ts:400` dead `phase === 'error'` branch | High | **Resolved** (this session) |
| H3 | `vosk-sandbox-host.ts` discriminated union narrowing | Med | **Open** |
| H4 | Relay-registry production smoke: SW restart scenario | Med | **Open** |
| H5 | Binary transport / 3:00 cap restoration (BUG-001 deferred) | Low (post-v4) | **Deferred** |

---

## H1 — `subtitle-effects.ts` undefined argument (RESOLVED)

- **Item / class it kills:** `undefined` passed where `string` required → runtime TypeError in subtitle preview/bake on edge-case style configs
- **Evidence:** TS errors at `src/transcription/subtitle-effects.ts:92,114` — `normalizeHexColor(specialHue)` where `specialHue?: string`; TypeScript `TS2345`
- **Invariant it protects:** preview=bake — subtitle style rendering must not crash silently on optional fields
- **Surgical change:** Guard both call sites with `?? DEFAULT_SUBTITLE_SPECIAL_HUE` on the argument side (not the result side). Two lines changed.
- **Blast radius:** `src/transcription/subtitle-effects.ts` only; no cross-context change; compile-check sufficient
- **Verification hook:** `npm run compile` passes at both affected lines; bake smoke with `specialHue` unset
- **Out of scope / Non-goals:** Full `SubtitleStyleConfig` optional-field audit; normalizing the whole config schema at parse time — that's a larger refactor not needed for v4 ship
- **Resolution commit:** Pending (see Phase 3 code changes below)

## H2 — `voice-recorder.ts:400` dead error-state branch (RESOLVED)

- **Item / class it kills:** Dead branch masking a missing error check — the `this.phase === 'error'` comparison can never be true at that point (phase is `'processing'`; `transcodeToMp4` throws on error rather than setting phase)
- **Evidence:** TS error `src/recorder/voice-recorder.ts:400` — `'"recording"' and '"error"' have no overlap` (TypeScript `TS2367`)
- **Invariant it protects:** Semantic correctness of the recorder state machine — no silent dead code in the stop path
- **Surgical change:** Remove `|| this.phase === 'error'` from the condition; `isSuperseded(stopEpoch)` already handles all valid abort cases
- **Blast radius:** `src/recorder/voice-recorder.ts` only; no cross-context change
- **Verification hook:** `npm run compile` passes at line 400; record-stop smoke test
- **Out of scope / Non-goals:** Full recorder state machine audit; `phase` type refactor — just remove the dead comparison
- **Resolution commit:** Pending (see Phase 3 code changes below)

## H3 — `vosk-sandbox-host.ts` discriminated union narrowing (OPEN)

- **Item / class it kills:** Property access on wrong union variant — `.result` and `.error` accessed on `ModelMessage` without narrowing the discriminated union (`ServerMessageLoadResult | ServerMessageError`). If Vosk reports an error, accessing `.result` (which doesn't exist on `ServerMessageError`) could yield `undefined` silently rather than surfacing the error.
- **Evidence:** TS errors `src/transcription/vosk-sandbox-host.ts:49,56` — `Property 'result' does not exist on type 'ModelMessage'` / `Property 'error' does not exist on type 'ServerMessageLoadResult'`
- **Invariant it protects:** Transcription error handling — Vosk sandbox errors must surface (not silently produce empty transcripts)
- **Surgical change:** Add discriminant guard on the message type (e.g. `if ('error' in msg)` or check a `type` field); update access to be type-safe. ~5 lines in `vosk-sandbox-host.ts`.
- **Blast radius:** `src/transcription/vosk-sandbox-host.ts` only; affects Vosk error path in offscreen doc; no UI changes
- **Verification hook:** `npm run compile` clears errors at 49/56; transcribe harness with forced error (e.g. bad model URL) must surface error not silent empty transcript
- **Out of scope / Non-goals:** Full `ModelMessage` type redesign; adding new Vosk error categories — just fix the narrowing at existing access sites
- **Priority for v4:** Medium — Vosk already has BUG-015 fixes for empty transcript; this covers the structural type hole in the error branch. Worth fixing before `eloquent → main` merge.

## H4 — Relay-registry production smoke: SW restart scenario (OPEN)

- **Item / class it kills:** BUG-032 relay-drop-on-failure class recurrence — the fix uses `browser.storage.session` for `jobId→tabId` persistence across MV3 service worker restarts, but this has only been tested under WXT dev HMR restarts, not a clean production SW termination/restart cycle
- **Evidence:** BUG-032 fix (`src/messaging/relay-registry.ts`); Phase-2 confidence ledger "Med" for relay-registry production persistence; `resolveRelayTabId` late-bind fallback to active Reddit tab exists but is untested in production
- **Invariant it protects:** I4 (failure broadcast before relay map cleanup) — if the session key is lost on SW restart, relay has a fallback; but the fallback (find active Reddit tab) may pick the wrong tab in multi-tab scenarios
- **Surgical change:** No code change required. QA step: (1) start a recording in production build, (2) open `chrome://serviceworker-internals`, force-terminate the extension SW, (3) complete or cancel the recording, (4) verify progress/complete reaches the Reddit tab. If fallback fires, check it finds the correct tab.
- **Blast radius:** QA only (no code change unless the smoke test fails)
- **Verification hook:** Manual QA as above; log `[RVN relay]` messages to confirm session storage lookup
- **Out of scope / Non-goals:** Persistent relay across browser restarts (not needed — SW is reinstated when extension tab is active); multi-window tab disambiguation (post-v4)
- **Priority for v4:** Medium — production builds have seen fewer relay issues than dev HMR (where SW restarts are frequent), but the gap is still a known unverified assumption.

## H5 — Binary transport / 3:00 cap restoration (DEFERRED — post-v4)

- **Item / class it kills:** BUG-001 class — base64 WebM relay at ~15 MB for a 3:00 cap recording causes payload ceiling issues, peak memory spikes, and potential cap-stop corruption cascades
- **Evidence:** BUG-001 deferred architectural rework list; current 2:00 cap enforced for pipeline stability
- **Invariant it protects:** state ownership (blobs should not cross extension messaging boundaries as full base64 strings)
- **Surgical change (if prioritized):** Four coordinated changes — chunked binary transport, lower waveform video BPS, cap-stop WebM integrity guarantee, chunked MP4 return path. Each is a sprint-sized task; they interact.
- **Blast radius:** Very high — touches `src/messaging/binary.ts`, `entrypoints/background.ts`, `src/ffmpeg/ffmpeg-runner.ts`, `src/recorder/voice-recorder.ts`, offscreen. Cross-context changes.
- **Verification hook:** Record 2:30 then 3:00 successfully; verify base64 ceiling not hit in console; smoke test attach
- **Out of scope / Non-goals (in v4 cycle):** Do not attempt within `eloquent` branch. The 2:00 cap is stable; 3:00 is a post-v4 feature. Attempting a partial fix risks another BUG-001/002 cluster before the v4 merge.
- **Explicit rejection reason:** Impact is real, but the cost spans multiple contexts and multiple sprints. v4 already ships at 2:00, which is sufficient for the Reddit voice-note use case. Restoring 3:00 is follow-on work on a clean `main`-based branch.

---

## Resolved items (archive)

| Item | Sprint | Resolution |
|------|--------|-----------|
| Timeout UX lockout — status strip + banner | eloquent-5 | `showOpenPanel = true` for error/no-speech; labels updated |
| `'missing'` needle too broad in `burnInLogIndicatesFailure` | eloquent-5 | Replaced with `'required option is missing'` + `'no output streams'` |
| Font loader single-point-of-failure | eloquent-5 | Per-font `try/catch` in `loadOneFont`; cached promise always resolves |
| `canBakeNow()` locks user out when Vosk fails | eloquent-3/5 | Delivery status gate removed; any confirmed cues allow bake |
