import { agentAcceptPair, agentKeygen, agentOpen, agentRead, agentVerifyAck, type AgentFrame } from "@/lib/ligi/agent";
import type { PairTransport } from "@/lib/ligi/pair";
import type { KemTransport } from "@/lib/ligi/session";

function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

function isFrame(value: unknown): value is AgentFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as AgentFrame;
  return typeof frame.sessionId === "string" && typeof frame.symbol === "string" && typeof frame.sequence === "number";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("JSON body required.");
  }
  if (!body || typeof body !== "object") return fail("JSON object required.");
  const action = "action" in body ? body.action : undefined;
  try {
    if (action === "keygen") {
      const transport = "transport" in body && (body.transport === "video" || body.transport === "optical") ? (body.transport as PairTransport) : "optical";
      return Response.json(agentKeygen(transport));
    }
    if (action === "pair") {
      if (!("pair" in body) || typeof body.pair !== "string") return fail("Pair ticket required.");
      const accepted = agentAcceptPair(body.pair);
      return Response.json(accepted, { status: accepted.ok ? 200 : 400 });
    }
    if (action === "open") {
      if (!("payload" in body) || typeof body.payload !== "string") return fail("Payload required.");
      if (!("publicKey" in body) || typeof body.publicKey !== "string") return fail("Reader public key required.");
      const transport: KemTransport = "transport" in body && body.transport === "network" ? "network" : "optical";
      const symbolSize = "symbolSize" in body && body.symbolSize === 48 ? 48 : 32;
      return Response.json(await agentOpen({ payload: body.payload, publicKey: body.publicKey, transport, symbolSize }));
    }
    if (action === "read") {
      if (!("frames" in body) || !Array.isArray(body.frames) || !body.frames.every(isFrame)) return fail("Frames required.");
      if (!("secretKey" in body) || typeof body.secretKey !== "string") return fail("Reader secret key required.");
      const cipherText = "cipherText" in body && typeof body.cipherText === "string" ? body.cipherText : undefined;
      const opened = await agentRead({ frames: body.frames, secretKey: body.secretKey, cipherText });
      return Response.json(opened, { status: opened.ok ? 200 : 422 });
    }
    if (action === "ack") {
      const fields = ["sessionId", "hashHex", "ackHex", "sharedSecret"] as const;
      if (!fields.every((field) => field in body && typeof body[field] === "string")) return fail("ACK fields required.");
      return Response.json(
        agentVerifyAck({
          sessionId: body.sessionId as string,
          hashHex: body.hashHex as string,
          ackHex: body.ackHex as string,
          sharedSecret: body.sharedSecret as string,
        }),
      );
    }
    return fail("Unknown action. Use keygen, pair, open, read, or ack.");
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "The agent action failed.");
  }
}
