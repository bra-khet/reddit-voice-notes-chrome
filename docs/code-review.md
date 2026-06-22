# /code-review — Repository Review Gate

**Purpose:** Provide a stable, repeatable review process before non-trivial changes, phase advances, or merges. Guarantees a known-good restore point if work goes off the rails.

**Invocation:** Reference this file as the `/code-review` checklist (copy its steps into your prompt or run manually before committing risky work).

## Mandatory First Step: Name Your Stable Fallback Tag

Before editing any pipeline, storage, profile, or worker code:

1. Run `git tag --list | sort` (or `git tag`).
2. Pick **one** tag you will restore from if things break.
3. Write it down explicitly in your session notes / commit message.

**Current recommended stable fallbacks (2026-06-22):**

| Use case                        | Tag                        | Branch | Notes |
|---------------------------------|----------------------------|--------|-------|
| General stable baseline         | `v3.1.0`                   | main   | Latest release (Design Studio + voice + parallel transcription wire). Full `npm run build && npm run zip` verified. |
| Profile / subtitle / prefs work on eloquent | `eloquent-profile-nominal` | eloquent | User-verified: profiles, HSV, backgrounds, Save/Update/Clone, voice, subtitles toggle. See `docs/eloquent-profile-handoff.md`. |
| Earlier solid releases          | `v3.0.0`, `v2.0.0`         | main   | Full prior milestones. |
| Transcription spike             | `eloquent-0-vosk-spike`    | eloquent | Vosk sandbox verified in isolation. |

**Restore recipe (any tag):**
```bash
git checkout <tag>
npm install
npm run build:vosk-sandbox   # if touching transcription
npm run dev
# Then reload the unpacked extension from .output/chrome-mv3-dev
```

If the current working tree is dirty or on a long-lived branch, consider a fresh clone or `git worktree add` for the restore test.

## Pre-Change / Pre-Phase Checklist (Run Every Time)

- [ ] **Fallback tag named** (see above) and recorded.
- [ ] `git status` is clean or changes are intentionally scoped and committed.
- [ ] `npm run compile` (tsc --noEmit) — only pre-existing warnings allowed (background-loader.ts / background.ts strictness).
- [ ] `npm run build` passes.
- [ ] `npm run zip` produces a sane artifact (size, no obvious breakage).
- [ ] If touching FFmpeg or Vosk: manual smoke via harnesses (`transcribe-harness.html`, `voice-harness.html`) + one full record → Design Studio → export cycle on Reddit.
- [ ] If touching `src/settings/` (profiles, transcriptConfig, appearance): re-verify the Race Rules (see below).
- [ ] Risk/effort note written (1–2 sentences): what can break, how fallback mitigates.

## Special Guardrails — Profile / Subtitle / Prefs (Born From BUG-017…024)

Recent bad bug cluster (concurrent RMW, boot races, throws aborting sync, dirty state lies) produced these **non-negotiable** rules. Any `/code-review` involving `user-preferences.ts`, `clip-profiles.ts`, `mount-clip-studio.ts`, `subtitle-controls.ts`, or storage must confirm:

1. **All** `rvnUserPrefs` mutations go through `enqueuePrefsOp` (single-writer promise chain in `src/settings/user-preferences.ts`).
2. Appearance + transcript writes are **atomic per queue slot** (`applyClipProfile`, `saveAppearancePreferences`, `saveTranscriptPreferences`).
3. Design Studio boot is strictly sequential: `loadUserPreferences → reconcileBackgroundPreferences → mountClipStudio({initialPrefs})`.
4. `prefsHydrated` gate is respected — `onUserPreferencesChanged` is ignored until first reconciled hydrate.
5. `buildDraftConfig()` closure (not bare sibling method call) is used for subtitle draft in `subtitle-controls.ts`.
6. **Never** call `flushPersist()` (or equivalent) before profile save/update/fork paths without the queue + `ignoreStoragePrefs` discipline.
7. Profile dirty labels and `clipProfileMatchesLiveState` use **stored** snapshot for subtitles (live draft text lives in `rvnSessionTranscript` IDB until eloquent-4 polish).
8. Legacy profiles (no `transcriptConfig`) are treated as subtitles-off until user does one **Update profile**.

If you are about to touch any of these areas, explicitly re-read:
- `docs/eloquent-profile-handoff.md`
- `docs/eloquent-profile-checkpoint-hydrated.md`
- Race rules section in the handoff doc.

## Pipeline / Architecture Touch Checklist

Before changing record → transcode → transcribe → studio → export flow:

- [ ] Confirm compositing layer order (bottom → top): background, bars, subtitles (burn-in is always a later FFmpeg pass on `base.mp4`).
- [ ] Transcription (if touched) must stay parallel non-blocking fork of raw WebM clone; never blocks or awaits before transcode starts.
- [ ] FFmpeg and Vosk never run concurrently until memory is explicitly profiled on 2:00 cap hardware.
- [ ] Use **semantic** progress only for stall/timeout (heartbeats never reset timers). See `docs/engineering-principles.md`.
- [ ] Cancel/Abort + `sessionEpoch` supersede pattern must reach both queues.
- [ ] `base.mp4` contract remains unchanged when subtitles/voice are disabled or fail.
- [ ] **Offscreen relay registry (BUG-032):** any change to `background.ts` relay paths must keep `rememberRelayTab` on register, `forgetRelayTab` on COMPLETE, never delete maps before `relay*Failure`, and offscreen-only broadcast filter for transcode/transcribe. See `src/messaging/relay-registry.ts`.

## After the Work (Even on Branch)

- Re-run the build + zip gate.
- If the change was profile/storage heavy: run the profile QA matrix from `docs/eloquent-profile-handoff.md`.
- Consider an annotated checkpoint tag (e.g. `eloquent-3-burnin-attempt`, `my-risky-pref-work-premerge`).
- Update `claude-progress.md` with one-line summary + any new open issues.
- Suggest commit: `Sprint: <brief description>`.

## Effort / Risk Annotation Template (Include in Review Notes)

```
Effort: <low|medium|high>  (one sentence why)
Risk areas: <list 1-3 sharp edges>
Fallback mitigation: restore <tag>, <what stays working>
```

## How This Prevents Fragility

- Forces explicit escape hatch (tag) before every risky edit.
- Codifies the lessons from the BUG-017…024 series so they are not rediscovered.
- Makes "restore and test from known good" the default reaction instead of debugging in a broken tree.
- Keeps phase discipline (one major integration per sprint) visible.

**This is the canonical /code-review for the repo.** Update this file when new hard rules emerge from production bugs.
