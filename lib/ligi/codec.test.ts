import assert from "node:assert/strict";
import { test } from "node:test";
import { CELL_GAP, CELL_PX, cornerLineFit, gapFor, lockPanel, readCells, renderPanel, rgbaToCells, samplePanel } from "./frame";
import { HEADER_BYTES, readHeader, writeHeader } from "./header";
import { photonicHandshake } from "./handshake";
import { decodeSymbols, encodeSymbol, neighborsFor, splitSources } from "./lt";
import { mulberry32 } from "./rng";
import { ingestPanel, openCaptured, prepareSession, renderFrame } from "./session";
import { robustSolitonCdf, sampleDegree } from "./soliton";

const sessionId = Uint8Array.from([4, 18, 22, 7, 9, 3, 11, 28]);

test("header is 24 bytes and round-trips the lab flags", () => {
  const bytes = writeHeader({
    sessionId,
    sequence: 19,
    symbolSize: 48,
    blockCount: 6,
    payloadLength: 200,
    gzip: true,
    encrypted: true,
    hashPrefix: Uint8Array.from([1, 2, 3, 4]),
  });
  assert.equal(bytes.length, HEADER_BYTES);
  const header = readHeader(bytes);
  assert.ok(!("error" in header));
  if ("error" in header) return;
  assert.equal(header.sequence, 19);
  assert.equal(header.gzip, true);
  assert.equal(header.encrypted, true);
  assert.equal(header.payloadLength, 200);
  assert.deepEqual(header.hashPrefix, Uint8Array.from([1, 2, 3, 4]));
});

test("neighbor sets are stable for a session and sequence", () => {
  const a = neighborsFor(12, 20, sessionId);
  const b = neighborsFor(12, 20, sessionId);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 1);
  assert.deepEqual(neighborsFor(12, 3, sessionId), [3]);
});

test("soliton degrees stay inside 1..k", () => {
  const cdf = robustSolitonCdf(17);
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const degree = sampleDegree(cdf, rng);
    assert.ok(degree >= 1 && degree <= 17);
  }
});

test("xor fountain round-trip with no loss", () => {
  const payload = new TextEncoder().encode("gate-check");
  const sources = splitSources(payload, 8);
  const symbols = sources.map((_, sequence) => encodeSymbol(sources, sequence, sessionId));
  const decoded = decodeSymbols(sources.length, symbols, 8);
  assert.ok(decoded);
  assert.equal(new TextDecoder().decode(decoded!.subarray(0, payload.length)), "gate-check");
});

test("clear pixel loop restores a short message", async () => {
  const text = "Poruka za čvor.";
  const session = await prepareSession(text, { symbolSize: 32, sessionId });
  const frames = [];
  for (let seq = 0; seq < session.k; seq++) {
    const rendered = renderFrame(session, seq);
    const sampled = samplePanel(rendered.panel, CELL_PX, CELL_GAP);
    const cells = rgbaToCells(sampled);
    assert.equal(cells.ok, true);
    if (!cells.ok) return;
    const read = readCells(cells.cells);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    frames.push(read.frame);
  }
  const opened = await openCaptured(frames);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(opened.text, text);
  assert.equal(opened.hashHex, session.hashHex);
});

test("thirty percent frame loss still opens the payload", async () => {
  const text = "LiGi ".repeat(90);
  const session = await prepareSession(text, { symbolSize: 32, sessionId });
  const rng = mulberry32(99);
  const frames = [];
  for (let seq = 0; seq < session.frameCount; seq++) {
    const rendered = renderFrame(session, seq);
    const ingested = ingestPanel(rendered.panel, { loss: 0.3, occlusion: 0, rng });
    if (ingested.kind === "frame") frames.push(ingested.frame);
  }
  const opened = await openCaptured(frames);
  assert.equal(opened.ok, true, opened.ok ? "" : opened.reason);
  if (!opened.ok) return;
  assert.equal(opened.text, text);
});

test("occlusion rejects the damaged frame", async () => {
  const session = await prepareSession("occlusion", { symbolSize: 32, sessionId });
  const rendered = renderFrame(session, 0);
  const rng = mulberry32(3);
  const ingested = ingestPanel(rendered.panel, { loss: 0, occlusion: 0.35, rng });
  assert.equal(ingested.kind, "reject");
});

test("passphrase seals the pixel path", async () => {
  const text = "sealed for the other window";
  const session = await prepareSession(text, { symbolSize: 32, sessionId, passphrase: "correct-horse" });
  assert.equal(session.encrypted, true);
  const frames = [];
  for (let seq = 0; seq < session.frameCount; seq++) {
    const rendered = renderFrame(session, seq);
    const ingested = ingestPanel(rendered.panel, { loss: 0.1, occlusion: 0, rng: mulberry32(seq + 5) });
    if (ingested.kind === "frame") frames.push(ingested.frame);
  }
  const locked = await openCaptured(frames, "");
  assert.equal(locked.ok, false);
  const wrong = await openCaptured(frames, "wrong-pass");
  assert.equal(wrong.ok, false);
  const opened = await openCaptured(frames, "correct-horse");
  assert.equal(opened.ok, true);
  if (opened.ok) assert.equal(opened.text, text);
});

test("photonic signature keeps the GitHub label", () => {
  const dark = photonicHandshake(0, 1_700_000_000);
  assert.equal(dark.state, "HARDWARE_DARK_HANDSHAKE");
  assert.equal(dark.quantumWeight, 0.62);
  assert.ok(dark.signature.startsWith("VSha-3946_LIGI_v5.2_OPTICAL_"));
  const lit = photonicHandshake(200, 1_700_000_000);
  assert.equal(lit.state, "ACTIVE_PHOTONIC_HANDSHAKE");
  assert.equal(lit.quantumWeight, 1.01);
  assert.notEqual(lit.signature, dark.signature);
  const again = photonicHandshake(200, 1_700_000_000);
  assert.equal(again.signature, lit.signature);
});

test("panel bitmap samples back to the same cells", () => {
  const cells = new Uint8Array(32 * 16);
  for (let i = 0; i < cells.length; i++) cells[i] = (i * 17) & 255;
  const panel = renderPanel(cells);
  const sampled = samplePanel(panel);
  const back = rgbaToCells(sampled);
  assert.equal(back.ok, true);
  if (back.ok) assert.deepEqual(back.cells, cells);
});

test("c8 stride locks a padded panel and line-fit rejects a skewed edge", async () => {
  const session = await prepareSession("padded", { symbolSize: 32, sessionId });
  const cellPx = 8;
  const gap = gapFor(cellPx);
  const rendered = renderFrame(session, 0, { cellPx, gap, stride: 6 });
  const margin = 12;
  const width = rendered.panel.width + margin * 2;
  const height = rendered.panel.height + margin * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(30);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  for (let y = 0; y < rendered.panel.height; y++) {
    for (let x = 0; x < rendered.panel.width; x++) {
      const src = (y * rendered.panel.width + x) * 4;
      const dst = ((y + margin) * width + (x + margin)) * 4;
      rgba[dst] = rendered.panel.rgba[src];
      rgba[dst + 1] = rendered.panel.rgba[src + 1];
      rgba[dst + 2] = rendered.panel.rgba[src + 2];
      rgba[dst + 3] = 255;
    }
  }
  const locked = lockPanel({ rgba, width, height }, { cellPx, gap, stride: 6 });
  assert.equal(locked.ok, true, locked.ok ? "" : locked.reason);
  if (!locked.ok) return;
  const read = readCells(locked.cells);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.frame.sequence, 0);

  const skewed = cornerLineFit({ x: 4, y: 4 }, { x: 80, y: 20 }, { x: 4, y: 40 }, 3);
  assert.equal(skewed, "Line-fit rejected the top edge.");
  const aligned = cornerLineFit({ x: 4, y: 4 }, { x: 80, y: 5 }, { x: 5, y: 40 }, 3);
  assert.equal(aligned, null);
});
