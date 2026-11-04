import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import { fingerprint, generateKemKeys } from "./kem";
import { INSTALL_URL, REPO_URL, decodePair, encodePair } from "./pair";

test("a pair ticket round-trips and fits in a QR code", async () => {
  const keys = generateKemKeys();
  const text = encodePair({
    repo: REPO_URL,
    role: "sensor",
    transport: "optical",
    fingerprint: fingerprint(keys.publicKey),
    publicKey: keys.publicKey,
  });
  const decoded = decodePair(text);
  assert.ok(!("error" in decoded));
  if ("error" in decoded) return;
  assert.equal(decoded.repo, REPO_URL);
  assert.equal(decoded.role, "sensor");
  assert.equal(decoded.transport, "optical");
  assert.deepEqual(decoded.publicKey, keys.publicKey);
  assert.ok(text.length < 2200);
  const url = await QRCode.toDataURL(text, { errorCorrectionLevel: "L", margin: 1, width: 320 });
  assert.ok(url.startsWith("data:image/png;base64,"));
  const install = await QRCode.toDataURL(INSTALL_URL, { errorCorrectionLevel: "M", margin: 1, width: 280 });
  assert.ok(install.startsWith("data:image/png;base64,"));
});

test("a damaged pair ticket is refused", () => {
  const broken = decodePair("LIGI1\nrole=sensor\ntransport=video\npk=aaaa");
  assert.ok("error" in broken);
  const foreign = decodePair("https://example.test");
  assert.ok("error" in foreign);
});
