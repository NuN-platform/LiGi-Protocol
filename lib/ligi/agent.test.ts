import assert from "node:assert/strict";
import { test } from "node:test";
import { agentAcceptPair, agentKeygen, agentOpen, agentOpticalFrame, agentRead, agentVerifyAck } from "./agent";

test("two agents complete an ML-KEM session from a pair ticket", async () => {
  const reader = agentKeygen("optical");
  const accepted = agentAcceptPair(reader.pair);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.fingerprint, reader.fingerprint);
  assert.equal(accepted.publicKey, reader.publicKey);

  const text = "Agent to agent. The gate is open.";
  const sender = await agentOpen({ payload: text, publicKey: accepted.publicKey, transport: "optical" });
  assert.equal(sender.ok, true);
  assert.ok(sender.frames.length > 0);

  const opened = await agentRead({ frames: sender.frames, secretKey: reader.secretKey });
  assert.equal(opened.ok, true, opened.ok ? "" : opened.error);
  if (!opened.ok) return;
  assert.equal(opened.text, text);
  assert.equal(opened.hashHex, sender.hashHex);
  assert.equal(opened.secretHash, sender.secretHash);
  const ack = agentVerifyAck({
    sessionId: sender.sessionId,
    hashHex: opened.hashHex,
    ackHex: opened.ackHex,
    sharedSecret: sender.sharedSecret ?? "",
  });
  assert.equal(ack.match, true);
});

test("an agent recovers a color-shifted optical frame", async () => {
  const reader = agentKeygen("video");
  const text = "video codec";
  const shifted = await agentOpticalFrame({ payload: text, publicKey: reader.publicKey });
  const opened = await agentRead({ frames: shifted.frames, secretKey: reader.secretKey });
  assert.equal(opened.ok, true, opened.ok ? "" : opened.error);
  if (!opened.ok) return;
  assert.equal(opened.text, text);
  assert.equal(opened.hashHex, shifted.hashHex);
});

test("a network ciphertext stays off the painted frames until the reader receives it", async () => {
  const reader = agentKeygen("optical");
  const sender = await agentOpen({ payload: "fallback", publicKey: reader.publicKey, transport: "network" });
  assert.ok(sender.cipherText);
  const waiting = await agentRead({ frames: sender.frames, secretKey: reader.secretKey });
  assert.equal(waiting.ok, false);
  const opened = await agentRead({ frames: sender.frames, secretKey: reader.secretKey, cipherText: sender.cipherText ?? undefined });
  assert.equal(opened.ok, true, opened.ok ? "" : opened.error);
  if (opened.ok) assert.equal(opened.text, "fallback");
});
