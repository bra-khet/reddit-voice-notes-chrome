import { decodeBase64 } from '@/src/messaging/binary';

const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

export function expectedBase64CharLength(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

export function assertBase64PayloadShape(
  dataBase64: string,
  byteLength: number,
  label: string,
): void {
  if (!dataBase64 || byteLength <= 0) {
    throw new Error(`${label}: binary payload is empty before extension relay.`);
  }

  const expectedChars = expectedBase64CharLength(byteLength);
  const charDelta = Math.abs(dataBase64.length - expectedChars);
  if (charDelta > 4) {
    throw new Error(
      `${label}: base64 length mismatch (bytes=${byteLength}, chars=${dataBase64.length}, expected≈${expectedChars}).`,
    );
  }
}

export function assertWebmBytes(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength < 256) {
    throw new Error(`${label}: WebM payload is too small (${bytes.byteLength} bytes).`);
  }
  const validMagic = WEBM_EBML_MAGIC.every((value, index) => bytes[index] === value);
  if (!validMagic) {
    throw new Error(`${label}: WebM EBML header missing after decode.`);
  }
}

export function assertMp4Bytes(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength < 12) {
    throw new Error(`${label}: MP4 payload is too small (${bytes.byteLength} bytes).`);
  }
  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (boxType !== 'ftyp') {
    throw new Error(`${label}: MP4 ftyp box missing after FFmpeg (got "${boxType}").`);
  }
}

export function verifyWebmPackedBinary(packed: {
  dataBase64: string;
  byteLength: number;
}): void {
  assertBase64PayloadShape(packed.dataBase64, packed.byteLength, 'WebM pack');
  const decoded = decodeBase64(packed.dataBase64, packed.byteLength);
  assertWebmBytes(decoded, 'WebM pack');
}

export function verifyMp4PackedBinary(packed: {
  dataBase64: string;
  byteLength: number;
}): void {
  assertBase64PayloadShape(packed.dataBase64, packed.byteLength, 'MP4 pack');
  const decoded = decodeBase64(packed.dataBase64, packed.byteLength);
  assertMp4Bytes(decoded, 'MP4 pack');
}