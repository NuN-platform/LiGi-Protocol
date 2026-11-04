import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

export const MLKEM768 = {
  name: "ML-KEM-768",
  publicKeyBytes: 1184,
  cipherTextBytes: 1088,
  sharedSecretBytes: 32,
} as const;

export type KemKeys = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

export function generateKemKeys(): KemKeys {
  const keys = ml_kem768.keygen();
  return { publicKey: keys.publicKey, secretKey: keys.secretKey };
}

export function encapsulate(publicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (publicKey.length !== MLKEM768.publicKeyBytes) {
    throw new Error("ML-KEM-768 public key must be 1184 bytes.");
  }
  return ml_kem768.encapsulate(publicKey);
}

export function decapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (cipherText.length !== MLKEM768.cipherTextBytes) {
    throw new Error("ML-KEM-768 ciphertext must be 1088 bytes.");
  }
  return ml_kem768.decapsulate(cipherText, secretKey);
}

export function fingerprint(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes).slice(0, 8));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
