import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ackEqual, ackKey, hmacAck } from "./ack";
import { gapFor } from "./frame";
import { base64ToBytes, bytesToBase64, decapsulate, encapsulate, fingerprint, generateKemKeys } from "./kem";
import { ingestPanel, openCaptured, prepareSession, renderFrame } from "./session";
import { mulberry32 } from "./rng";

test("ML-KEM shared secrets match and the fingerprint round-trips", () => {
  const keys = generateKemKeys();
  const wrapped = encapsulate(keys.publicKey);
  const opened = decapsulate(wrapped.cipherText, keys.secretKey);
  assert.ok(ackEqual(opened, wrapped.sharedSecret));
  assert.equal(fingerprint(keys.publicKey).length, 16);
  assert.deepEqual(base64ToBytes(bytesToBase64(keys.publicKey)), keys.publicKey);
});

test("optical ML-KEM survives the c8 stride and returns a matching ACK", async () => {
  const keys = generateKemKeys();
  const text = "c8 optical";
  const session = await prepareSession(text, {
    symbolSize: 48,
    sessionId: Uint8Array.from([8, 6, 5, 4, 3, 2, 1, 9]),
    kem: { publicKey: keys.publicKey, transport: "optical" },
  });
  assert.equal(session.kem, "optical");
  assert.equal(session.encrypted, true);
  assert.ok(session.sharedSecret);
  const geometry = { cellPx: 8, gap: gapFor(8), stride: 6 };
  const frames = [];
  for (let seq = 0; seq < session.frameCount; seq++) {
    const rendered = renderFrame(session, seq, geometry);
    const ingested = ingestPanel(rendered.panel, { loss: 0.15, occlusion: 0, rng: mulberry32(seq + 11), geometry });
    if (ingested.kind === "frame") frames.push(ingested.frame);
  }
  const missing = await openCaptured(frames, {});
  assert.equal(missing.ok, false);
  const opened = await openCaptured(frames, { kemSecret: keys.secretKey });
  assert.equal(opened.ok, true, opened.ok ? "" : opened.reason);
  if (!opened.ok) return;
  assert.equal(opened.text, text);
  assert.equal(opened.hashHex, session.hashHex);
  assert.equal(opened.secretHash, session.secretHash);
  const hash = sha256(new TextEncoder().encode(text));
  const mac = hmacAck(ackKey(session.sessionId, session.sharedSecret), session.sessionId, hash);
  assert.equal(opened.ackHex, bytesToHex(mac));
});

test("network ciphertext fallback opens when the optical payload omits the ciphertext", async () => {
  const keys = generateKemKeys();
  const text = "fallback path";
  const session = await prepareSession(text, {
    symbolSize: 32,
    kem: { publicKey: keys.publicKey, transport: "network" },
  });
  assert.equal(session.kem, "network");
  assert.ok(session.kemCipherText);
  const frames = [];
  for (let seq = 0; seq < session.k; seq++) {
    const rendered = renderFrame(session, seq);
    const ingested = ingestPanel(rendered.panel, { loss: 0, occlusion: 0, rng: mulberry32(1) });
    if (ingested.kind === "frame") frames.push(ingested.frame);
  }
  const waiting = await openCaptured(frames, { kemSecret: keys.secretKey });
  assert.equal(waiting.ok, false);
  const opened = await openCaptured(frames, { kemSecret: keys.secretKey, kemCipherText: session.kemCipherText ?? undefined });
  assert.equal(opened.ok, true, opened.ok ? "" : opened.reason);
  if (opened.ok) assert.equal(opened.text, text);
});
