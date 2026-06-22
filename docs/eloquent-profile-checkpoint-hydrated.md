# eloquent profile checkpoint — prefs hydrated (2026-06-21)

**Branch:** `eloquent`  
**Tag:** `eloquent-prefs-hydrated` (annotated — WIP checkpoint after BUG-023, before subtitle `getDraftConfig` fix)  
**Commit:** `7c11796` — `Sprint: fix Design Studio prefs hydration and write races (BUG-023)`

**Purpose:** Preserve the first state where profile **switching** and **canvas personal backgrounds** work again, while documenting exactly what changed vs `eloquent-semi-fixed` and which race rules must not regress.

---

## vs `eloquent-semi-fixed` (`4ba8530`)

| Aspect | `eloquent-semi-fixed` | `eloquent-prefs-hydrated` (`7c11796`) |
|--------|----------------------|----------------------------------------|
| **Root diagnosis** | `activeProfileId` not persisted (unconfirmed) | Storage was correct; **in-memory UI stale** from RMW races + boot listener order |
| **Profile select** | Names visible; apply often no-op | Profiles **switch**; theme/colors/bg on **canvas** follow profile |
| **Clone / Update buttons** | Stuck on Save as profile | Likely working when apply completes (blocked by JS error below) |
| **Personal bg on canvas** | Often missing | **Works** per profile `customBackgroundId` |
| **Background library dropdown** | Broken / empty selection | Still broken — `applyPrefs` throws before `personalBackground.sync()` |
| **Console** | Quiet or storage drift | `getDraftConfig is not defined` on every profile apply |
| **Prefs writes** | Unguarded concurrent RMW | **Serialized** `enqueuePrefsOp` queue |
| **Studio boot** | Mount + parallel `loadUserPreferences` / reconcile | **load → reconcile → mount(initialPrefs)** |
| **Storage listener** | Immediate `onUserPreferencesChanged` | Gated until `prefsHydrated` |

---

## What BUG-023 changed (code)

### `src/settings/user-preferences.ts`

- `enqueuePrefsOp` — all prefs reads/writes run on one promise chain.
- `readUserPreferencesBlob` + `commitUserPreferences` — internal read/commit (no nested queue deadlock).
- **Atomic** (single queue slot): `applyClipProfile`, `saveAppearancePreferences`, `saveTranscriptPreferences`.
- `loadUserPreferences()` — queued read for consistency.

### `entrypoints/design-studio/main.ts`

```ts
const prefs = await loadUserPreferences();
const reconciled = await reconcileBackgroundPreferences(prefs);
mountClipStudio(app, { initialPrefs: reconciled });
```

No parallel mount + reconcile.

### `src/ui/design-studio/mount-clip-studio.ts`

- `MountClipStudioOptions.initialPrefs` — first paint from reconciled storage blob.
- `prefsHydrated` — `onUserPreferencesChanged` ignored until first `hydratePrefs`.
- `entryAppearance` captured only on `hydratePrefs({ captureEntry: true })`, not on racing listener passes.
- `runStudioPersist` — surfaces errors (e.g. `Apply profile`) instead of silent `void`.

---

## Known open at this tag (`7c11796`)

### BUG-024 — `getDraftConfig is not defined` (subtitle-controls)

**Symptom:** Alert/console on profile select; `getProfileSnapshotConfig` calls bare `getDraftConfig()` but only a **method** on the returned handle exists, not a closure.

**Cascade:** `applyPrefs` → `syncProfileActions` → `isProfileDirty` → throws → **`personalBackground.sync` never runs** → background dropdown empty despite `rvnImageDb` populated.

**Fix:** Extract local `buildDraftConfig()` inside `mountSubtitleControls`; use in `schedulePersist`, `persistNow`, and returned methods. (Commit after this tag.)

---

## QA at `eloquent-prefs-hydrated` (user-confirmed)

| Area | Status |
|------|--------|
| `rvnUserPrefs` in Extension Storage | ✅ Correct (`activeProfileId`, `customBackgroundId`, profiles) |
| Profile select → canvas theme/colors | ✅ Switches |
| Profile select → canvas personal bg | ✅ Shows per-profile `bg-…` |
| Background panel dropdown (library list) | ❌ Not synced (throw aborts `applyPrefs`) |
| Voice preview (`rvnLastRecording`) | ✅ |
| Profile Save/Update/Clone | ⚠️ Blocked by BUG-024 throw during apply |

---

## Race rules — do not regress

1. **Never** read prefs → merge → write in two separate unserialized steps when subtitle and appearance can write concurrently.
2. **Design Studio boot** must pass reconciled prefs into mount; do not mount then `loadUserPreferences` in parallel with `reconcileBackgroundPreferences`.
3. **`onUserPreferencesChanged`** must not call `applyPrefs` until `prefsHydrated` (or equivalent) is true.
4. **`entryAppearance`** baseline must be captured from the reconciled boot prefs, not from an early listener-fired partial state.
5. **`studioPersist`** should keep `ignoreStoragePrefs` during save; subtitle `schedulePersist` must not overwrite appearance mid-profile-apply (queue handles this).
6. **`applyPrefs`** must not throw mid-sync — profile button sync and `personalBackground.sync` are downstream; use local functions in subtitle handle, not cross-method bare calls.

---

## Restore this checkpoint

```bash
git checkout eloquent-prefs-hydrated
npm install
npm run dev
# chrome://extensions → reload → .output/chrome-mv3-dev
```

## Compare to prior checkpoint

```bash
git checkout eloquent-semi-fixed   # buttons broken, partial style apply
git diff eloquent-semi-fixed eloquent-prefs-hydrated --stat
```

---

## Related

- `docs/eloquent-profile-checkpoint.md` — semi-fixed arc + storage audit
- `docs/bug-archive.md` — BUG-021…024
- `claude-progress.md` — session handoff