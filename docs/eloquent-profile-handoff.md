# eloquent profile system — handoff (2026-06-21)

**Branch:** `eloquent`  
**Stable tag:** `eloquent-profile-nominal` (`8834d4e`) — Design Studio profiles, styles, backgrounds, Save/Update/Clone **user-verified working**  
**Prior tags:** `eloquent-prefs-hydrated` (`7c11796`, BUG-024 open) · `eloquent-semi-fixed` (`4ba8530`, pre-race-fix)

---

## Executive summary

Design Studio profile UI was broken for multiple sessions despite **correct** `rvnUserPrefs` in Extension Storage. The failure was **not** missing data or a localStorage→extension migration. It was:

1. **Concurrent read-modify-write races** between subtitle prefs saves and profile/appearance saves.
2. **Boot-order races** between mount, reconcile, and `onUserPreferencesChanged`.
3. **A thrown ReferenceError** in subtitle controls that aborted `applyPrefs` mid-sync (background dropdown never hydrated).

Fixes: serialized prefs queue (BUG-023), coordinated studio boot + hydration gate (BUG-023), `buildDraftConfig` closure (BUG-024).

**Do not re-apply BUG-021 wholesale.** See race rules below.

---

## Why it works now (root cause → fix)

### Wrong mental model (misleading)

| Assumption | Reality |
|------------|---------|
| Profiles not in storage | `rvnUserPrefs.appearance.savedProfiles` was always populated |
| IndexedDB migration failed | `rvnImageDb` blobs were fine; prefs hold `bg-…` **pointers** only |
| `activeProfileId` never persisted | DevTools showed correct ids; **in-memory `activePrefs`** was stale |

### What actually broke the UI

```
Extension Storage (rvnUserPrefs)     ← correct on disk
        ↓ loadUserPreferences
   enqueue race / listener fires early
        ↓
   activePrefs in Design Studio       ← stale (default Neon Glow, activeProfileId null in memory)
        ↓
   UI: names from savedProfiles list, but applyPrefs never fully synced
```

**Concurrent RMW (BUG-023):** `saveTranscriptPreferences` could `load → merge transcript → write` while `applyClipProfile` did `load → merge appearance → write`. Whichever write landed **second** won; the other’s appearance or profile id was lost in memory on the next listener reload.

**Boot race (BUG-023):** `mountClipStudio` and `reconcileBackgroundPreferences` both called `loadUserPreferences` in parallel. `onUserPreferencesChanged` could `applyPrefs` before the reconciled blob, capturing a wrong `entryAppearance` baseline.

**Throw abort (BUG-024):** `getProfileSnapshotConfig()` called bare `getDraftConfig()` inside an object literal method. `syncProfileActions` → `isProfileDirty` threw → `personalBackground.sync()` never ran → background **library** dropdown empty even when canvas drew the correct image.

### What we did differently (vs failed attempts)

| Failed approach (`eloquent-semi-fixed` era) | Working approach (`8834d4e`) |
|---------------------------------------------|------------------------------|
| Diagnose storage / migration | Diagnose **runtime hydration + write ordering** |
| BUG-021: `flushPersist` before every profile save | **Reverted** — fired listeners outside `ignoreStoragePrefs` |
| BUG-021: live transcript in profile dirty match | **Reverted** for dropdown; kept legacy `transcriptConfig: null` skip only |
| Parallel mount + load in `main.ts` | **Sequential:** `load → reconcile → mount(initialPrefs)` |
| Unguarded `loadUserPreferences` + `writeUserPreferences` | **`enqueuePrefsOp`** serializes all reads/writes |
| Immediate storage listener | **`prefsHydrated` gate** until first reconciled apply |
| Subtitle method calling sibling by bare name | **`buildDraftConfig()` closure** shared by all paths |

---

## Commit chain (profile fix arc)

| Commit | Tag / note | Summary |
|--------|------------|---------|
| `4ba8530` | `eloquent-semi-fixed` | Partial BUG-021 revert + BUG-022 style apply; buttons still broken |
| `7c11796` | `eloquent-prefs-hydrated` | BUG-023 serialized writes + boot hydration |
| `8834d4e` | **`eloquent-profile-nominal`** | BUG-024 `buildDraftConfig`; full handoff docs |

Supporting: `11ce710` storage architecture audit (no migration).

---

## Files touched (profile fix)

| File | Role |
|------|------|
| `src/settings/user-preferences.ts` | `enqueuePrefsOp`, atomic `applyClipProfile` / `saveAppearancePreferences` / `saveTranscriptPreferences` |
| `entrypoints/design-studio/main.ts` | Boot order: load → reconcile → mount |
| `src/ui/design-studio/mount-clip-studio.ts` | `initialPrefs`, `prefsHydrated`, `runStudioPersist`, `captureEntry` |
| `src/ui/design-studio/subtitle-controls.ts` | `buildDraftConfig()` closure (BUG-024) |
| `src/settings/clip-profiles.ts` | `resolveProfileStyleApplyState` (BUG-022, kept) |

---

## QA verified (user, 2026-06-21)

| Area | Status |
|------|--------|
| Profile select → theme, HSV, alignment | ✅ |
| Profile select → canvas personal background | ✅ |
| Background library dropdown lists `rvnImageDb` | ✅ (after BUG-024) |
| Save as profile / Update profile / Clone | ✅ |
| Voice preview (`rvnLastRecording`) | ✅ — auto-refreshes while studio open (`LAST_RECORDING_READY_KEY` + IDB poll) |
| Transcription pipeline | ✅ (BUG-018) |
| Subtitle toggle persist (global) | ✅ (BUG-017/019) |

---

## Open / unfixed — subtitle edits (hand off)

These are **known limitations**, not regressions from the profile fix. Do not “fix” them by re-applying BUG-021 without reading this section.

| Issue | Behavior | Planned / notes |
|-------|----------|----------------|
| **Legacy profile subtitle snapshots** | Profiles saved before subtitle embed have `transcriptConfig: null`. Dirty match **ignores** subtitles until user runs **Update profile** once to embed settings. | eloquent-4 profile polish |
| **Session transcript vs profile** | Edited transcript **text** lives in `rvnSessionTranscript` IDB (session), not in profile blob. `transcriptConfig` on profiles = **settings only** (no `result` text). | BUG-020 design; burn-in = eloquent-3 |
| **Profile dirty label vs live subtitle draft** | Dropdown “· unsaved” uses **stored** `prefs.transcriptConfig`, not live textarea draft (BUG-021 third-arg reverted). | Revisit carefully with queue + no `flushPersist` chains |
| **Subtitle style edits + profile dirty** | `onSettingsChange` refreshes profile buttons; legacy profiles may not show subtitle-driven dirty until snapshot exists. | QA gap |
| **Update profile + subtitles** | Embedding subtitle **settings** on update works via `transcriptConfigForProfileStorage`; full UX for “subtitle edits pending on profile” not polished. | eloquent-4 |
| **Do not re-add** | `flushPersist()` before profile save/update/fork; `transcriptDraft` param on profile save paths; live transcript in `populateProfileSelect` dirty arg | Caused BUG-021 regression |
| **Canvas subtitle preview** | Vosk segments land correctly in IDB/textarea meta, but `drawSubtitlePreview()` renders **flat full-text** (`previewText()`), not timed per-segment cues. | eloquent-4 segment editor + preview polish |
| **Subtitle panel placement** | Subtitles collapsible is below Voice; canvas preview is top — gap between style controls and live preview is a known UX issue. | eloquent-4 (optional mini preview near canvas) |
| **Segment timing editor** | No YouTube-style per-segment text + nudge UI yet; burn-in should read `TranscriptResult.segments` JSON via `srt-builder.ts` without this UI. | **eloquent-3** burn-in first; editor in **eloquent-4** |

---

## Race rules — mandatory for future subtitle/profile work

1. **All** `rvnUserPrefs` mutations go through `enqueuePrefsOp` (or equivalent single-writer queue).
2. Appearance-changing ops (`applyClipProfile`, `saveAppearancePreferences`) must be **one queue slot** (read fresh → merge → commit).
3. `saveTranscriptPreferences` must read fresh **inside** the same queue, never assume an earlier `loadUserPreferences` is still current.
4. Design Studio: **never** mount before reconciled `initialPrefs` are ready.
5. **`onUserPreferencesChanged`:** ignore until `prefsHydrated === true`.
6. **`applyPrefs` must never throw** mid-function — downstream sync (backgrounds, buttons) depends on it.
7. **Never** chain `subtitleControls.flushPersist()` before profile saves without `ignoreStoragePrefs` and queue awareness.
8. Storage is two-tier: **IDB = blobs**, **`rvnUserPrefs` = pointers + profile state** — see `docs/eloquent-profile-checkpoint.md` § Storage architecture audit.

---

## Restore nominal state

```bash
git checkout eloquent-profile-nominal
npm install
npm run dev
# chrome://extensions → reload unpacked → .output/chrome-mv3-dev
```

## Related docs

- `docs/eloquent-profile-checkpoint-hydrated.md` — BUG-023 diff vs semi-fixed, race rules
- `docs/eloquent-profile-checkpoint.md` — semi-fixed arc, storage audit, BUG-021 postmortem
- `docs/bug-archive.md` — BUG-016…024
- `docs/transcription-architecture.md` — Vosk / offscreen pipeline
- `claude-progress.md` — session summary
- `eloquent-branch.md` — eloquent-3 burn-in, eloquent-4 profile polish

## Suggested next sprint

1. **eloquent-3** — FFmpeg subtitle burn-in from `TranscriptResult.segments` → `.srt` → `final.mp4`. UI preview gaps are **non-blocking** if JSON segments are correct.
2. **eloquent-4** — Per-segment subtitle editor (text + timing nudge), canvas preview that respects segments, profile snapshot UX, optional live-draft dirty labels (careful).
3. Regression gate before merge: profile QA matrix above + subtitle toggle + one record/transcribe cycle + voice preview auto-refresh while studio open.

## Voice preview auto-refresh (post-nominal)

**Problem:** Voice section only reloaded `rvnLastRecording` on `visibilitychange`. If Design Studio stayed open while the user recorded on Reddit, Play preview still pointed at the prior take.

**Fix:** Mirror subtitle-controls pattern — background sets `rvnLastRecordingReadyAt` after `MSG_SAVE_LAST_RECORDING`; studio polls IDB every 2s and listens to `chrome.storage.onChanged`. Reload skips when `savedAt` unchanged; stops active preview before swapping source.

**Files:** `user-preferences.ts` (`LAST_RECORDING_READY_KEY`), `background.ts`, `voice-controls.ts`.