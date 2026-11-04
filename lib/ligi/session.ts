import { gzipSync, gunzipSync } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ackKey, hmacAck } from "./ack";
import {
  CELL_GAP,
  CELL_PX,
  lockPanel,
  occludePanel,
  paintCells,
  readCells,
  renderPanel,
  type CapturedFrame,
  type Geometry,
  type Panel,
} from "./frame";
import { writeHeader } from "./header";
import { decapsulate, encapsulate, fingerprint } from "./kem";
import { decodeSymbols, encodeSymbol, neighborsFor, scheduleLength, splitSources, type EncodedSymbol } from "./lt";
import { robustSolitonCdf } from "./soliton";

export const MAX_PLAINTEXT_BYTES = 3200;
export const MAX_BLOCKS = 72;

export type KemTransport = "optical" | "network";

const FLAG_GZIP = 1;
const FLAG_PASSPHRASE = 2;
const FLAG_KEM_OPTICAL = 4;
const FLAG_KEM_NETWORK = 8;

export type Session = {
  sessionId: Uint8Array;
  symbolSize: number;
  k: number;
  payloadLength: number;
  gzip: boolean;
  encrypted: boolean;
  kem: "off" | KemTransport;
  kemCipherText: Uint8Array | null;
  sharedSecret: Uint8Array | null;
  secretHash: string | null;
  hashPrefix: Uint8Array;
  hashHex: string;
  sources: Uint8Array[];
  cdf: number[];
  frameCount: number;
};

export type RenderedFrame = {
  sequence: number;
  panel: Panel;
  headerBytes: Uint8Array;
};

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 12000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importAes(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealWithSecret(body: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
  const key = await importAes(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(body)));
  const packed = new Uint8Array(12 + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, 12);
  return packed;
}

async function unsealWithSecret(packed: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
  if (packed.length < 13) throw new Error("Sealed body is too short.");
  const key = await importAes(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(packed.subarray(0, 12)) },
    key,
    new Uint8Array(packed.subarray(12)),
  );
  return new Uint8Array(plain);
}

function packCipherText(cipherText: Uint8Array, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + cipherText.length + body.length);
  out[0] = (cipherText.length >> 8) & 255;
  out[1] = cipherText.length & 255;
  out.set(cipherText, 2);
  out.set(body, 2 + cipherText.length);
  return out;
}

async function seal(body: Uint8Array, passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(body)));
  const packed = new Uint8Array(12 + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, 12);
  return packed;
}

async function unseal(packed: Uint8Array, passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  if (packed.length < 13) throw new Error("Sealed body is too short.");
  const key = await deriveKey(passphrase, salt);
  const iv = packed.subarray(0, 12);
  const cipher = packed.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(cipher));
  return new Uint8Array(plain);
}

function preface(plainLength: number, flags: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length);
  out[0] = 1;
  out[1] = flags;
  out[2] = (plainLength >> 8) & 255;
  out[3] = plainLength & 255;
  out.set(body, 4);
  return out;
}

export async function prepareSession(
  text: string,
  options: {
    symbolSize?: number;
    passphrase?: string;
    sessionId?: Uint8Array;
    kem?: { publicKey: Uint8Array; transport: KemTransport };
  } = {},
): Promise<Session> {
  const symbolSize = options.symbolSize ?? 48;
  const plain = new TextEncoder().encode(text);
  if (plain.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`This gate carries ${MAX_PLAINTEXT_BYTES} bytes. Shorten the payload.`);
  }
  const sessionId = options.sessionId ? options.sessionId.slice(0, 8) : crypto.getRandomValues(new Uint8Array(8));
  if (sessionId.length !== 8) throw new Error("Session id must be 8 bytes.");

  let body: Uint8Array = plain;
  let gzip = false;
  if (plain.length > 64) {
    const compressed = gzipSync(plain);
    if (compressed.length < plain.length) {
      body = compressed;
      gzip = true;
    }
  }
  const passphrase = options.passphrase?.trim() ?? "";
  if (options.kem && passphrase.length > 0) {
    throw new Error("Use ML-KEM or a passphrase, not both.");
  }
  const encrypted = passphrase.length > 0;
  if (encrypted && passphrase.length < 8) {
    throw new Error("Use at least 8 characters, or leave the passphrase empty.");
  }
  if (encrypted) body = await seal(body, passphrase, sessionId);

  let kem: Session["kem"] = "off";
  let kemCipherText: Uint8Array | null = null;
  let sharedSecret: Uint8Array | null = null;
  let secretHash: string | null = null;
  if (options.kem) {
    const wrapped = encapsulate(options.kem.publicKey);
    kem = options.kem.transport;
    kemCipherText = wrapped.cipherText;
    sharedSecret = wrapped.sharedSecret;
    secretHash = fingerprint(sharedSecret);
    body = await sealWithSecret(body, sharedSecret);
    if (kem === "optical") body = packCipherText(kemCipherText, body);
  }

  const flags =
    (gzip ? FLAG_GZIP : 0) |
    (encrypted ? FLAG_PASSPHRASE : 0) |
    (kem === "optical" ? FLAG_KEM_OPTICAL : 0) |
    (kem === "network" ? FLAG_KEM_NETWORK : 0);
  const payload = preface(plain.length, flags, body);
  const sources = splitSources(payload, symbolSize);
  if (sources.length > MAX_BLOCKS) {
    throw new Error(
      kem === "optical"
        ? "Optical ML-KEM ciphertext does not fit this panel. Shorten the payload, or use network ciphertext fallback."
        : "Payload is too large for this gate after sealing.",
    );
  }
  const hash = sha256(plain);
  return {
    sessionId,
    symbolSize,
    k: sources.length,
    payloadLength: payload.length,
    gzip,
    encrypted: encrypted || kem !== "off",
    kem,
    kemCipherText,
    sharedSecret,
    secretHash,
    hashPrefix: hash.slice(0, 4),
    hashHex: bytesToHex(hash),
    sources,
    cdf: robustSolitonCdf(sources.length),
    frameCount: scheduleLength(sources.length),
  };
}

export function renderFrame(session: Session, sequence: number, geometry?: Geometry): RenderedFrame {
  const wrapped = sequence % session.frameCount;
  const encoded = encodeSymbol(session.sources, wrapped, session.sessionId, session.cdf);
  const headerBytes = writeHeader({
    sessionId: session.sessionId,
    sequence: wrapped,
    symbolSize: session.symbolSize,
    blockCount: session.k,
    payloadLength: session.payloadLength,
    gzip: session.gzip,
    encrypted: session.encrypted,
    hashPrefix: session.hashPrefix,
  });
  const cells = paintCells(headerBytes, encoded.data, session.sessionId, wrapped);
  const cellPx = geometry?.cellPx ?? CELL_PX;
  const gap = geometry?.gap ?? CELL_GAP;
  return { sequence: wrapped, panel: renderPanel(cells, cellPx, gap), headerBytes };
}

export type OpenOptions = {
  passphrase?: string;
  kemSecret?: Uint8Array;
  kemCipherText?: Uint8Array;
};

export type OpenResult =
  | {
      ok: true;
      text: string;
      hashHex: string;
      symbolsUsed: number;
      encrypted: boolean;
      ackHex: string;
      secretHash: string | null;
    }
  | { ok: false; reason: string; symbolsUsed: number; encrypted: boolean };

export async function openCaptured(frames: CapturedFrame[], passphraseOrOptions: string | OpenOptions = ""): Promise<OpenResult> {
  const options: OpenOptions = typeof passphraseOrOptions === "string" ? { passphrase: passphraseOrOptions } : passphraseOrOptions;
  const passphrase = options.passphrase ?? "";
  const unique = new Map<number, CapturedFrame>();
  for (const frame of frames) unique.set(frame.sequence, frame);
  const list = [...unique.values()];
  const encrypted = list.some((frame) => frame.encrypted);
  if (list.length === 0) return { ok: false, reason: "No frames yet.", symbolsUsed: 0, encrypted };

  const first = list[0];
  const same = list.filter(
    (frame) =>
      bytesToHex(frame.sessionId) === bytesToHex(first.sessionId) &&
      frame.blockCount === first.blockCount &&
      frame.symbolSize === first.symbolSize &&
      frame.payloadLength === first.payloadLength,
  );
  const symbols: EncodedSymbol[] = same.map((frame) => ({
    sequence: frame.sequence,
    neighbors: neighborsFor(frame.blockCount, frame.sequence, frame.sessionId),
    data: frame.symbol,
  }));
  const decoded = decodeSymbols(first.blockCount, symbols, first.symbolSize);
  if (!decoded) {
    const target = Math.ceil(first.blockCount * 1.15);
    return {
      ok: false,
      reason: `Rank is still short. ${same.length} distinct symbols are in hand, and the design target is about ${target}.`,
      symbolsUsed: same.length,
      encrypted,
    };
  }

  const payload = decoded.subarray(0, first.payloadLength);
  if (payload.length < 4 || payload[0] !== 1) {
    return { ok: false, reason: "Recovered bytes are not a LiGi payload.", symbolsUsed: same.length, encrypted };
  }
  const flags = payload[1];
  const plainLength = (payload[2] << 8) | payload[3];
  const gzip = (flags & FLAG_GZIP) !== 0;
  const sealed = (flags & FLAG_PASSPHRASE) !== 0;
  const kemOptical = (flags & FLAG_KEM_OPTICAL) !== 0;
  const kemNetwork = (flags & FLAG_KEM_NETWORK) !== 0;
  const kemOn = kemOptical || kemNetwork;
  if (gzip !== first.gzip || sealed !== (first.encrypted && !kemOn)) {
    return { ok: false, reason: "Header flags and the payload preface disagree.", symbolsUsed: same.length, encrypted };
  }

  try {
    let body = payload.subarray(4);
    let shared: Uint8Array | null = null;
    if (kemOptical) {
      if (!options.kemSecret) {
        return { ok: false, reason: "This session wants the sensor ML-KEM secret.", symbolsUsed: same.length, encrypted: true };
      }
      if (body.length < 2) {
        return { ok: false, reason: "Optical ciphertext is missing.", symbolsUsed: same.length, encrypted: true };
      }
      const length = (body[0] << 8) | body[1];
      if (body.length < 2 + length) {
        return { ok: false, reason: "Optical ciphertext is truncated.", symbolsUsed: same.length, encrypted: true };
      }
      shared = decapsulate(body.subarray(2, 2 + length), options.kemSecret);
      body = await unsealWithSecret(body.subarray(2 + length), shared);
    } else if (kemNetwork) {
      if (!options.kemSecret || !options.kemCipherText) {
        return {
          ok: false,
          reason: "Network ciphertext has not arrived. The sensor is still waiting for the ML-KEM fallback.",
          symbolsUsed: same.length,
          encrypted: true,
        };
      }
      shared = decapsulate(options.kemCipherText, options.kemSecret);
      body = await unsealWithSecret(body, shared);
    } else if (sealed) {
      if (!passphrase.trim()) {
        return { ok: false, reason: "This session wants a passphrase on the sensor.", symbolsUsed: same.length, encrypted: true };
      }
      body = await unseal(body, passphrase.trim(), first.sessionId);
    }
    if (gzip) body = gunzipSync(body);
    if (body.length !== plainLength) {
      return { ok: false, reason: "Plaintext length does not match the preface.", symbolsUsed: same.length, encrypted: sealed };
    }
    const hash = sha256(body);
    const prefix = hash.slice(0, 4);
    const matches = prefix.every((byte, index) => byte === first.hashPrefix[index]);
    if (!matches) {
      return { ok: false, reason: "SHA-256 prefix does not match the frame header.", symbolsUsed: same.length, encrypted: sealed };
    }
    const ack = hmacAck(ackKey(first.sessionId, shared), first.sessionId, hash);
    return {
      ok: true,
      text: new TextDecoder().decode(body),
      hashHex: bytesToHex(hash),
      symbolsUsed: same.length,
      encrypted: sealed || kemOn,
      ackHex: bytesToHex(ack),
      secretHash: shared ? fingerprint(shared) : null,
    };
  } catch {
    return {
      ok: false,
      reason: kemOn ? "The ML-KEM secret did not open this payload." : sealed ? "The passphrase did not open this payload." : "The payload could not be opened.",
      symbolsUsed: same.length,
      encrypted: sealed || kemOn,
    };
  }
}

export function ingestPanel(
  panel: Panel,
  options: { loss: number; occlusion: number; rng: () => number; geometry?: Geometry },
): { kind: "drop" } | { kind: "reject"; reason: string } | { kind: "frame"; frame: CapturedFrame } {
  if (options.rng() < options.loss) return { kind: "drop" };
  const viewed = options.occlusion > 0 ? occludePanel(panel, options.occlusion, options.rng) : panel;
  const geometry = options.geometry ?? { cellPx: CELL_PX, gap: CELL_GAP, stride: 1 };
  const locked = lockPanel(viewed, geometry);
  if (!locked.ok) return { kind: "reject", reason: locked.reason };
  const read = readCells(locked.cells);
  if (!read.ok) return { kind: "reject", reason: read.reason };
  return { kind: "frame", frame: read.frame };
}
