# Release notes — v5.3.2 **One-Time Test cold-start fix**

**Tag:** `v5.3.2` · **Date:** 2026-06-28
**Branch:** patch on `main` (from `v5.3.1` @ `4383593`)
**Restore:** `git checkout v5.3.2 && npm install && npm run dev`
**Prior stable:** `v5.3.0`; feature baseline `v5.3.1` (Voice live-mic preview)

## Summary

Patch fix for the v5.3.1 **One-Time Test** (live-mic voice preview). On a **cold start**
— when no `rvnLastRecording` exists yet — the rendered test clip began playing correctly
(audibly filtered) but was cut off after a fraction of a second. Ironically this only
struck users with **no** saved recording — the exact audience the feature exists for.

## Root cause

The Design Studio voice panel polls IndexedDB every `RECORDING_POLL_MS` (2 s) to pick up
a freshly recorded clip. Its "nothing changed, skip" guard was:

```ts
if (snapshot && savedAt <= loadedSavedAt && lastRecording) return;
```

That early-return required a snapshot to **exist**. With no saved recording, `snapshot` is
`null`, so the guard never fired and every poll tick fell through to `preview.stop()` —
which killed an in-flight One-Time Test playback. (FFmpeg was never at fault; it produced a
complete clip, and the trailing `Aborted()` in the logs is benign ffmpeg.wasm teardown
present on success too. The "plays then dies after ~1 s, sporadic" timing was the 0–2 s gap
to the next poll tick.)

## Fix

Key the guard purely on `savedAt` so the **no-recording** steady state (`0 === 0`) also
short-circuits; seed `loadedSavedAt` to `-1` so the first paint still runs once. The poll's
`preview.stop()` now fires only when the stored recording genuinely changed.

```ts
if (savedAt === loadedSavedAt) return;
```

One file: `src/ui/design-studio/voice-controls.ts` (the audition render path and
storage-safety invariant are unchanged).

## Verification

`tsc --noEmit` green; production build clean. Manual: with **no** saved recording, One-Time
Test now records → renders → plays to completion; the existing "Last voice note" path and
the no-IDB-write invariant are unaffected.
