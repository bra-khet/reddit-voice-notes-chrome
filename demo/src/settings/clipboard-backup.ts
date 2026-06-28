/**
 * Clipboard Voice Character Backup — pure (de)serialization for the Design Studio
 * Voice sub-panel. Lets power users park a tuned custom voice on the OS clipboard
 * before switching characters, then paste it back into live state.
 *
 * Spec: docs/v5.1.1-QOL-charactercopypaste.md (scope locked to **voice character
 * only**, not the full clip profile).
 *
 * ## Design rules
 * - **No UI, no apply.** This module only turns a {@link VoiceEffectConfig} into
 *   versioned JSON and back. Applying a pasted config to live state + marking the
 *   profile dirty is the UI layer's job (Phase 2), so the parser below can also
 *   back the future static companion page (docs/future-ideas.md) unchanged.
 * - **Graph-native only.** The payload carries the graph-native VoiceEffectConfig
 *   (graph / characterPresetId / intensity / turbo) — never legacy flat fields.
 *   `normalizeVoiceEffectConfig` is the single validator/cleaner on the way in.
 * - **Versioned discriminator.** Every payload carries {@link CLIPBOARD_VOICE_CHARACTER_TYPE}
 *   so a schema change is a type bump + migration shim, on both the extension and
 *   the companion page. This is the interchange contract.
 *
 * Leaf-import safety: imports only `@/src/voice/types` (a pure-data leaf that pulls
 * fragment-types, no WASM) so the settings path never drags FFmpeg in (BUG-008).
 */

import {
  normalizeVoiceEffectConfig,
  type VoiceEffectConfig,
} from '@/src/voice/types';

/** Schema discriminator + version. Bump the suffix when the shape changes. */
export const CLIPBOARD_VOICE_CHARACTER_TYPE = 'rvn-voice-character-v1' as const;

/**
 * Defensive ceiling on clipboard text we'll even attempt to parse. A voice config
 * is a few hundred bytes; anything past this is not ours (spec §5 "very large
 * clipboard content"). Avoids JSON.parse on a pathological paste.
 */
const MAX_CLIPBOARD_BYTES = 256 * 1024;

/** The versioned envelope written to / read from the clipboard. */
export interface VoiceCharacterClipboardPayload {
  type: typeof CLIPBOARD_VOICE_CHARACTER_TYPE;
  /** ISO-8601 timestamp of the copy, for human inspection / future "stale?" hints. */
  exportedAt: string;
  /** Graph-native voice character config (already normalized at serialize time). */
  voice: VoiceEffectConfig;
}

/** Result of a copy attempt — `message` is toast-ready. */
export interface ClipboardCopyResult {
  success: boolean;
  message?: string;
}

/** Result of a paste attempt — `config` is present only on success. */
export interface ClipboardPasteResult {
  success: boolean;
  message?: string;
  config?: VoiceEffectConfig;
}

/* ------------------------------------------------------------------ *
 * Toast-ready copy (spec §5). Exported for UI + test parity.
 * ------------------------------------------------------------------ */
export const CLIPBOARD_COPY_OK = 'Voice character copied to clipboard';
export const CLIPBOARD_COPY_FAIL = "Couldn't copy — clipboard unavailable";
export const CLIPBOARD_PASTE_OK =
  'Voice character loaded from clipboard (remember to Save or Update)';
export const CLIPBOARD_PASTE_NOTHING = 'Nothing usable on the clipboard';
export const CLIPBOARD_PASTE_FAIL = "Couldn't read the clipboard";

/* ------------------------------------------------------------------ *
 * Pure serialization — no clipboard, no DOM (unit-testable).
 * ------------------------------------------------------------------ */

/** Wrap a live voice config in the versioned envelope (normalized graph-native). */
export function serializeVoiceCharacter(
  config: VoiceEffectConfig,
): VoiceCharacterClipboardPayload {
  return {
    type: CLIPBOARD_VOICE_CHARACTER_TYPE,
    exportedAt: new Date().toISOString(),
    voice: normalizeVoiceEffectConfig(config),
  };
}

/** Discriminated parse result so callers can branch without throwing. */
export type VoiceCharacterParseResult =
  | { ok: true; config: VoiceEffectConfig }
  | { ok: false; reason: string };

/**
 * Validate + normalize raw clipboard text into a voice config. Never throws.
 *
 * Rejects (→ {@link CLIPBOARD_PASTE_NOTHING}): empty/whitespace, oversized,
 * non-JSON, wrong/missing `type` discriminator, or a missing `voice` object.
 * On success, the embedded voice config is run through `normalizeVoiceEffectConfig`
 * so any junk/legacy fields are stripped before it reaches live state.
 */
export function parseVoiceCharacterPayload(text: string): VoiceCharacterParseResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed || trimmed.length > MAX_CLIPBOARD_BYTES) {
    return { ok: false, reason: CLIPBOARD_PASTE_NOTHING };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: CLIPBOARD_PASTE_NOTHING };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: CLIPBOARD_PASTE_NOTHING };
  }

  const envelope = parsed as Partial<VoiceCharacterClipboardPayload>;
  if (envelope.type !== CLIPBOARD_VOICE_CHARACTER_TYPE) {
    return { ok: false, reason: CLIPBOARD_PASTE_NOTHING };
  }
  if (!envelope.voice || typeof envelope.voice !== 'object') {
    return { ok: false, reason: CLIPBOARD_PASTE_NOTHING };
  }

  return { ok: true, config: normalizeVoiceEffectConfig(envelope.voice) };
}

/* ------------------------------------------------------------------ *
 * Clipboard I/O — thin async wrappers around the pure helpers above.
 * ------------------------------------------------------------------ */

function clipboardApi(): Clipboard | null {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
}

/** Serialize the given voice config and write it to the OS clipboard. */
export async function copyVoiceCharacterToClipboard(
  config: VoiceEffectConfig,
): Promise<ClipboardCopyResult> {
  const clipboard = clipboardApi();
  if (!clipboard) return { success: false, message: CLIPBOARD_COPY_FAIL };

  try {
    const json = JSON.stringify(serializeVoiceCharacter(config));
    await clipboard.writeText(json);
    return { success: true, message: CLIPBOARD_COPY_OK };
  } catch (error) {
    console.warn('[Reddit Voice Notes] Voice clipboard copy failed', error);
    return { success: false, message: CLIPBOARD_COPY_FAIL };
  }
}

/**
 * Read the clipboard and validate it into a voice config. Returns a structured
 * result; the UI applies `config` to live state and marks dirty on success.
 */
export async function pasteVoiceCharacterFromClipboard(): Promise<ClipboardPasteResult> {
  const clipboard = clipboardApi();
  if (!clipboard) return { success: false, message: CLIPBOARD_PASTE_FAIL };

  let text: string;
  try {
    text = await clipboard.readText();
  } catch (error) {
    console.warn('[Reddit Voice Notes] Voice clipboard read failed', error);
    return { success: false, message: CLIPBOARD_PASTE_FAIL };
  }

  const result = parseVoiceCharacterPayload(text);
  if (!result.ok) {
    return { success: false, message: result.reason };
  }
  return { success: true, message: CLIPBOARD_PASTE_OK, config: result.config };
}
