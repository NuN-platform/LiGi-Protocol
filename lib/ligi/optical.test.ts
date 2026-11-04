import assert from "node:assert/strict";
import { test } from "node:test";
import { gapFor, renderPanel } from "./frame";
import { OPTICAL_COLOR_SLACK, normalizeSeen } from "./optical";
import { prepareSession, renderFrame } from "./session";

test("a shifted camera-like frame still locks the same sequence", async () => {
  const sessionId = Uint8Array.from([4, 18, 22, 7, 9, 3, 11, 28]);
  const session = await prepareSession("optical add-on", { symbolSize: 32, sessionId });
  const cellPx = 8;
  const gap = gapFor(cellPx);
  const rendered = renderFrame(session, 0, { cellPx, gap, stride: 6 });
  const margin = 10;
  const width = rendered.panel.width + margin * 2;
  const height = rendered.panel.height + margin * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 18;
    rgba[i + 1] = 16;
    rgba[i + 2] = 14;
    rgba[i + 3] = 255;
  }
  for (let y = 0; y < rendered.panel.height; y++) {
    for (let x = 0; x < rendered.panel.width; x++) {
      const src = (y * rendered.panel.width + x) * 4;
      const dst = ((y + margin) * width + (x + margin)) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const shifted = rendered.panel.rgba[src + channel] + ((x + y + channel) % 17) - 8;
        rgba[dst + channel] = Math.max(0, Math.min(255, shifted));
      }
      rgba[dst + 3] = 255;
    }
  }
  const seen = normalizeSeen({ rgba, width, height }, { cellPx, gap, stride: 6 }, OPTICAL_COLOR_SLACK);
  assert.equal(seen.ok, true, seen.ok ? "" : seen.reason);
  if (!seen.ok) return;
  assert.equal(seen.sequence, 0);
  const clean = renderPanel(new Uint8Array(seen.panel.width), cellPx, gap);
  assert.equal(seen.panel.width, clean.width);
});
