export const HEADER_BYTES = 24;

/**
 * 24-byte self-describing header from LiGi whitepaper v2, plus two lab flags
 * packed into the payload-length word. The whitepaper leaves compression and
 * cipher flags unspecified, so bit 31 means gzip and bit 30 means AES-256-GCM.
 */
export type FrameHeader = {
  sessionId: Uint8Array;
  sequence: number;
  symbolSize: number;
  blockCount: number;
  payloadLength: number;
  gzip: boolean;
  encrypted: boolean;
  hashPrefix: Uint8Array;
};

export function writeHeader(header: FrameHeader): Uint8Array {
  if (header.sessionId.length < 8) throw new Error("Session id must be 8 bytes");
  if (header.hashPrefix.length < 4) throw new Error("Hash prefix must be 4 bytes");
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes.set(header.sessionId.subarray(0, 8), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, header.sequence >>> 0);
  view.setUint16(12, header.symbolSize);
  view.setUint16(14, header.blockCount);
  let word = header.payloadLength & 0x3fffffff;
  if (header.gzip) word |= 0x80000000;
  if (header.encrypted) word |= 0x40000000;
  view.setUint32(16, word);
  bytes.set(header.hashPrefix.subarray(0, 4), 20);
  return bytes;
}

export function readHeader(bytes: Uint8Array): FrameHeader | { error: string } {
  if (bytes.length < HEADER_BYTES) return { error: "Header is short of 24 bytes." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = view.getUint32(16);
  const symbolSize = view.getUint16(12);
  const blockCount = view.getUint16(14);
  const payloadLength = word & 0x3fffffff;
  if (symbolSize < 8 || symbolSize > 256) return { error: "Symbol size is outside the lab range." };
  if (blockCount < 1 || blockCount > 512) return { error: "Block count is outside the lab range." };
  if (payloadLength > blockCount * symbolSize) return { error: "Payload length exceeds the symbol grid." };
  return {
    sessionId: bytes.slice(0, 8),
    sequence: view.getUint32(8),
    symbolSize,
    blockCount,
    payloadLength,
    gzip: (word & 0x80000000) !== 0,
    encrypted: (word & 0x40000000) !== 0,
    hashPrefix: bytes.slice(20, 24),
  };
}

export function headerHex(bytes: Uint8Array): string {
  return [...bytes.subarray(0, HEADER_BYTES)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")
    .replace(/((?:[0-9a-f]{2} ){7}[0-9a-f]{2}) /g, "$1\n");
}
