import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Clear sessions key the ACK with the session id. ML-KEM sessions key it with the shared secret. */
export function ackKey(sessionId: Uint8Array, sharedSecret?: Uint8Array | null): Uint8Array {
  if (sharedSecret && sharedSecret.length > 0) return sharedSecret;
  return sha256(sessionId);
}

export function hmacAck(key: Uint8Array, sessionId: Uint8Array, payloadHash: Uint8Array): Uint8Array {
  const message = new Uint8Array(sessionId.length + payloadHash.length);
  message.set(sessionId, 0);
  message.set(payloadHash, sessionId.length);
  return hmac(sha256, key, message);
}

export function ackEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
