# Settings Reset Semantics

<!--
CHANGED: Distinguished dirty-profile snapshot reversion from Background/Style default-vs-blank resets.
WHY: reset copy must identify the real source being restored and never imply that a saved profile is being cleared or replaced.
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

The compact Profile/Status reset key is a separate **snapshot reversion**, not a default/blank choice. It appears only for a dirty saved profile and reapplies that profile through `applyClipProfile()`. The saved profile and its identity remain; only unsaved profile-owned settings on screen are discarded.

## Field inventory

| Family | Restore-default target | Clear-override target | Distinct? | Status |
|--------|------------------------|-----------------------|-----------|--------|
| **Background** | Keep selected image/GIF; restore `DEFAULT_USER_BACKGROUND_LAYOUT` | Set `customBackgroundId: null`; reveal the active theme; keep upload in ImageDB | **Yes** | **Shipped** |
| **Style** | Restore the selected saved-style snapshot, or the Custom starter values when unsaved | Detach the custom Style; clear `designOverrides`; resolve its bundled base preset | **Yes** | **Shipped** |
| **Voice** | Normalize to `DEFAULT_VOICE_EFFECT_CONFIG` | Clear graph/character and disable | Usually no | Use one honest reset action, not a false two-choice dialog |
| **Subtitle appearance** | Normalize to `DEFAULT_SUBTITLE_STYLE` | Most missing style fields normalize straight back to defaults | Usually no | Keep separate from transcript clearing |
| **Transcript text/timing** | Not a preference default | Clear session transcript through its existing guarded action | Different domain | Never combine with appearance reset |
| **Uploaded backgrounds** | Not applicable | Delete blob/reference through media-library ownership | Destructive domain | Never call deletion a reset |

## Background slice

The Background panel’s **Return path** opens one native top-layer choice sheet:

- **Product layout → Restore layout:** centered Fill, `1×`, normal blend, default dim, no blur/Holo, normal GIF motion; selected media remains.
- **Theme background → Use theme background:** the personal-background reference is cleared and the active theme resolves normally; the upload remains available in the library.

Both paths build one normalized patch through `resolveBackgroundResetTarget()` and persist through the existing `saveAppearancePreferences()` / `enqueuePrefsOp` path owned by the Studio mount.

## Style slice

The Style panel shows **Return path** only while a custom or saved Style layer is active:

- **Style source → Restore Style:** a saved Style keeps its identity and restores its normalized authored snapshot. An unsaved Custom Style returns to `CUSTOM_STYLE_BASE_THEME_ID` plus `DEFAULT_CUSTOM_STYLE_OVERRIDES`.
- **Base preset → Use base preset:** the active custom Style is detached, `designOverrides` is cleared, and its bundled base theme becomes authoritative. The saved Style entity remains in the collection.

`resolveStyleResetTarget()` computes the normalized patch without mutating `savedCustomStyles`. The Studio cancels any stale debounced Style write, resets identity-bound preview state, persists through `saveAppearancePreferences()`, and lets the existing profile/style comparators derive dirty state. Clearing the custom layer hides the dock and returns keyboard focus to **Style collection**.

Background and Style are the complete two-destination sweep from the inventory. Voice and Subtitle appearance should use one honest restore action if added; transcript clearing and media deletion remain separate guarded domains.
