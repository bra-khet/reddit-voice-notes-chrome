/**
 * Binary transport for chrome.runtime.sendMessage / tabs.sendMessage.
 * Uint8Array and ArrayBuffer are NOT reliable across MV3 relay hops — use base64 strings.
 */

/** Keep small — String.fromCharCode.apply args must stay under engine limits. */
const BASE64_CHUNK = 0x2000;

export function encodeBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    throw new Error('Cannot encode empty binary payload.');
  }

  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + BASE64_CHUNK, bytes.length));
    // BUG FIX: 3-minute cap auto-stop hung FFmpeg / timed out
    // Fix: Avoid spread on large slices (stack overflow / silent encode failure on long recordings).
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return btoa(parts.join(''));
}

export function decodeBase64(base64: string | undefined | null, expectedLength?: number): Uint8Array {
  if (!base64) {
    throw new Error('Missing binary payload in extension message.');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  if (bytes.byteLength === 0) {
    throw new Error('Binary payload is empty (0 bytes).');
  }

  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    throw new Error(
      `Binary payload size mismatch: expected ${expectedLength} bytes, got ${bytes.byteLength}.`,
    );
  }

  return bytes;
}

export function packBinary(bytes: Uint8Array): { dataBase64: string; byteLength: number } {
  return {
    dataBase64: encodeBase64(bytes),
    byteLength: bytes.byteLength,
  };
}

export function unpackBinary(
  dataBase64: string | undefined | null,
  byteLength: number | undefined,
): Uint8Array {
  if (byteLength === undefined || byteLength <= 0) {
    throw new Error(`Invalid binary byteLength (${String(byteLength)}).`);
  }
  return decodeBase64(dataBase64, byteLength);
}