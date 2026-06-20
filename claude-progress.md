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

## Bug fix: 3-minute cap transcode hang

- **Cause**: Interval-based cap stop raced with MediaRecorder 1s timeslice; final chunk could be incomplete → FFmpeg hung until 5 min client timeout
- **Fix**: Dedicated `setTimeout` cap; `stopInFlight` guard; flush wait (`timeslice + 100ms`) before `stop()` on cap; safer base64 encode (no large spread); scaled transcode timeout by WebM size

## Restore prior checkpoint

```bash
git checkout v0.1.0-phase3-stable && npm install && npm run dev
```

## Recent tweaks (v1.0.2)

- **Keyboard shortcut**: Disabled (commented out) — Reddit contenteditable/shadow DOM conflicts; revisit later
- **Cap transcode hang fix**: Removed cap-only 1.1s wait-while-recording flush (was corrupting WebM); cap stop now uses same `requestData`+`stop` as manual; 300ms lead before nominal cap
- **Recording cap**: Enforced ~2:58 (178s), UI still shows 3:00 max

## Known limitations

- Auto-attach best-effort; download always works
- Large 3-min recordings near Chrome message size limits
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