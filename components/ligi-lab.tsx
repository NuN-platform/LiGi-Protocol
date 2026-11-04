"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BenchPanel } from "@/components/bench-panel";
import { SpecPanel } from "@/components/spec-panel";
import { SourcesPanel } from "@/components/sources-panel";
import { cellProfiles, type CellProfile } from "@/lib/bench";
import { ackEqual, ackKey, hmacAck } from "@/lib/ligi/ack";
import { gapFor, renderPanel, restCells, type Geometry, type Panel } from "@/lib/ligi/frame";
import { headerHex } from "@/lib/ligi/header";
import { photonicHandshake } from "@/lib/ligi/handshake";
import { base64ToBytes, bytesToBase64, fingerprint, generateKemKeys, MLKEM768 } from "@/lib/ligi/kem";
import { mulberry32 } from "@/lib/ligi/rng";
import { ingestPanel, MAX_PLAINTEXT_BYTES, openCaptured, prepareSession, renderFrame, type KemTransport, type Session } from "@/lib/ligi/session";
import type { CapturedFrame } from "@/lib/ligi/frame";

const CHANNEL = "ligi-gate-v2";

const SHORT_SAMPLE =
  "The gate is open. This sentence is crossing as geometric cells, fountain symbols, and a SHA-256 check. If a sensor recovers it, the frame layer of LiGi v2 is doing its job.";

const CROATIAN_SAMPLE =
  "Poruka za NuN čvor. Ako vidiš ovaj tekst, fotonički okviri su preživjeli gubitak slika i hash se poklapa.";

const LONG_SAMPLE = `${SHORT_SAMPLE}\n\n${"Symbol after symbol, the panel keeps painting. A sensor that blinks, looks away, or loses a third of the frames can still finish the message because later frames repair the ones that never arrived. ".repeat(4)}`;

type Status = "idle" | "listening" | "short" | "recovered" | "failed";

type KemOwner = "page" | "window";

type Bucket = {
  id: string;
  name: string;
  detail: string;
  loss: number;
  rng: () => number;
  frames: Map<number, CapturedFrame>;
  seen: number;
  dropped: number;
  rejected: number;
  k: number;
  status: Status;
  text: string;
  hash: string;
  ack: string;
  secretHash: string;
  note: string;
  opening: boolean;
  pending: boolean;
  seconds: number;
};

type Wire =
  | { type: "frame"; rgba: Uint8Array; width: number; height: number; cellPx: number; gap: number; stride: number }
  | { type: "hold" }
  | { type: "idle" }
  | { type: "want-key" }
  | { type: "pubkey"; publicKey: Uint8Array }
  | { type: "kem"; sessionId: Uint8Array; cipherText: Uint8Array }
  | { type: "ack"; sessionId: Uint8Array; hashHex: string; mac: Uint8Array };

const GATE_SENSORS = [
  { id: "a", name: "Sensor A", detail: "Reads the pixels on this display.", loss: 0.08 },
  { id: "b", name: "Sensor B", detail: "A second view, with more dropped frames.", loss: 0.2 },
  { id: "c", name: "Sensor C", detail: "The far seat in the rule of three.", loss: 0.35 },
];

function sliderNumber(value: number | readonly number[]): number {
  return typeof value === "number" ? value : value[0];
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function makeBuckets(losses: number[], sensor: boolean, seed: number): Bucket[] {
  const specs = sensor
    ? [{ id: "local", name: "This window", detail: "Samples frames published by a gate on this computer.", loss: losses[0] ?? 0.08 }]
    : GATE_SENSORS;
  return specs.map((spec, index) => ({
    ...spec,
    loss: losses[index] ?? spec.loss,
    rng: mulberry32((seed + index + 1) >>> 0),
    frames: new Map(),
    seen: 0,
    dropped: 0,
    rejected: 0,
    k: 0,
    status: "idle",
    text: "",
    hash: "",
    ack: "",
    secretHash: "",
    note: sensor ? "Waiting for a gate on this computer." : "Idle until the gate opens.",
    opening: false,
    pending: false,
    seconds: 0,
  }));
}

export function Lab({ sensor }: { sensor: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const bucketsRef = useRef<Bucket[]>([]);
  const lossRef = useRef<number[]>([0.08, 0.2, 0.35]);
  const occlusionRef = useRef(0);
  const passphraseRef = useRef("");
  const publishRef = useRef(true);
  const sensorRef = useRef(sensor);
  const geometryRef = useRef<Geometry>({ cellPx: 18, gap: gapFor(18), stride: 1 });
  const kemModeRef = useRef<"off" | KemTransport>("off");
  const kemOwnerRef = useRef<KemOwner>("page");
  const kemSecretRef = useRef<Uint8Array | null>(null);
  const kemPublicRef = useRef<Uint8Array | null>(null);
  const remotePublicRef = useRef<Uint8Array | null>(null);
  const sharedSecretRef = useRef<Uint8Array | null>(null);
  const cipherMapRef = useRef(new Map<string, Uint8Array>());
  const pendingKemRef = useRef<{ sessionId: Uint8Array; cipherText: Uint8Array } | null>(null);
  const generation = useRef(0);
  const startedAt = useRef(0);
  const onFrameRef = useRef<(panel: Panel) => void>(() => {});
  const considerRef = useRef<(index: number, gen: number) => void>(() => {});
  const [live, setLive] = useState(false);

  const [payload, setPayload] = useState(SHORT_SAMPLE);
  const [passphrase, setPassphrase] = useState("");
  const [symbolSize, setSymbolSize] = useState(48);
  const [fps, setFps] = useState(8);
  const [cellPx, setCellPx] = useState(18);
  const [stride, setStride] = useState(1);
  const [kemMode, setKemMode] = useState<"off" | KemTransport>("off");
  const [kemOwner, setKemOwner] = useState<KemOwner>("page");
  const [localFingerprint, setLocalFingerprint] = useState("");
  const [localPublicKey, setLocalPublicKey] = useState("");
  const [remoteFingerprint, setRemoteFingerprint] = useState("");
  const [pastedKey, setPastedKey] = useState("");
  const [ackNote, setAckNote] = useState("No HMAC ACK yet.");
  const [occlusion, setOcclusion] = useState(0);
  const [losses, setLosses] = useState(sensor ? [0.08] : [0.08, 0.2, 0.35]);
  const [hold, setHold] = useState(false);
  const [publish, setPublish] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [views, setViews] = useState<Bucket[]>([]);
  const [header, setHeader] = useState("The panel is at rest. Finder corners appear when a session starts.");
  const [sequenceLabel, setSequenceLabel] = useState("Thermodynamic rest");
  const [displayNote, setDisplayNote] = useState<string | null>(null);
  const [lux, setLux] = useState(180);
  const [stamp, setStamp] = useState(1_700_000_000);

  const byteCount = useMemo(() => new TextEncoder().encode(payload).length, [payload]);
  const handshake = useMemo(() => photonicHandshake(lux, stamp), [lux, stamp]);

  function publishViews() {
    setViews(bucketsRef.current.map((bucket) => ({ ...bucket, frames: bucket.frames })));
  }

  function paint(panel: Panel, readBack: boolean): Panel {
    const canvas = canvasRef.current;
    if (!canvas) return panel;
    canvas.width = panel.width;
    canvas.height = panel.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return panel;
    const image = new ImageData(new Uint8ClampedArray(panel.rgba), panel.width, panel.height);
    context.putImageData(image, 0, 0);
    if (!readBack) return panel;
    const read = context.getImageData(0, 0, panel.width, panel.height);
    const same = read.data[0] === panel.rgba[0] && read.data[1] === panel.rgba[1] && read.data[2] === panel.rgba[2];
    if (!same) {
      setDisplayNote("This display changed pixel colors, so the sensors are reading the frame buffer.");
      return panel;
    }
    return { rgba: read.data, width: panel.width, height: panel.height };
  }

  async function consider(index: number, gen: number) {
    const bucket = bucketsRef.current[index];
    if (!bucket || bucket.status === "recovered") return;
    if (bucket.opening) {
      bucket.pending = true;
      return;
    }
    if (bucket.status === "failed" && bucket.note.includes("passphrase") && passphraseRef.current.trim().length === 0) return;
    if (bucket.frames.size === 0) return;
    bucket.opening = true;
    bucket.pending = false;
    const frames = [...bucket.frames.values()];
    if (!sensor && kemModeRef.current !== "off" && kemOwnerRef.current === "window") {
      bucket.opening = false;
      bucket.status = "short";
      bucket.note = "The paired sensor window holds the ML-KEM secret. This page keeps collecting symbols.";
      publishViews();
      return;
    }
    const sessionKey = frames[0] ? hex(frames[0].sessionId) : "";
    const result = await openCaptured(frames, {
      passphrase: passphraseRef.current,
      kemSecret: kemSecretRef.current ?? undefined,
      kemCipherText: cipherMapRef.current.get(sessionKey),
    });
    const current = bucketsRef.current[index];
    if (!current || gen !== generation.current) return;
    current.opening = false;
    if (result.ok) {
      current.status = "recovered";
      current.text = result.text;
      current.hash = result.hashHex;
      current.ack = result.ackHex;
      current.secretHash = result.secretHash ?? "";
      current.seconds = startedAt.current ? (performance.now() - startedAt.current) / 1000 : 0;
      current.note = `Opened from ${result.symbolsUsed} distinct symbols.`;
      if (sensor && channelRef.current && frames[0]) {
        channelRef.current.postMessage({
          type: "ack",
          sessionId: frames[0].sessionId,
          hashHex: result.hashHex,
          mac: bytesFromHex(result.ackHex),
        } satisfies Wire);
      }
      if (!sensor) setAckNote("HMAC ACK complete");
    } else if (result.reason.startsWith("Rank")) {
      current.status = "short";
      current.note = result.reason;
    } else {
      current.status = "failed";
      current.note = result.reason;
    }
    publishViews();
    if (current.pending && current.status !== "recovered") void consider(index, gen);
  }

  considerRef.current = consider;

  function feed(panel: Panel, gen: number) {
    bucketsRef.current.forEach((bucket, index) => {
      bucket.seen += 1;
      if (bucket.status === "idle") bucket.status = "listening";
      const result = ingestPanel(panel, {
        loss: lossRef.current[index] ?? bucket.loss,
        occlusion: occlusionRef.current,
        rng: bucket.rng,
        geometry: geometryRef.current,
      });
      if (result.kind === "drop") bucket.dropped += 1;
      else if (result.kind === "reject") {
        bucket.rejected += 1;
        if (bucket.status !== "recovered") bucket.note = result.reason;
      } else if (!bucket.frames.has(result.frame.sequence)) {
        bucket.frames.set(result.frame.sequence, result.frame);
        bucket.k = result.frame.blockCount;
        if (bucket.status !== "recovered") void consider(index, gen);
      }
    });
    publishViews();
  }

  onFrameRef.current = (panel) => {
    if (startedAt.current === 0) startedAt.current = performance.now();
    setLive(true);
    const shown = paint(panel, true);
    setSequenceLabel("Frame arriving from another window");
    setHold(false);
    feed(shown, generation.current);
  };

  useEffect(() => {
    setStamp(Math.floor(Date.now() / 1000));
  }, []);

  useEffect(() => {
    lossRef.current = losses;
    bucketsRef.current.forEach((bucket, index) => {
      if (losses[index] !== undefined) bucket.loss = losses[index];
    });
  }, [losses]);

  useEffect(() => {
    occlusionRef.current = occlusion;
  }, [occlusion]);

  useEffect(() => {
    passphraseRef.current = passphrase;
    const gen = generation.current;
    bucketsRef.current.forEach((bucket, index) => {
      if (bucket.status === "failed") {
        bucket.status = "short";
        bucket.opening = false;
        void consider(index, gen);
      }
    });
    // Retry only when the operator changes the passphrase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passphrase]);

  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  useEffect(() => {
    geometryRef.current = { cellPx, gap: gapFor(cellPx), stride };
  }, [cellPx, stride]);

  useEffect(() => {
    kemModeRef.current = kemMode;
    kemOwnerRef.current = kemOwner;
  }, [kemMode, kemOwner]);

  useEffect(() => {
    if (!sensor) return;
    const keys = generateKemKeys();
    kemSecretRef.current = keys.secretKey;
    kemPublicRef.current = keys.publicKey;
    setLocalFingerprint(fingerprint(keys.publicKey));
    setLocalPublicKey(bytesToBase64(keys.publicKey));
  }, [sensor]);

  useEffect(() => {
    if (sensor || kemMode === "off" || kemOwner !== "page" || kemSecretRef.current) return;
    const keys = generateKemKeys();
    kemSecretRef.current = keys.secretKey;
    kemPublicRef.current = keys.publicKey;
    setLocalFingerprint(fingerprint(keys.publicKey));
  }, [sensor, kemMode, kemOwner]);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<Wire>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "hold") {
        setHold(true);
        setSequenceLabel("Healing hold. The other window paused LiGi.");
        return;
      }
      if (data.type === "idle") {
        setSequenceLabel("The other window stopped the gate.");
        return;
      }
      if (data.type === "want-key") {
        if (sensorRef.current && kemPublicRef.current) {
          channel.postMessage({ type: "pubkey", publicKey: kemPublicRef.current } satisfies Wire);
        }
        if (!sensorRef.current && pendingKemRef.current) {
          channel.postMessage({ type: "kem", ...pendingKemRef.current } satisfies Wire);
        }
        return;
      }
      if (data.type === "pubkey" && !sensorRef.current && data.publicKey?.length === MLKEM768.publicKeyBytes) {
        remotePublicRef.current = data.publicKey;
        setRemoteFingerprint(fingerprint(data.publicKey));
        setPastedKey(bytesToBase64(data.publicKey));
        return;
      }
      if (data.type === "kem") {
        cipherMapRef.current.set(hex(data.sessionId), data.cipherText);
        const gen = generation.current;
        bucketsRef.current.forEach((bucket, index) => {
          if (bucket.status !== "recovered") considerRef.current(index, gen);
        });
        return;
      }
      if (data.type === "ack") {
        const mac = hmacAck(ackKey(data.sessionId, sharedSecretRef.current), data.sessionId, bytesFromHex(data.hashHex));
        setAckNote(ackEqual(mac, data.mac) ? "HMAC ACK complete" : "HMAC ACK did not match this session.");
        return;
      }
      if (data.type === "frame") {
        geometryRef.current = { cellPx: data.cellPx, gap: data.gap, stride: data.stride };
        const panel: Panel = {
          rgba: new Uint8ClampedArray(data.rgba),
          width: data.width,
          height: data.height,
        };
        onFrameRef.current(panel);
      }
    };
    const announce = window.setInterval(() => {
      channel.postMessage({ type: "want-key" } satisfies Wire);
    }, 2000);
    return () => {
      window.clearInterval(announce);
      channel.close();
    };
  }, []);

  useEffect(() => {
    if (sensor) {
      generation.current += 1;
      bucketsRef.current = makeBuckets(losses, true, 0x5eed);
      publishViews();
    }
    // Sensor buckets are created once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensor]);

  useEffect(() => {
    if (running || live) return;
    let tick = 0;
    let frame = 0;
    const loop = () => {
      tick += 1;
      paint(renderPanel(restCells(tick), geometryRef.current.cellPx, geometryRef.current.gap), false);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [running, live, cellPx, stride]);

  useEffect(() => {
    if (!running || sensor || hold || !session) return;
    let seq = 0;
    if (startedAt.current === 0) startedAt.current = performance.now();
    const id = window.setInterval(() => {
      const rendered = renderFrame(session, seq, geometryRef.current);
      seq += 1;
      const shown = paint(rendered.panel, true);
      setHeader(headerHex(rendered.headerBytes));
      setSequenceLabel(`Sequence ${rendered.sequence} · ${session.frameCount} frames in the schedule`);
      feed(shown, generation.current);
      if (publishRef.current && channelRef.current) {
        const geometry = geometryRef.current;
        channelRef.current.postMessage({
          type: "frame",
          rgba: new Uint8Array(shown.rgba),
          width: shown.width,
          height: shown.height,
          cellPx: geometry.cellPx,
          gap: geometry.gap,
          stride: geometry.stride,
        } satisfies Wire);
      }
    }, 1000 / fps);
    return () => window.clearInterval(id);
    // feed and paint are recreated each render and read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sensor, hold, session, fps]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (hold) channelRef.current.postMessage({ type: "hold" } satisfies Wire);
  }, [hold]);

  async function openGate() {
    setError(null);
    setBusy(true);
    try {
      const useKem = kemModeRef.current !== "off";
      if (useKem && kemOwnerRef.current === "page" && !kemSecretRef.current) {
        const keys = generateKemKeys();
        kemSecretRef.current = keys.secretKey;
        kemPublicRef.current = keys.publicKey;
        setLocalFingerprint(fingerprint(keys.publicKey));
      }
      const kemKey = useKem ? (kemOwnerRef.current === "page" ? kemPublicRef.current : remotePublicRef.current) : null;
      if (useKem && (!kemKey || kemKey.length !== MLKEM768.publicKeyBytes)) {
        throw new Error("ML-KEM needs a sensor public key. Open a sensor window, or paste the key.");
      }
      const next = await prepareSession(payload, {
        symbolSize,
        passphrase: useKem ? "" : passphrase,
        kem: useKem && kemKey ? { publicKey: kemKey, transport: kemModeRef.current as KemTransport } : undefined,
      });
      sharedSecretRef.current = next.sharedSecret;
      if (next.kemCipherText) cipherMapRef.current.set(hex(next.sessionId), next.kemCipherText);
      if (next.kem === "network" && next.kemCipherText) {
        pendingKemRef.current = { sessionId: next.sessionId, cipherText: next.kemCipherText };
        channelRef.current?.postMessage({ type: "kem", ...pendingKemRef.current } satisfies Wire);
      } else {
        pendingKemRef.current = null;
      }
      setAckNote(next.kem === "off" ? "Waiting for an HMAC ACK." : `Shared-secret hash ${next.secretHash}. Waiting for an HMAC ACK.`);
      generation.current += 1;
      setLive(true);
      startedAt.current = performance.now();
      const seed = (next.sessionId[0] << 24) | (next.sessionId[1] << 16) | (next.sessionId[2] << 8) | next.sessionId[3];
      bucketsRef.current = makeBuckets(lossRef.current, false, seed).map((bucket) => ({
        ...bucket,
        k: next.k,
        status: "listening",
        note: "Listening.",
      }));
      setSession({ ...next, sharedSecret: null });
      setRunning(true);
      setHold(false);
      publishViews();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The gate did not open.");
    } finally {
      setBusy(false);
    }
  }

  function stopGate() {
    setRunning(false);
    setSequenceLabel("Gate stopped. Recovered text stays on the sensors.");
    channelRef.current?.postMessage({ type: "idle" } satisfies Wire);
  }

  function applyProfile(profile: CellProfile) {
    if (running) return;
    setCellPx(profile.cellPx);
    setStride(profile.stride);
    setFps(profile.fps);
    if (profile.id === "c8") {
      setKemMode("optical");
      setKemOwner("page");
    }
  }

  function usePastedKey() {
    try {
      const bytes = base64ToBytes(pastedKey);
      if (bytes.length !== MLKEM768.publicKeyBytes) throw new Error("length");
      remotePublicRef.current = bytes;
      setRemoteFingerprint(fingerprint(bytes));
      setKemOwner("window");
      setError(null);
    } catch {
      setError("That public key is not an ML-KEM-768 key.");
    }
  }

  function newLocalKey() {
    if (running) return;
    const keys = generateKemKeys();
    kemSecretRef.current = keys.secretKey;
    kemPublicRef.current = keys.publicKey;
    setLocalFingerprint(fingerprint(keys.publicKey));
    setKemOwner("page");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const size = new TextEncoder().encode(text).length;
    if (size > MAX_PLAINTEXT_BYTES) {
      setError(`That file is ${size} bytes. This gate carries ${MAX_PLAINTEXT_BYTES}.`);
      return;
    }
    setError(null);
    setPayload(text);
  }

  const recovered = views.filter((view) => view.status === "recovered");
  const hashes = new Set(recovered.map((view) => view.hash));
  let consensus = sensor ? "This window has not recovered a payload yet." : "Open the gate to start three sensors.";
  if (running && recovered.length === 0) consensus = "Sensors are collecting symbols.";
  if (recovered.length > 0 && hashes.size === 1) {
    consensus = `${recovered.length} of ${views.length} sensors recovered one SHA-256.`;
  }
  if (hashes.size > 1) consensus = "Sensors recovered different hashes. Check the passphrase and the session.";

  const active = views.length > 0 ? views : makeBuckets(losses, sensor, 1);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-5 md:px-6">
      <header className="mb-5 flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs tracking-[0.22em] text-primary uppercase">NuN Nexus · protocol v2</p>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">LiGi Gate</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            {sensor
              ? "Sensor window. It samples frames from a gate opened on this computer and rebuilds the payload from the pixels."
              : "A display-to-sensor lab for Bojan Petar Milanovic’s LiGi protocol. The panel is the channel."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{sensor ? "Sensor" : "Transmitter"}</Badge>
          <Badge variant="outline">{hold ? "Healing hold" : running ? "On air" : "At rest"}</Badge>
          <a className="text-sm text-primary underline-offset-4 hover:underline" href="/api/spec">
            Spec JSON
          </a>
        </div>
      </header>

      <Tabs defaultValue="gate">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="gate">Gate</TabsTrigger>
          <TabsTrigger value="bench">SN2 bench</TabsTrigger>
          <TabsTrigger value="spec">Specification</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="gate" className="mt-4">
          <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
            <Card className="gap-4 p-4">
              {sensor ? (
                <form className="grid gap-3" onSubmit={(event) => event.preventDefault()}>
                  <h2 className="font-display text-2xl">Sensor</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Leave the gate window transmitting. Frames arrive here as pixels. Loss and occlusion apply only in
                    this window.
                  </p>
                  <PassphraseField value={passphrase} onChange={setPassphrase} />
                <div className="grid gap-2">
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {localFingerprint ? `ML-KEM key ${localFingerprint}` : "Creating an ML-KEM key…"}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!localPublicKey}
                    onClick={() => void navigator.clipboard.writeText(localPublicKey)}
                  >
                    Copy public key
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Another gate can paste this key and encapsulate to this window. The secret stays here.
                  </p>
                </div>
                  <Field label="Frame loss" value={`${Math.round((losses[0] ?? 0) * 100)}%`}>
                    <Slider
                      min={0}
                      max={60}
                      step={1}
                      value={[Math.round((losses[0] ?? 0) * 100)]}
                      onValueChange={(value) => setLosses([sliderNumber(value) / 100])}
                    />
                  </Field>
                  <OcclusionField occlusion={occlusion} onChange={setOcclusion} />
                </form>
              ) : (
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!busy && !running && byteCount <= MAX_PLAINTEXT_BYTES) void openGate();
                  }}
                >
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="payload">Payload</Label>
                      <span className="font-mono text-xs text-muted-foreground">
                        {byteCount}/{MAX_PLAINTEXT_BYTES} B
                      </span>
                    </div>
                    <Textarea
                      id="payload"
                      value={payload}
                      onChange={(event) => setPayload(event.target.value)}
                      rows={5}
                      disabled={running}
                      placeholder="Write the message the panel should carry."
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setPayload(SHORT_SAMPLE)}>
                        Short note
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setPayload(CROATIAN_SAMPLE)}>
                        Croatian
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setPayload(LONG_SAMPLE)}>
                        Longer note
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={running} onClick={() => fileRef.current?.click()}>
                        Text file
                      </Button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.md,.json,text/plain"
                        className="hidden"
                        onChange={(event) => void onFile(event.target.files?.[0])}
                      />
                    </div>
                  </div>
                  {error ? (
                    <p className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" disabled={busy || running || byteCount > MAX_PLAINTEXT_BYTES} onClick={() => void openGate()}>
                      {busy ? "Opening…" : "Open the gate"}
                    </Button>
                    <Button type="button" variant="outline" disabled={!running && !hold} onClick={stopGate}>
                      Stop
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => window.open("/?role=sensor", "ligi-sensor", "width=980,height=860")}
                  >
                    Open a sensor window
                  </Button>
                  <PassphraseField value={passphrase} onChange={setPassphrase} disabled={running || kemMode !== "off"} />
                  <div className="grid gap-2">
                    <Label>Cell profile</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {cellProfiles.map((profile) => (
                        <Button
                          key={profile.id}
                          type="button"
                          size="sm"
                          variant={cellPx === profile.cellPx && stride === profile.stride ? "default" : "outline"}
                          disabled={running}
                          onClick={() => applyProfile(profile)}
                        >
                          {profile.label}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      c8 is the newest optical pass on bis3946-pc: 8 px cells, 5 fps, stride 6. This grid is 32×16, so an
                      ML-KEM ciphertext takes several fountain frames.
                    </p>
                  </div>
                  <Field label="Stride" value={`${stride} px`}>
                    <Slider min={1} max={8} step={1} value={[stride]} disabled={running} onValueChange={(value) => setStride(sliderNumber(value))} />
                  </Field>
                  <div className="grid gap-2">
                    <Label>Symbol size</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {[32, 48].map((size) => (
                        <Button
                          key={size}
                          type="button"
                          variant={symbolSize === size ? "default" : "outline"}
                          disabled={running}
                          onClick={() => setSymbolSize(size)}
                        >
                          {size} bytes
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Field label="Panel rate" value={`${fps} fps`}>
                    <Slider min={4} max={16} step={1} value={[fps]} onValueChange={(value) => setFps(sliderNumber(value))} />
                  </Field>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    The whitepaper aims at 60–240 Hz. This browser paints more slowly so you can watch the cells.
                  </p>
                  <OcclusionField occlusion={occlusion} onChange={setOcclusion} />
                  <div className="grid gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="kem">ML-KEM-768</Label>
                      <Switch
                        id="kem"
                        checked={kemMode !== "off"}
                        disabled={running}
                        onCheckedChange={(checked) => setKemMode(checked ? "optical" : "off")}
                      />
                    </div>
                    {kemMode !== "off" ? (
                      <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" size="sm" variant={kemMode === "optical" ? "default" : "outline"} disabled={running} onClick={() => setKemMode("optical")}>
                            Optical CT
                          </Button>
                          <Button type="button" size="sm" variant={kemMode === "network" ? "default" : "outline"} disabled={running} onClick={() => setKemMode("network")}>
                            Network fallback
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" size="sm" variant={kemOwner === "page" ? "default" : "outline"} disabled={running} onClick={() => setKemOwner("page")}>
                            Key on this page
                          </Button>
                          <Button type="button" size="sm" variant={kemOwner === "window" ? "default" : "outline"} disabled={running} onClick={() => setKemOwner("window")}>
                            Sensor window
                          </Button>
                        </div>
                        <p className="font-mono text-xs break-all text-muted-foreground">
                          {kemOwner === "page"
                            ? localFingerprint
                              ? `Local key ${localFingerprint}`
                              : "A key is created when the gate opens."
                            : remoteFingerprint
                              ? `Sensor key ${remoteFingerprint}`
                              : "Waiting for a sensor public key."}
                        </p>
                        {kemOwner === "window" ? (
                          <div className="grid gap-2">
                            <Textarea
                              value={pastedKey}
                              onChange={(event) => setPastedKey(event.target.value)}
                              rows={3}
                              disabled={running}
                              placeholder="Paste an ML-KEM-768 public key"
                              aria-label="Sensor public key"
                            />
                            <Button type="button" size="sm" variant="outline" disabled={running} onClick={usePastedKey}>
                              Use pasted key
                            </Button>
                          </div>
                        ) : (
                          <Button type="button" size="sm" variant="ghost" disabled={running} onClick={newLocalKey}>
                            New key on this page
                          </Button>
                        )}
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Optical mode paints the ciphertext in the cells. Network fallback sends it beside the panel,
                          which is the path that passed when the optical ciphertext was too large to trust.
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="publish">Share with other windows</Label>
                    <Switch id="publish" checked={publish} onCheckedChange={setPublish} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="hold">Healing hold</Label>
                    <Switch
                      id="hold"
                      checked={hold}
                      onCheckedChange={(checked) => {
                        setHold(checked);
                        if (!checked && session) setRunning(true);
                      }}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    While a heal is open, LiGi stays paused. That is the sequencing rule in the Nun-root note.
                  </p>
                </form>
              )}
            </Card>

            <div className="grid gap-4 lg:sticky lg:top-4 lg:self-start">
              <div className="relative rounded-2xl bg-[#090b08] p-3 shadow-[inset_0_0_0_1px_rgba(214,255,74,0.2)]">
                <canvas
                  ref={canvasRef}
                  className="h-auto w-full rounded-md [image-rendering:pixelated]"
                  aria-label="LiGi photonic panel"
                />
                <div className="gate-scan pointer-events-none absolute inset-3 rounded-md" />
                {hold ? (
                  <div className="absolute inset-3 grid place-items-center rounded-md bg-black/60 px-6 text-center">
                    <p className="font-display text-2xl text-[#f0d2a4]">Healing hold. The gate is paused.</p>
                  </div>
                ) : null}
              </div>
              <Card className="gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-xl">{sequenceLabel}</h2>
                  {session ? <Badge variant="outline">{session.k} source symbols</Badge> : null}
                </div>
                <p className="text-sm leading-relaxed" aria-live="polite">
                  {consensus}
                </p>
                {session ? (
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    Session {hex(session.sessionId)} · seal {session.hashHex}
                    {session.gzip ? " · gzip" : ""}
                    {session.kem === "off" ? (session.encrypted ? " · sealed" : "") : ` · ML-KEM ${session.kem}`}
                    {session.secretHash ? ` · shared ${session.secretHash}` : ""}
                  </p>
                ) : null}
                <p className="text-sm" aria-live="polite">
                  {ackNote}
                </p>
                {displayNote ? <p className="text-sm text-[#f0d2a4]">{displayNote}</p> : null}
                <pre className="overflow-x-auto font-mono text-xs leading-5 text-muted-foreground">{header}</pre>
              </Card>
              <Card className="gap-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-xl">Photonic seed</h2>
                  <Button type="button" size="sm" variant="outline" onClick={() => setStamp(Math.floor(Date.now() / 1000))}>
                    Stamp now
                  </Button>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  The phone light sensor from melek-core is not on this machine. Move lux to run the same SHA3-512
                  construction, labeled VSha-3946. Ambient reference from the L0 note: 298.15 K.
                </p>
                <Field label="Lux" value={lux.toFixed(0)}>
                  <Slider min={0} max={2000} step={10} value={[lux]} onValueChange={(value) => setLux(sliderNumber(value))} />
                </Field>
                <dl className="grid gap-1 font-mono text-xs break-all text-muted-foreground">
                  <div>{handshake.state}</div>
                  <div>w {handshake.quantumWeight}</div>
                  <div>{handshake.signature}</div>
                </dl>
              </Card>
            </div>

            <div className="grid gap-3">
              {(sensor ? active.slice(0, 1) : active).map((view, index) => (
                <SensorCard
                  key={view.id}
                  view={view}
                  loss={losses[index] ?? view.loss}
                  onLoss={(next) =>
                    setLosses((current) => {
                      const copy = [...current];
                      copy[index] = next;
                      return copy;
                    })
                  }
                  showLoss={!sensor}
                />
              ))}
              </div>
          </div>
        </TabsContent>
        <TabsContent value="bench" className="mt-4">
          <BenchPanel onApply={applyProfile} disabled={running} />
        </TabsContent>
        <TabsContent value="spec" className="mt-4">
          <SpecPanel />
        </TabsContent>
        <TabsContent value="sources" className="mt-4">
          <SourcesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PassphraseField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="passphrase">Passphrase</Label>
      <Input
        id="passphrase"
        type="password"
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder="Empty leaves the payload in the clear"
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Eight characters or more seals the payload with AES-256-GCM. The sensor needs the same phrase.
      </p>
    </div>
  );
}

function OcclusionField({ occlusion, onChange }: { occlusion: number; onChange: (value: number) => void }) {
  return (
    <Field label="Occlusion" value={`${Math.round(occlusion * 100)}%`}>
      <Slider min={0} max={45} step={1} value={[Math.round(occlusion * 100)]} onValueChange={(value) => onChange(sliderNumber(value) / 100)} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Loss drops a whole frame. Occlusion covers a band of cells, and the frame is rejected.
      </p>
    </Field>
  );
}

function Field({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      {children}
    </div>
  );
}

function SensorCard({
  view,
  loss,
  onLoss,
  showLoss,
}: {
  view: Bucket;
  loss: number;
  onLoss: (value: number) => void;
  showLoss: boolean;
}) {
  const target = view.k ? Math.ceil(view.k * 1.15) : 0;
  const progress = view.status === "recovered" ? 100 : target ? Math.min(100, (view.frames.size / target) * 100) : 0;
  const bytes = view.text ? new TextEncoder().encode(view.text).length : 0;
  const rate = view.seconds > 0 && bytes > 0 ? bytes / 1024 / view.seconds : 0;
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg">{view.name}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{view.detail}</p>
        </div>
        <Badge variant={view.status === "recovered" ? "default" : view.status === "failed" ? "destructive" : "outline"}>
          {view.status}
        </Badge>
      </div>
      {showLoss ? (
        <Field label="Loss" value={`${Math.round(loss * 100)}%`}>
          <Slider min={0} max={60} step={1} value={[Math.round(loss * 100)]} onValueChange={(value) => onLoss(sliderNumber(value) / 100)} />
        </Field>
      ) : null}
      <Progress value={progress} />
      <p className="font-mono text-xs text-muted-foreground">
        {view.frames.size} distinct · {view.dropped} dropped · {view.rejected} rejected
        {target ? ` · target ${target}` : ""}
      </p>
      <p className="text-sm leading-relaxed">{view.note}</p>
      {view.status === "recovered" ? (
        <div className="grid gap-2">
          <pre className="max-h-40 overflow-auto rounded-lg bg-background/60 p-3 text-sm whitespace-pre-wrap">
            {view.text.length > 0 ? view.text : "(empty payload)"}
          </pre>
          <p className="font-mono text-[11px] break-all text-muted-foreground">{view.hash}</p>
          {view.ack ? <p className="font-mono text-[11px] break-all text-muted-foreground">HMAC {view.ack.slice(0, 32)}</p> : null}
          {view.secretHash ? (
            <p className="font-mono text-[11px] break-all text-muted-foreground">Shared-secret hash {view.secretHash}</p>
          ) : null}
          {rate > 0 ? (
            <p className="text-xs text-muted-foreground">
              {bytes} bytes in {view.seconds.toFixed(1)} s · {rate.toFixed(2)} KB/s on this panel
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(view.text)}
          >
            Copy recovered text
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
