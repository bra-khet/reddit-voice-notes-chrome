# Release notes — v5.11.0 **Preferences full-IDB migration**

**Tag:** `v5.11.0` *(applied at merge; push deferred)* · **Date:** 2026-07-13
**Prior stable:** `v5.10.0`
**Branch:** `feature/v5.11.0-prefs-storage-refactor` → `main`
**Design (authoritative, as-built):** [`v5.11.0-prefs-storage-refactor.md`](v5.11.0-prefs-storage-refactor.md) · [ADR-0006](architecture/adr/0006-user-preferences-full-idb.md)
**Restore:** `git checkout v5.11.0 && npm install && npm run dev`

---

> **The headline:** durable user preferences no longer live in one large `chrome.storage.local` blob. v5.11.0 moves the complete `rvnUserPrefs` model into a dedicated, inspectable extension-origin **IndexedDB** database — one `global` row plus per-entity `profiles` and `customStyles` rows — and demotes `chrome.storage.local['rvnUserPrefs.v2']` to a tiny signal-only coordinator. **No caller changed:** every existing `user-preferences.ts` export keeps its name, signature, and behavior, and the public `UserPreferencesV1` / `USER_PREFS_VERSION` contract stays v1. This is a storage-hardening release — voice, subtitle, profile, style, preview, and bake semantics are all untouched — that also ships first-class versioned JSON **Export / Import** in Design Studio and per-save size telemetry.

---

## What shipped

### Full-IDB preference truth (the migration)
- **`src/storage/user-prefs-db.ts`** (new): a native-IndexedDB thin wrapper following the `last-recording-db.ts` / `session-transcript-db.ts` conventions. Database `rvnUserPrefs` (IDB version `1`, internal record schema `2`) with three stores — `global` (keyPath `id`, the single `id: 'global'` record: active IDs, appearance, audio, notifications, voice, transcript style/toggle, experimental flags), `profiles` (one normalized `ClipProfile` per row), and `customStyles` (one normalized `CustomClipStyle` per row). All preference truth lives in IDB; active IDs and flags are **not** duplicated in local storage.
- **Atomic replace.** Every save splits the next `UserPreferencesV1` snapshot into the three stores and replaces all of them in **one readwrite transaction** (clear + put rows + global row). Complete-snapshot replacement is deliberately simpler and safer than diffing up to 12 profiles + 12 styles, and it prevents deleted rows from surviving.

### Signal-only local coordinator (persist-before-publish)
- `chrome.storage.local['rvnUserPrefs.v2']` is now just `{ schemaVersion: 2, revision, migratedAt, updatedAt }` — a migration marker and cross-context change signal, **not** a second source of preference truth.
- Write order is always **IDB transaction → coordinator + `THEME_STORAGE_KEY` publication**, mirroring H13's persist-before-publish rule: a listener reacting to the coordinator can never observe an advertised-but-uncommitted snapshot.

### One-time, data-safe v1 migration
- A valid legacy `rvnUserPrefs` v1 blob with no usable v2 snapshot triggers migration: normalize the whole blob first (styles before profiles, so linked profile references resolve exactly as before) → atomically write all three stores → publish coordinator + theme → **remove the v1 blob only after those succeed**.
- If IDB opening or the migration transaction fails, the code **warns and returns the normalized legacy snapshot without deleting it or publishing the coordinator**; a later load retries. The legacy blob is a failure fallback only — there is no dual-write period.

### Content-script access without changing callers
- Reddit content scripts can't open extension-origin IDB, so the storage wrapper transparently relays **load** / **replace** through two bounded, registry-owned request/response messages to the background IDB owner (background calls explicit direct helpers). Popup, Studio, and background use the direct IDB path. This is **not** a work/progress pipeline and no preference caller's signature changed.

### Versioned JSON Export / Import (Design Studio)
- New additive helpers `exportUserPreferencesAsJSON()` / `importUserPreferencesFromJSON()`. The envelope is human-readable and versioned:
  ```json
  { "type": "rvn-user-preferences-v1", "exportedAt": "…", "preferences": { "version": 1 } }
  ```
- **Export JSON** flushes pending Studio writes before downloading. **Import JSON** uses a hidden `.json` input, asks for explicit **replacement** confirmation, validates the envelope (rejects empty/oversized input, invalid JSON, wrong discriminator, missing core sections, or a non-v1 payload), normalizes through the same merge path as migration, persists the imported subtitle toggle atomically, and applies the result through the existing Studio refresh path. Import is **full-replace** by design; a failed import rolls the subtitle flag back.

### Per-save size telemetry
- After every successful v2 write, UTF-8 JSON byte sizes are logged (global row, all profile rows, all custom-style rows, total) as one compact info record in all builds. A **development warning** fires when total serialized data exceeds **256 KiB** or any single record exceeds **64 KiB**. These are awareness thresholds — saves are never rejected for crossing them.

## Unchanged contracts
- **Public preferences API stays v1.** Every pre-v5.11 `user-preferences.ts` export keeps its name, signature, return type, and behavior; `UserPreferencesV1`, `USER_PREFS_VERSION`, and the returned `version` remain `1`. "v2" names the persistence layout only.
- **BUG-023 race safety preserved.** Every read-modify-write — including import — still serializes through `enqueuePrefsOp`; no UI or storage helper writes preference records directly.
- **Centralized normalization preserved.** `mergePreferences`, `mergeAppearancePreferences`, `normalizeClipProfiles`, `normalizeCustomClipStyles`, `normalizeVoiceEffectConfig`, `normalizeTranscriptConfig` remain the single cleaning path for migration, load, and import.
- **Profiles stay self-contained** (embedded `voiceEffectConfig` + profile-safe `transcriptConfig`); **BUG-019 subtitle atomicity preserved** (`rvnSubtitlesEnabled` + extension-page cache still win over a stale transcript-config toggle).
- No profile/style schema redesign, cap change, new management workflow, or new execution context; only the two bounded preference DB request/response messages are added.

## Verify
```bash
node scripts/test-user-prefs-storage.mjs   # 12/12 — split/strip/size, atomic replace/delete,
                                           #         failed write, migration/retry, Export/Import,
                                           #         invalid-import no-write, Reddit relay
npm run build                              # PASS @ 5.11.0
npm run compile                            # only the same 2 pre-existing subtitle diagnostics
```

## Real-browser QA sign-off — **PASS (2026-07-13)**

Windows / Chrome, single machine, `.output/chrome-mv3-dev/` (build `ebca7cb`, package 5.11.0). Gate = design doc §9. Evidence: `.ignore/QA-5.11.0/` (gitignored — migration dumps, export JSONs, DevTools IndexedDB screenshots, console logs).

| # | Section | Result |
|---|---------|--------|
| 0 | Pre-flight (`ebca7cb` / 5.11.0 / Chrome dev build) | **PASS** |
| 1 | Fresh install → clean v2 layout (IDB + tiny coordinator, no fat local blob) | **PASS** |
| 2 | Upgrade — large v1 blob migration (real path **and** planted blob; legacy removed after success) | **PASS** |
| 3 | Migration-failure retain + retry | **PARTIAL (accepted)** — fallback (`Using legacy user preferences after IDB failure`) + v1 retention + retry verified; full forced in-browser failure is impractical (IDB auto-recreates), Node suite covers the injected failure |
| 4–5 | Profiles / custom-styles CRUD (parity, revision bumps, no ghost rows) | **PASS** |
| 6 | Cross-context hot-swap (Studio / popup / Reddit) | **PASS** |
| 7 | Reddit content-script relay + capture (cold load via background relay, no SW errors) | **PASS** |
| 8–10 | Export / Import happy + reject (versioned envelope, full replace + confirm, bad files no-write) | **PASS** |
| 11 | DevTools inspection — expandable `global` + per-entity rows; no large local blob | **PASS** |
| 12 | Size telemetry (`User preferences saved` with `totalBytes` + per-store sizes; warnings non-blocking) | **PASS** |
| 13 | Product smoke — record → process → bake → download → voice re-apply with IDB prefs | **PASS** |
| 14 | Optional (subs · recovery) | **skipped** — H8 already closed; subtitle atomicity covered elsewhere |

**Overall: PASS · Blockers: none.**

### Accepted non-blockers (not merge gates)
1. **§3 browser force-fail PARTIAL** — the checklist explicitly allows this when the Node suite covers the injected failure; the product retain+retry path was exercised at the warning/fallback surface. A transient uncaught rejection can appear only if IDB is deleted mid-transaction in DevTools — not a product path.
2. **Import merge/union mode** — current Import is full-replace by design; an optional "keep profiles/styles not present in the import file" mode is logged in [`future-ideas.md`](future-ideas.md), **out of v5.11.0 scope**.

### Post-QA code fixes
None. QA passed the `ebca7cb` build as-is.

## Deferred (explicitly out)
- Visual-polish / v6.0 work (the proposed **v6.0 "Polish & Visual Maturity"** arc).
- Profile/style schema redesign, rename, increased caps, or a new management workflow.
- Sync-storage / cloud-sync.
- A work/progress pipeline or binary-chunk relay — only the two bounded preference DB requests were added.
- Any transcript text or binary assets in the preferences database.

---

*Push of `main` + tag deferred per repo convention unless you push.*
