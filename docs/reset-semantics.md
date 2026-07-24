# Settings Reset Semantics

<!--
CHANGED: Inventoried default-vs-blank fields and recorded the Background vertical slice.
WHY: reset copy must reflect real fallback behavior and never erase adjacent profile, transcript, take, or media state.
-->

## Archive Notice (Living Document)

This is the compact post-v6 contract for reset operations. Historical product context remains in [`future-ideas.md`](future-ideas.md); milestones and archive routes live in [`HISTORY.md`](HISTORY.md).

## Shared language

| Operation | Meaning |
|-----------|---------|
| **Restore defaults** | Put the scoped control family back to its product, preset, or saved-source values. |
| **Clear override** | Remove the optional user override so the ordinary fallback resolver becomes authoritative. |

Never label an operation “blank” when normalization immediately recreates the same default. In the UI, prefer the concrete destination—such as **Theme background**—while keeping `default | blank` as the internal semantic pair.

Every reset must:

- name its exact scope before confirmation;
- pass through the existing normalizer and serialized preference writer;
- update profile dirty state without saving the profile automatically;
- preserve unrelated profile identity, transcript/session text, current take, and media blobs;
- use the shared accessible choice-sheet pattern when both destinations are real.

## Field inventory

| Family | Restore-default target | Clear-override target | Distinct? | Status |
|--------|------------------------|-----------------------|-----------|--------|
| **Background** | Keep selected image/GIF; restore `DEFAULT_USER_BACKGROUND_LAYOUT` | Set `customBackgroundId: null`; reveal the active theme; keep upload in ImageDB | **Yes** | **Shipped first slice** |
| **Style** | Restore selected bundled preset or saved-style snapshot | Remove optional `designOverrides` fields so registry/theme values resolve | **Yes** | Next candidate; preserve custom-style identity rules |
| **Voice** | Normalize to `DEFAULT_VOICE_EFFECT_CONFIG` | Clear graph/character and disable | Usually no | Use one honest reset action, not a false two-choice dialog |
| **Subtitle appearance** | Normalize to `DEFAULT_SUBTITLE_STYLE` | Most missing style fields normalize straight back to defaults | Usually no | Keep separate from transcript clearing |
| **Transcript text/timing** | Not a preference default | Clear session transcript through its existing guarded action | Different domain | Never combine with appearance reset |
| **Uploaded backgrounds** | Not applicable | Delete blob/reference through media-library ownership | Destructive domain | Never call deletion a reset |

## Background slice

The Background panel’s **Return path** opens one native top-layer choice sheet:

- **Product layout → Restore layout:** centered Fill, `1×`, normal blend, default dim, no blur/Holo, normal GIF motion; selected media remains.
- **Theme background → Use theme background:** the personal-background reference is cleared and the active theme resolves normally; the upload remains available in the library.

Both paths build one normalized patch through `resolveBackgroundResetTarget()` and persist through the existing `saveAppearancePreferences()` / `enqueuePrefsOp` path owned by the Studio mount.
