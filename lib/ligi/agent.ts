import { ackEqual, ackKey, hmacAck } from "./ack";
import { gapFor, lockPanel, readCells, type CapturedFrame } from "./frame";
import { base64ToBytes, bytesToBase64, fingerprint, generateKemKeys, MLKEM768 } from "./kem";
import { normalizeSeen, OPTICAL_COLOR_SLACK } from "./optical";
import { REPO_URL, decodePair, encodePair, type PairTransport } from "./pair";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openCaptured, prepareSession, renderFrame, type KemTransport } from "./session";

export type AgentFrame = {
  sessionId: string;
  sequence: number;
  symbolSize: number;
  blockCount: number;
  payloadLength: number;
  gzip: boolean;
  encrypted: boolean;
  hashPrefix: string;
  symbol: string;
};

const GEOMETRY = { cellPx: 18, gap: gapFor(18), stride: 1 };

function hex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function compact(frame: CapturedFrame): AgentFrame {
  return {
    sessionId: hex(frame.sessionId),
    sequence: frame.sequence,
    symbolSize: frame.symbolSize,
    blockCount: frame.blockCount,
    payloadLength: frame.payloadLength,
    gzip: frame.gzip,
    encrypted: frame.encrypted,
    hashPrefix: hex(frame.hashPrefix),
    symbol: bytesToBase64(frame.symbol),
  };
}

export function expandFrame(frame: AgentFrame): CapturedFrame {
  return {
    sessionId: fromHex(frame.sessionId),
    sequence: frame.sequence,
    symbolSize: frame.symbolSize,
    blockCount: frame.blockCount,
    payloadLength: frame.payloadLength,
    gzip: frame.gzip,
    encrypted: frame.encrypted,
    hashPrefix: fromHex(frame.hashPrefix),
    symbol: base64ToBytes(frame.symbol),
  };
}

export function agentKeygen(transport: PairTransport = "optical") {
  const keys = generateKemKeys();
  const keyPrint = fingerprint(keys.publicKey);
  const pair = encodePair({
    repo: REPO_URL,
    role: "sensor",
    transport,
    fingerprint: keyPrint,
    publicKey: keys.publicKey,
  });
  return {
    ok: true as const,
    publicKey: bytesToBase64(keys.publicKey),
    secretKey: bytesToBase64(keys.secretKey),
    fingerprint: keyPrint,
    pair,
  };
}

export async function agentOpen(input: { payload: string; publicKey: string; transport?: KemTransport; symbolSize?: number }) {
  const publicKey = base64ToBytes(input.publicKey);
  if (publicKey.length !== MLKEM768.publicKeyBytes) throw new Error("The reader public key is not an ML-KEM-768 key.");
  const transport = input.transport ?? "optical";
  const session = await prepareSession(input.payload, {
    symbolSize: input.symbolSize ?? 32,
    kem: { publicKey, transport },
  });
  const frames: AgentFrame[] = [];
  for (let sequence = 0; sequence < session.frameCount; sequence++) {
    const rendered = renderFrame(session, sequence, GEOMETRY);
    const locked = lockPanel(rendered.panel, GEOMETRY);
    if (!locked.ok) throw new Error(locked.reason);
    const read = readCells(locked.cells);
    if (!read.ok) throw new Error(read.reason);
    frames.push(compact(read.frame));
  }
  return {
    ok: true as const,
    sessionId: hex(session.sessionId),
    hashHex: session.hashHex,
    secretHash: session.secretHash,
    sharedSecret: session.sharedSecret ? bytesToBase64(session.sharedSecret) : null,
    cipherText: session.kemCipherText ? bytesToBase64(session.kemCipherText) : null,
    frames,
  };
}

export async function agentRead(input: { frames: AgentFrame[]; secretKey: string; cipherText?: string }) {
  const secretKey = base64ToBytes(input.secretKey);
  const frames = input.frames.map(expandFrame);
  const opened = await openCaptured(frames, {
    kemSecret: secretKey,
    kemCipherText: input.cipherText ? base64ToBytes(input.cipherText) : undefined,
  });
  if (!opened.ok) return { ok: false as const, error: opened.reason };
  return {
    ok: true as const,
    text: opened.text,
    hashHex: opened.hashHex,
    ackHex: opened.ackHex,
    secretHash: opened.secretHash,
  };
}

export function agentVerifyAck(input: { sessionId: string; hashHex: string; ackHex: string; sharedSecret: string }) {
  const mac = hmacAck(ackKey(fromHex(input.sessionId), base64ToBytes(input.sharedSecret)), fromHex(input.sessionId), fromHex(input.hashHex));
  return { ok: true as const, match: ackEqual(mac, fromHex(input.ackHex)) };
}

/** A camera-like copy of one painted frame, used to prove the optical add-on still opens. */
export async function agentOpticalFrame(input: { payload: string; publicKey: string }) {
  const publicKey = base64ToBytes(input.publicKey);
  const session = await prepareSession(input.payload, { symbolSize: 32, kem: { publicKey, transport: "optical" } });
  const frames: AgentFrame[] = [];
  for (let sequence = 0; sequence < session.frameCount; sequence++) {
    const rendered = renderFrame(session, sequence, GEOMETRY);
    const rgba = new Uint8ClampedArray(rendered.panel.rgba);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = Math.min(255, rgba[i] + 6);
      rgba[i + 1] = Math.max(0, rgba[i + 1] - 4);
      rgba[i + 2] = Math.min(255, rgba[i + 2] + 3);
    }
    const seen = normalizeSeen({ rgba, width: rendered.panel.width, height: rendered.panel.height }, GEOMETRY, OPTICAL_COLOR_SLACK);
    if (!seen.ok) throw new Error(seen.reason);
    const locked = lockPanel(seen.panel, GEOMETRY);
    if (!locked.ok) throw new Error(locked.reason);
    const read = readCells(locked.cells);
    if (!read.ok) throw new Error(read.reason);
    frames.push(compact(read.frame));
  }
  return { frames, hashHex: session.hashHex };
}

export function agentAcceptPair(pair: string) {
  const ticket = decodePair(pair);
  if ("error" in ticket) return { ok: false as const, error: ticket.error };
  return {
    ok: true as const,
    fingerprint: ticket.fingerprint,
    publicKey: bytesToBase64(ticket.publicKey),
    transport: ticket.transport,
    repo: ticket.repo,
  };
}
