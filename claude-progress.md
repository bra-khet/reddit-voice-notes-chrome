# Reddit Voice Notes — Session Progress

## MVP complete — v1.0.0

| Phase | Status |
|-------|--------|
| 0–5 | Done |
| 6 | Done — shortcuts, settings popup, README, v1.0.0 |

## Phase 6 deliverables

- **Keyboard shortcut**: Default `Ctrl+Shift+X` / `⌘+Shift+X`; configurable in popup (`src/settings/`)
- **Manifest command**: `open-voice-recorder` (rebindable at `chrome://extensions/shortcuts`)
- **Settings popup**: Shortcut capture, reset, reload extension
- **README**: Finalized usage, layout, limitations

## Bug fix: cap transcode hang (see `docs/bug-archive.md` BUG-001)

- **Cause**: Cap auto-stop WebM corruption + ~15 MB base64 relay + canvas video bitrate; per-strategy FFmpeg timeouts allowed multi-minute hangs on 15 MB files
- **Fix (2026-06)**: Recording cap **2:00** (118s enforced); FFmpeg worker dispose/queue; strategy timeout capped at 90s; theme assets in `web_accessible_resources`
- **Earlier fixes**: Dedicated cap `setTimeout`; `stopInFlight` guard; chunked base64 encode; cap stop uses `requestData`+`stop`

## Restore prior checkpoint

```bash
git checkout v0.1.0-phase3-stable && npm install && npm run dev
```

## Recent tweaks (v1.0.2)

- **Keyboard shortcut**: Disabled (commented out) — Reddit contenteditable/shadow DOM conflicts; revisit later
- **Cap transcode hang fix**: Removed cap-only 1.1s wait-while-recording flush (was corrupting WebM); cap stop now uses same `requestData`+`stop` as manual; 300ms lead before nominal cap
- **Recording cap**: **2:00** display / **2:00** enforced (lowered from 3:00 — see `docs/bug-archive.md`)
- **BUG-002 fix**: `writeFile` buffer transfer — slice per FFmpeg strategy; exec timeout race guard
- **BUG-003 fix**: explicit pipeline validators (`binary-verify.ts`), stall-based timeout, heartbeats, transcode lock, 2 FFmpeg strategies + job retry

## Known limitations

- Auto-attach best-effort; download always works
- **2:00 cap** is a pipeline concession until chunked transport / lower video bitrate (BUG-001)
- Reddit allows ~3:00 video comments; extension intentionally stops earlier
- Popup shortcut vs Chrome command page are independent config paths

## Branch split (post-MVP)

| Branch | Role |
|--------|------|
| `main` | Frozen MVP — `v1.0.2-live` production build |
| `pretty` | Visual polish, themes, backgrounds, personalization — see `pretty-branch.md` |

## Future ideas (post-MVP)

- Waveform themes in settings → active on `pretty` branch
- Chunked binary transport for very long recordings
- **Audio processing bypass toggle** (pretty branch work): Prepared disabled-by-default path for `echoCancellation/noiseSuppression/autoGainControl=false` in getUserMedia. Will become user-selectable (with help "?" tooltip explaining "poor audio quality") once tested. Users experiencing telephone/Bluetooth-like quality can opt into raw mic capture. See pretty-branch.md "Future audio pipeline & settings" and code comments with "FUTURE AUDIO TOGGLE".
- Waveform bar alignment options (center mirrored / bottom / top) as user setting alongside themes.
- Extensibility note: recorder pipeline kept open for future voice modulation profiles.