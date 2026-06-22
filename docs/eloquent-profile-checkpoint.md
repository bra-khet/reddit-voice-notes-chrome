# eloquent profile checkpoint — semi-fixed state (2026-06-21)

**Branch:** `eloquent`  
**Tag:** `eloquent-semi-fixed` (annotated — intentional WIP checkpoint, not a release)  
**Superseded by:** `eloquent-profile-nominal` (`8834d4e`) — see `docs/eloquent-profile-handoff.md`  
**Purpose:** Preserve a recoverable point where Design Studio is mostly nominal again, before attempting another profile-button fix. Last attempt at this stage (BUG-021) regressed further.

---

## Executive summary

Subtitles work (transcription, toggle persistence, session transcript). Design Studio profile **dropdown**, **bar styles**, **backgrounds**, **HSV/custom colors**, and **section summaries** are back to expected behavior after partial revert of BUG-021 plus BUG-022 style-apply fixes.

**Still broken:** Profile action bar — **Clone / Save to new** hidden; primary button stuck on **Save as profile** instead of **Update profile** / **Sure?** on dirty saved profiles. This matches the UI path when `activeProfileId` is null or treated as a bundled preset (see `syncProfileButton` in `mount-clip-studio.ts`).

**Do not** blindly re-apply BUG-021 as-is. Read this doc and the commit chain first.

---

## Tag semantics

| Tag | Meaning |
|-----|---------|
| `v3.1.0`, `v2.0.0` | Release-quality |
| `eloquent-0-vosk-spike` | Milestone spike verified |
| **`eloquent-semi-fixed`** | **Checkpoint — partial regression recovery; known open UI bug; safe to branch from for investigation** |

This is not `v4.0.0` and not merge-ready for `main`.

---

## Commit chain (subtitle + profile arc)

| Commit | ID (short) | Summary |
|--------|------------|---------|
| eloquent-2 | `f24a928` | Design Studio Subtitles panel + canvas preview |
| BUG-016 | `3bf833d` | Persist subtitle prefs across studio sessions |
| BUG-017 | `22fc616` | Studio exit no longer reverts subtitle toggle via profile discard |
| BUG-018 | `a61f3f1` | **Critical:** offscreen `runTranscribeWebmBlob` vs `transcribeWebmBlob` deadlock (120s empty timeout) |
| BUG-019 | `c997fa4` | Atomic `rvnSubtitlesEnabled` + localStorage merge on all prefs writes |
| BUG-020 | `eaeba08` | Session transcript in extension IDB; settings-only in profile blobs; Clear transcript |
| BUG-021 | `3dcd917` | Profile dirty-state fix for legacy transcript matching — **caused major regression** (profiles vanished from UI, buttons wrong) |
| BUG-022 | *(this commit)* | Partial BUG-021 revert + style apply fixes — **semi-fixed checkpoint** |

### What BUG-021 changed (and why it hurt)

1. `mountSubtitleControls` callback → `{ onSettingsChange, onPreviewChange }` object.
2. `subtitleControls.flushPersist()` chained before every profile save/update/fork — fired `onUserPreferencesChanged` **outside** `studioPersist`'s `ignoreStoragePrefs` guard → mid-save `applyPrefs` races.
3. `liveTranscriptForProfileMatch()` + third arg to `populateProfileSelect` — coupled profile dropdown refresh to live subtitle draft.
4. `saveCurrentAsClipProfile` / `updateActiveClipProfile` gained `transcriptDraft` param (double transcript write).

**User observation:** Behavior briefly looked correct after BUG-020, then BUG-021 made things worse (empty profile list, old button UX).

### What BUG-022 changed (checkpoint commit)

**Kept from BUG-021:**

- `clip-profiles.ts` — legacy profiles with `transcriptConfig: null` skip transcript dirty match until **Update profile** embeds settings.
- `subtitle-controls.ts` — IDB transcript merge calls `notifyPreviewChange` only (not profile dirty).
- Split subtitle handlers (`onSettingsChange` / `onPreviewChange`) — init path no longer calls full `syncControlsFromDraft()` on localStorage subtitle flag.

**Reverted from BUG-021:**

- `flushPersist()` wrappers on profile save / update / fork buttons.
- `transcriptDraft` params on `saveCurrentAsClipProfile` / `updateActiveClipProfile` / `studio-exit`.
- `populateProfileSelect` third-arg live transcript for dirty labels (uses stored `prefs.transcriptConfig`).

**Added (style recovery):**

- `resolveProfileStyleApplyState()` — applying a profile with linked `customStyleId` uses style `baseThemeId` + colors (mirrors `applyCustomClipStyle`).
- `colorPicker.endInteraction()` + `syncStyleControlsFromPrefs(..., force: true)` on `applyPrefs`.
- `mergePendingColorState` — do not preserve color draft when `activeProfileId` differs from storage.

---

## QA matrix (manual, post-checkpoint)

Reload extension after `npm run dev`. Open Design Studio.

| Area | Expected (checkpoint) | Status |
|------|----------------------|--------|
| Profile dropdown lists saved names | All saved profiles visible | ✅ User confirmed |
| Select profile → bar style / theme | Clip style + HSV match profile | ✅ User confirmed |
| Personal backgrounds | Thumbnails + canvas preview | ✅ User confirmed |
| Subtitles toggle | Survives studio close/reopen | ✅ (after BUG-019+) |
| Transcription | `Transcribe complete` with segments on Reddit tab | ✅ (after BUG-018) |
| **Clone button** | Visible when saved custom profile active | ❌ **Missing** |
| **Update profile / Sure?** | On dirty saved profile; muted when clean | ❌ **Stuck on Save as profile** |
| **Save as profile** | Only when Custom (unsaved) or no saved selection | ❌ Shows even on saved profiles |

---

## Known open issue — BUG-023 (profile action bar)

### Symptoms

- `data-save-profile-new` (Clone / Save to new) stays `hidden`.
- `data-save-profile` text stays **Save as profile** (never **Update profile** / **Sure?**).
- Fork / update clicks may no-op or prompt for new name instead of updating in place.

### Code path (why the UI looks “old”)

`syncProfileButton()` in `mount-clip-studio.ts`:

```ts
if (!profileId || isPresetProfileId(profileId)) {
  saveProfileBtn.textContent = 'Save as profile';
  saveProfileNewBtn.hidden = true;
  return;
}
// else: Update profile + visible Clone/Save to new
```

So the broken state means **`prefs.appearance.activeProfileId` is null or a preset virtual id** at sync time — even if the user sees profile names in the `<select>` and styles apply correctly.

### Hypotheses (not yet confirmed — investigate next sprint)

1. **`activeProfileId` not persisted** on profile `<select>` change — `applyClipProfile` runs but a subsequent storage listener overwrites with prefs missing `activeProfileId`.
2. **`ignoreStoragePrefs` / `mergePendingColorState` race** — subtitle atomic flag (`rvnSubtitlesEnabled`) or transcript save triggers `onUserPreferencesChanged` after profile apply, reloading prefs before `activeProfileId` write lands.
3. **Dropdown display vs storage drift** — `populateProfileSelect` shows a profile name while storage still has `activeProfileId: null` (Custom row selected in UI logic but user perceives otherwise).
4. **Residual BUG-021 listener behavior** — `onSettingsChange` → `syncProfileActions` without corresponding profile id in storage.

### Files to inspect first (next fix sprint)

| File | Why |
|------|-----|
| `src/ui/design-studio/mount-clip-studio.ts` | `syncProfileButton`, `profileSelect` change handler, `onUserPreferencesChanged` |
| `src/settings/user-preferences.ts` | `applyClipProfile`, `writeUserPreferences`, `onUserPreferencesChanged` |
| `src/ui/clip-style-select.ts` | `populateProfileSelect` value vs `activeProfileId` |
| `src/settings/clip-profiles.ts` | `normalizeActiveProfileId` |

### Safe reproduction steps

1. Open Design Studio with ≥1 saved custom profile.
2. Note profile dropdown — select a saved profile by name.
3. Open DevTools → Application → Extension storage → `rvnUserPrefs` → `appearance.activeProfileId`.
4. Compare to UI: if `null` while a named profile appears selected → confirms BUG-023 storage/UI drift.
5. Change bar alignment → primary button should become **Update profile** if `activeProfileId` is set; if still **Save as profile**, id is not set in live prefs.

---

## Architecture reminders (do not regress)

### Transcription pipeline (working)

```
stopRecording() → forkTranscribeWebm
  → background → offscreen runTranscribeWebmBlob  (NOT transcribeWebmBlob)
  → decodeWebmToMonoPcm → Vosk sandbox → IDB session transcript
```

### Subtitle persistence (3 layers)

| Layer | Key | Role |
|-------|-----|------|
| Atomic flag | `rvnSubtitlesEnabled` | Race-safe on/off |
| localStorage | `rvn.subtitles.enabled` | Survives design-studio tab close |
| Prefs blob | `transcriptConfig` | Settings only — **no session transcript text** |

Session transcript: extension IDB (`session-transcript-db.ts`), signal `rvnSessionTranscriptReadyAt`.

### Profile snapshots

- `transcriptConfig` on profiles = settings only (`transcriptConfigForProfileStorage`).
- Legacy profiles: `transcriptConfig: null` → dirty match ignores subtitles until **Update profile** once.

### Studio exit

- `clipProfileMatchesLiveStateForStudioExit` excludes transcript — toggle should not revert on discard.

---

## Restore this checkpoint

```bash
git checkout eloquent-semi-fixed
npm install
npm run dev
# chrome://extensions → reload unpacked → .output/chrome-mv3-dev
```

## Compare to pre-subtitle stable baseline

```bash
git checkout eaeba08   # last commit before BUG-021 regression attempt
```

## Next sprint contract (proposed)

**Scope:** Fix BUG-023 only — profile action bar (`activeProfileId` sync + Update/Clone UX).  
**Out of scope:** New subtitle features, eloquent-3 burn-in, further transcript dirty-match tweaks until buttons verified.

**Verification gate before merge:**

1. Select saved profile → Clone visible, Update profile on dirty edit.
2. Update profile → Sure? → persists.
3. Clone / Save to new → forks with style rollup prompts.
4. Regression: profile dropdown, HSV, backgrounds, subtitles toggle still pass QA matrix above.

---

## Storage architecture audit (2026-06-21)

**Conclusion:** There was **no** failed migration of profiles (or themes) from page **Local Storage** into **Extension Storage**. Profiles have lived in `chrome.storage.local` since **pretty-6** (`6541575`, 2026-06-20). The DevTools folder labeled **Reddit Voice Notes** under **Extension Storage** is normal Chrome UI — it groups `chrome.storage.local` keys by the manifest `name`, not a new scaffolded directory.

### Where to look in DevTools (Application tab)

| Panel | What lives there | Keys / DB names |
|-------|------------------|-----------------|
| **Extension Storage → Reddit Voice Notes** | Primary prefs blob + mirrors | `rvnUserPrefs`, `rvnActiveThemeId`, `rvnSubtitlesEnabled`, `rvnSessionTranscriptReadyAt` |
| **IndexedDB** | Large binaries (by design) | `rvnImageDb` (personal background blobs), `rvnSessionTranscript` (session transcript text) |
| **Extension Storage → Sync** | Keyboard shortcut only | `rvnSettings` (via `chrome.storage.sync`) |
| **Local Storage** (chrome-extension://…/design-studio) | Subtitle toggle cache **only** | `rvn.subtitles.enabled` — added BUG-019; **not** profiles |

**Common confusion:** Page **Local Storage** under `https://www.reddit.com` or an empty Local Storage panel on the studio page does **not** mean data is missing. Profiles are in **Extension Storage → `rvnUserPrefs`**.

Inspect `rvnUserPrefs` JSON:

- `appearance.savedProfiles[]` — saved profile list (names + snapshots)
- `appearance.activeProfileId` — drives Update/Clone buttons (BUG-023 when null despite dropdown showing names)
- `appearance.customBackgroundId` — `bg-…` ref; blob is in `rvnImageDb` IndexedDB

### Git timeline — storage changes (not a profile migration)

| When | Commit | What changed |
|------|--------|--------------|
| Early pretty | `197cf4f` | Theme id in `chrome.storage.local` key `rvnActiveThemeId` |
| pretty scaffold | `e24793f` | Versioned blob `rvnUserPrefs` in `chrome.storage.local`; one-time merge of legacy `rvnActiveThemeId` only |
| pretty-6 | `6541575` | `savedProfiles` + `activeProfileId` added **inside** `rvnUserPrefs` (same storage area) |
| pretty-7a | `10c2790` | **IndexedDB** `rvnImageDb` for background **blobs**; prefs keep `bg-` refs only |
| BUG-019 | `c997fa4` | **First and only** `localStorage` write: `rvn.subtitles.enabled` + atomic `rvnSubtitlesEnabled` in extension storage |
| BUG-020 | `eaeba08` | Session transcript text → extension **IndexedDB** `rvnSessionTranscript`; settings stay in `rvnUserPrefs` |
| BUG-021 | `3dcd917` | Profile dirty / subtitle coupling — **logic regression**, not storage migration |
| BUG-022 | `4ba8530` | Partial BUG-021 revert + style apply fixes — checkpoint |

`git log -S "localStorage.setItem"` across all `.ts` files returns **one** commit: `c997fa4` (subtitle toggle only).

### What likely broke (not migration)

1. **BUG-021** (`3dcd917`) — `flushPersist()` before profile saves fired `onUserPreferencesChanged` outside studio guards → races that cleared or never persisted `activeProfileId`.
2. **BUG-023** (open) — UI reads `activeProfileId` for Save/Clone; dropdown can list `savedProfiles` while `activeProfileId` is null → old button UX.
3. **Extension reload / dev ID** — WXT dev loads `.output/chrome-mv3-dev`; a different unpacked path or stale build can show an empty Extension Storage tree under a **different** extension id while the old id still holds data.
4. **Checkpoint commit changed code** — `4ba8530` was not docs-only; it modified `mount-clip-studio.ts`, `user-preferences.ts`, etc. If behavior shifted after “documentation wrap-up,” compare against tag `eloquent-semi-fixed` (same commit).

### Verification commands

```bash
git checkout eloquent-semi-fixed
# Confirm single localStorage introduction:
git log --oneline -S "localStorage.setItem" -- "*.ts"
# Profile storage introduction:
git show 6541575 --stat
```

---

## Related docs

- `claude-progress.md` — session handoff (updated for this checkpoint)
- `docs/bug-archive.md` — BUG-016…023 entries
- `eloquent-branch.md` — v4 plan (eloquent-4 = profile polish)
- `docs/transcription-architecture.md` — pipeline detail