# Release notes — v5.4.0 **Design Studio First: Standalone Recording Suite**

**Tag:** `v5.4.0` (pending user QA) · **Date:** 2026-07-05  
**Branch:** `feature/v5.4.0-standalone-design-studio` (merge to `main` after QA)  
**Restore:** `git checkout feature/v5.4.0-standalone-design-studio && npm install && npm run dev`  
**Prior stable:** `v5.3.10` (WebCodecs Per-Chunk Encoding)  
**Roadmap (as-built §4 Phase 0 authoritative):** `docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md`

## Summary

The Design Studio is now the **authoritative, standalone authoring environment**. Recording, re-recording, live preview, persistent take state, editing, baking, and export are all first-class Studio experiences. Reddit evolved from the mandatory recording gateway into a **polished output target** — its voice-note button attaches the current Studio take in one click, and can still record in-context as the quick path.

### What changed, by layer

**Centralized take state (Phase 0).** `src/session/take-manager.ts` is the single source of truth for the current take across every context (Studio page, Reddit content script, background, offscreen). Snapshot in `browser.storage.local` (`rvn.take.current`, synced by `storage.onChanged` — no new message family); blobs stay in the existing single-slot IDB stores with freshness stamps in the snapshot. Auto-draft on recorder close / tab teardown; crashed transient sessions demote to recoverable drafts on read; discarded recordings restore the previous take (blobs are only written at stop).

**Current Take deck (Phase 1).** The Studio hero gained an always-visible headline card: take state + duration/badge chips (DRAFT / BAKED / SUBS PENDING), **Download MP4** as the primary universal CTA (baked preferred, base otherwise), Record/Re-record, Discard. Reopening the Studio after closing everything shows your last work immediately.

**Studio-native recording with live WYSIWYG preview (Phase 2).** `mountRecorder` (headless host, `src/recorder/recorder-host.ts`) + deck-embedded transport (`studio-recorder.ts`). During an audition the **WaveformRenderer canvas itself** — the exact element `captureStream()` feeds MediaRecorder — swaps into the hero monitor (label → LIVE MIC). "PREVIEW = OUTPUT" is literal, and Studio style edits hot-swap the live recording canvas mid-take. The full downstream (voice preview, transcription fork, subtitle scaffold, bake) works identically to a Reddit capture because the session's relays are context-agnostic.

**Reddit as output target (Phase 3).** With a completed Studio take, the voice-note button opens the panel in **attach mode**: Studio take card, "Attach Studio take" primary, "Record new here" secondary. The chunked MP4 relay now serves both stores (`baked` | `base`), so never-baked takes attach too. All shadow-DOM / observer / composer-detection logic untouched.

**Copy + disclosure polish (Phase 4).** Workflow banner, status strip, and panel intro now teach the Studio-first model; advanced controls remain behind the v4 subpanel shells; main screen stays preview + take deck + primary CTAs.

### Encoding backbone

Untouched. Bake/export still flows through `subtitle-bake.ts` / `subtitle-canvas-bake.ts` with the v5.3.10 WebCodecs dual-stream path and the full fallback chain (webcodecs → mediarecorder-parallel → serial → drawtext). `updateFromBake` is a post-save observer only.

## Verification (automated — 2026-07-05)

- `node scripts/test-take-manager.mjs` — 12 checks (snapshot validation, stale-transient demotion, merge semantics)
- `node scripts/test-take-deck.mjs` — 11 checks (state → CTA/badge matrix)
- Full suite **22/22 scripts PASS** · `npx tsc --noEmit` at pre-existing-warning parity (3 known) · `npm run build` PASS

## Manual QA checklist (user pass required before tag/merge)

**Studio-native recording**
1. Open Design Studio → Current Take deck shows "No take yet" → **Record new take** → mic permission prompt (extension origin) → live waveform appears in the hero monitor with LIVE MIC label; theme/background edits update the live canvas.
2. Record ~10 s → Stop → processing bar → deck flips to "Take ready" with duration chip; **Download MP4** works.
3. Subtitles enabled: transcript arrives in Subtitles panel; bake → deck shows BAKED; Download exports the captioned MP4.

**Persistence / recovery**
4. Close the Studio tab mid-processing → reopen → deck shows draft/ready state (no lost session).
5. Record on Reddit → open Studio during processing → deck shows live "Processing…" → flips to ready when the relay lands.
6. Discard a re-record (Studio and Reddit) → previous take reappears intact in the deck.

**Reddit output target**
7. With a ready/baked Studio take: click the voice-note button → attach mode (take card + duration) → **Attach Studio take** → MP4 lands in the composer. Baked takes attach captions; unbaked takes attach the base MP4.
8. **Record new here** from attach mode → classic capture flow → new take replaces the old one in the Studio deck.
9. No take (or take cleared): button opens the classic recorder directly.

**Regression sweep**
10. Voice character preview, Smart Split, segment editor, Overlay Lab, parallel/WebCodecs bake toggles, personal backgrounds, profiles — unchanged behavior expected.

## Known notes

- Deck "Discard take" clears the snapshot only; single-slot blobs are overwritten by the next take (roadmap §5 storage answer).
- Mic permission for the Studio is granted per extension origin (lock icon in the address bar if denied).
- Demo site (`demo/src/studio/`) has no capture pipeline; standalone-flow parity there is future work.
- Simultaneous captures in two contexts are guarded by a confirm in the Studio; last-stop wins the single-slot stores (same as pre-5.4.0).
