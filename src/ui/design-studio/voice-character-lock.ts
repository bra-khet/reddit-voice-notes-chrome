/**
 * Voice Character Lock (Guard) — transient MVP guard for the Design Studio Voice
 * sub-panel. Protects an expensive custom voice tuning session from an accidental
 * character-chip click that would overwrite the live StylizedGraph.
 *
 * Spec: docs/v5.1.2-QOL-characterlockout.md
 *
 * ## Design rules (keep this a removable leaf)
 * - **Pure-data leaf.** No DOM, no storage, no imports. The whole feature is a
 *   module-level boolean plus one pure predicate, so it can be deleted or
 *   expanded later with near-zero blast radius.
 * - **Transient.** Lock state is in-memory only — it resets on studio close /
 *   reload (the boolean is reinitialised on every page load). Lightly persistent
 *   lock state is a documented post-MVP idea, not part of this cut.
 * - **Custom-only surface.** Per the scope decision, the padlock only renders
 *   alongside the custom voice chip (when `characterPresetId` is undefined).
 *   Presets don't need protecting — they are always restorable from
 *   `preset-graphs.ts`. The guard predicate below still handles a preset-locked
 *   case defensively so the logic is correct regardless of where it's wired.
 */

/** The locked-from identity: what the voice currently resolves to. */
export interface LockedVoiceIdentity {
  /** Set when a bundled character preset is active; undefined for a custom graph. */
  characterPresetId?: string;
}

/** A click target in the character chip row. */
export interface VoiceSwitchTarget {
  /** Set when the clicked chip is a bundled character preset. */
  characterPresetId?: string;
  /** True when the clicked chip is the active custom voice chip (no preset id). */
  isCustomChip?: boolean;
}

/** Structured guard verdict — `reason` is populated only when blocked. */
export interface VoiceSwitchGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Toast/aria copy for a blocked switch. Exported so the UI and any test assert
 * against the same strings, and so the tone stays consistent (helpful, low-alarm).
 */
export const LOCK_GUARD_PRESET_REASON =
  'Voice character is locked to this preset. Unlock the padlock to switch.';
export const LOCK_GUARD_CUSTOM_REASON =
  'Custom voice is locked. Unlock the padlock to switch characters.';

/* ------------------------------------------------------------------ *
 * Transient lock state (resets on reload).
 * ------------------------------------------------------------------ */

let locked = false;

export function isVoiceCharacterLocked(): boolean {
  return locked;
}

export function setVoiceCharacterLock(next: boolean): void {
  locked = next === true;
}

/** Force-unlock — call on Voice-panel mount so each studio session starts open. */
export function resetVoiceCharacterLock(): void {
  locked = false;
}

/* ------------------------------------------------------------------ *
 * The opinionated piece — "is this click actually a switch away?"
 * ------------------------------------------------------------------ */

/**
 * Decide whether a character-chip click should be allowed while the guard is on.
 *
 * Answers one question: *is this click a real switch away from the locked
 * character, or a harmless no-op re-click of the one that's already active?*
 *
 * Edge cases (see spec §4):
 * - **Not locked** → always allow.
 * - **Locked on a preset** (`current.characterPresetId` set): only re-clicking the
 *   exact same preset chip is a no-op → allow. Any other chip (a different preset
 *   or the custom chip) is a real switch → block with {@link LOCK_GUARD_PRESET_REASON}.
 * - **Locked on a custom graph** (`current.characterPresetId` undefined): the custom
 *   chip only exists while it's active, so re-clicking it is a no-op → allow. Any
 *   chip carrying a preset id is a switch away from — and potential loss of — the
 *   custom graph → block with {@link LOCK_GUARD_CUSTOM_REASON}.
 */
export function guardVoiceCharacterSwitch(
  locked: boolean,
  current: LockedVoiceIdentity | null,
  target: VoiceSwitchTarget | null,
): VoiceSwitchGuardResult {
  if (!locked) return { allowed: true };

  const currentIsPreset = Boolean(current?.characterPresetId);
  const targetIsPreset = Boolean(target?.characterPresetId);

  if (currentIsPreset) {
    // Locked on a preset: only the exact same chip is a no-op.
    const samePreset = target?.characterPresetId === current?.characterPresetId;
    return samePreset
      ? { allowed: true }
      : { allowed: false, reason: LOCK_GUARD_PRESET_REASON };
  }

  // Locked on a custom graph: any chip that carries a preset id is a switch away.
  if (targetIsPreset) {
    return { allowed: false, reason: LOCK_GUARD_CUSTOM_REASON };
  }

  // Target has no preset id → it's the active custom chip itself (no-op).
  return { allowed: true };
}
