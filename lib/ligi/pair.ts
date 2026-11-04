import { bytesToBase64, base64ToBytes, fingerprint, MLKEM768 } from "./kem";

export const REPO_URL = "https://github.com/NuN-platform/LiGi-Protocol";
export const INSTALL_URL = `${REPO_URL}#install-on-any-machine`;

export type PairRole = "sensor" | "transmitter";
export type PairTransport = "optical" | "video";

export type PairTicket = {
  repo: string;
  role: PairRole;
  transport: PairTransport;
  fingerprint: string;
  publicKey: Uint8Array;
};

const ROLES = new Set<PairRole>(["sensor", "transmitter"]);
const TRANSPORTS = new Set<PairTransport>(["optical", "video"]);

export function encodePair(ticket: PairTicket): string {
  return [
    "LIGI1",
    `repo=${ticket.repo}`,
    `role=${ticket.role}`,
    `transport=${ticket.transport}`,
    `fp=${ticket.fingerprint}`,
    `pk=${bytesToBase64(ticket.publicKey)}`,
  ].join("\n");
}

export function decodePair(text: string): PairTicket | { error: string } {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "LIGI1") return { error: "That QR is not a LiGi pair ticket." };
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const split = line.indexOf("=");
    if (split <= 0) return { error: "The pair ticket is missing a field." };
    fields.set(line.slice(0, split), line.slice(split + 1));
  }
  const role = fields.get("role");
  const transport = fields.get("transport");
  const printed = fields.get("fp");
  const keyText = fields.get("pk");
  const repo = fields.get("repo") || REPO_URL;
  if (!role || !ROLES.has(role as PairRole)) return { error: "The pair ticket has no role." };
  if (!transport || !TRANSPORTS.has(transport as PairTransport)) return { error: "The pair ticket has no transport." };
  if (!keyText) return { error: "The pair ticket has no public key." };
  let publicKey: Uint8Array;
  try {
    publicKey = base64ToBytes(keyText);
  } catch {
    return { error: "The public key in the pair ticket is not base64." };
  }
  if (publicKey.length !== MLKEM768.publicKeyBytes) return { error: "The public key is not an ML-KEM-768 key." };
  const actual = fingerprint(publicKey);
  if (printed && printed !== actual) return { error: "The fingerprint does not match the public key." };
  return {
    repo,
    role: role as PairRole,
    transport: transport as PairTransport,
    fingerprint: actual,
    publicKey,
  };
}
