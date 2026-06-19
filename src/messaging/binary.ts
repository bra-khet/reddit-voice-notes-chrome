/** Binary payloads sent through chrome.runtime.sendMessage must use Uint8Array — ArrayBuffer often arrives empty after relay. */

export type BinaryWire = Uint8Array | ArrayBuffer;

export function toUint8Array(data: BinaryWire | undefined | null, expectedLength?: number): Uint8Array {
  if (data == null) {
    throw new Error('Missing binary payload in extension message.');
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

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

/** Fresh copy for the next messaging hop (avoids neutered/shared views). */
export function cloneBinaryForMessage(data: BinaryWire, expectedLength?: number): Uint8Array {
  return toUint8Array(data, expectedLength).slice();
}

export function toArrayBuffer(data: BinaryWire, expectedLength?: number): ArrayBuffer {
  const bytes = toUint8Array(data, expectedLength);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}