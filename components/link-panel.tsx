"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Geometry, Panel } from "@/lib/ligi/frame";
import { base64ToBytes } from "@/lib/ligi/kem";
import { normalizeSeen } from "@/lib/ligi/optical";
import { INSTALL_URL, REPO_URL, decodePair, encodePair, type PairTicket, type PairTransport } from "@/lib/ligi/pair";

function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement): Panel | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: image.data, width: image.width, height: image.height };
}

export function LinkPanel({
  publicKey,
  fingerprint,
  geometry,
  canvasRef,
  painting,
  onPair,
  onSeen,
}: {
  publicKey: string;
  fingerprint: string;
  geometry: Geometry;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  painting: boolean;
  onPair: (ticket: PairTicket) => void;
  onSeen: (panel: Panel) => void;
}) {
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const previewRef = useRef<HTMLVideoElement>(null);
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const paintingRef = useRef(painting);
  paintingRef.current = painting;
  const onPairRef = useRef(onPair);
  const onSeenRef = useRef(onSeen);
  onPairRef.current = onPair;
  onSeenRef.current = onSeen;

  const [readBy, setReadBy] = useState<PairTransport>("optical");
  const [installQr, setInstallQr] = useState("");
  const [pairQr, setPairQr] = useState("");
  const [qrError, setQrError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [senseStatus, setSenseStatus] = useState("No optical sensor or video is running.");
  const [recordStatus, setRecordStatus] = useState("Record after the gate is open. The file is what the other machine plays.");

  useEffect(() => {
    let cancel = false;
    void import("qrcode")
      .then(async (QR) => {
        const install = await QR.toDataURL(INSTALL_URL, { errorCorrectionLevel: "M", margin: 1, width: 280 });
        if (cancel) return;
        setInstallQr(install);
        if (!publicKey || !fingerprint) {
          setPairQr("");
          return;
        }
        const text = encodePair({
          repo: REPO_URL,
          role: "sensor",
          transport: readBy,
          fingerprint,
          publicKey: base64ToBytes(publicKey),
        });
        const pair = await QR.toDataURL(text, { errorCorrectionLevel: "L", margin: 1, width: 320 });
        if (!cancel) setPairQr(pair);
      })
      .catch(() => {
        if (!cancel) setQrError("The QR codes could not be drawn.");
      });
    return () => {
      cancel = true;
    };
  }, [publicKey, fingerprint, readBy]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    };
  }, []);

  function inspect(panel: Panel) {
    const code = jsQR(panel.rgba, panel.width, panel.height, { inversionAttempts: "attemptBoth" });
    if (code?.data.startsWith("LIGI1")) {
      const ticket = decodePair(code.data);
      if ("error" in ticket) {
        setSenseStatus(ticket.error);
        return;
      }
      onPairRef.current(ticket);
      setSenseStatus(
        `Pair QR read. Key ${ticket.fingerprint}. That machine keeps the secret. Open the gate here so it can read by ${ticket.transport === "video" ? "video" : "camera"}.`,
      );
      return;
    }
    const seen = normalizeSeen(panel, geometryRef.current);
    if (!seen.ok) {
      setSenseStatus(seen.reason);
      return;
    }
    if (paintingRef.current) {
      setSenseStatus("This page is painting. Point the other machine at this panel, or record a video for it.");
      return;
    }
    onSeenRef.current(seen.panel);
    setSenseStatus(`Locked sequence ${seen.sequence}.`);
  }

  useEffect(() => {
    if (!cameraOn && !videoOn) return;
    let timer = 0;
    const tick = () => {
      const video = cameraOn ? previewRef.current : fileVideoRef.current;
      const scratch = scratchRef.current;
      if (video && scratch) {
        const panel = grab(video, scratch);
        if (panel) inspect(panel);
      }
      timer = window.setTimeout(tick, 220);
    };
    timer = window.setTimeout(tick, 220);
    return () => window.clearTimeout(timer);
  }, [cameraOn, videoOn]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSenseStatus("This browser has no camera API.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play();
      }
      setVideoOn(false);
      setCameraOn(true);
      setSenseStatus("Camera on. Point it at the other machine’s pair QR, then at its panel.");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError") setSenseStatus("Camera permission was denied.");
      else if (name === "NotFoundError" || name === "NotReadableError") setSenseStatus("No camera was found on this machine.");
      else setSenseStatus("The camera did not start.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setCameraOn(false);
    setSenseStatus("Camera off.");
  }

  function playVideo(file: File | undefined) {
    if (!file || !fileVideoRef.current) return;
    stopCamera();
    const url = URL.createObjectURL(file);
    fileVideoRef.current.src = url;
    void fileVideoRef.current.play().then(
      () => {
        setVideoOn(true);
        setSenseStatus(`Playing ${file.name}. Each frame is locked like a camera frame.`);
      },
      () => setSenseStatus("This browser could not play that video."),
    );
  }

  async function readStill(file: File | undefined) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = scratchRef.current;
      if (!canvas) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      inspect({ rgba: image.data, width: image.width, height: image.height });
      bitmap.close();
    } catch {
      setSenseStatus("That image could not be opened.");
    }
  }

  function startRecording() {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) {
      setRecordStatus("The panel has not painted a frame yet.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setRecordStatus("This browser cannot record a video.");
      return;
    }
    const mime = ["video/webm;codecs=vp8", "video/webm"].find((item) => MediaRecorder.isTypeSupported(item));
    if (!mime) {
      setRecordStatus("This browser cannot record a WebM video.");
      return;
    }
    const stream = canvas.captureStream(8);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ligi-gate.webm";
      link.click();
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setRecordStatus("Saved ligi-gate.webm. The other machine plays it with the video codec add-on.");
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setRecordStatus("Recording the panel. Stop the recording when the sensors have recovered, or after one full schedule.");
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  function downloadTicket() {
    if (!publicKey || !fingerprint) return;
    const text = encodePair({
      repo: REPO_URL,
      role: "sensor",
      transport: readBy,
      fingerprint,
      publicKey: base64ToBytes(publicKey),
    });
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ligi-pair.txt";
    link.click();
  }

  return (
    <Card className="mt-4 gap-4 p-4">
      <div>
        <h2 className="font-display text-2xl">Two machines</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Scan the install QR on the machine that does not have LiGi yet. Scan the pair QR so the sender encapsulates
          to this machine. Then the reader watches the panel with a camera, or plays a video the sender recorded.
        </p>
      </div>
      {qrError ? (
        <p className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive" role="alert">
          {qrError}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <h3 className="font-display text-xl">Install QR</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Opens the install section of the GitHub README. Node.js 20 and npm 10 are the whole requirement list.
          </p>
          {installQr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={installQr} alt="QR code linking to the LiGi install instructions" className="h-44 w-44 rounded-md bg-white p-2" />
          ) : (
            <p className="text-sm text-muted-foreground">Drawing the install QR…</p>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(INSTALL_URL)}>
            Copy install link
          </Button>
        </div>
        <div className="grid gap-3">
          <h3 className="font-display text-xl">Pair QR</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This machine’s ML-KEM-768 public key. The secret stays here. The other machine scans this QR before it
            opens the gate.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant={readBy === "optical" ? "default" : "outline"} onClick={() => setReadBy("optical")}>
              I will use the camera
            </Button>
            <Button type="button" size="sm" variant={readBy === "video" ? "default" : "outline"} onClick={() => setReadBy("video")}>
              I will play a video
            </Button>
          </div>
          {pairQr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pairQr} alt="QR code of this machine’s LiGi public key" className="h-52 w-52 rounded-md bg-white p-2" />
          ) : (
            <p className="text-sm text-muted-foreground">Creating this machine’s key…</p>
          )}
          <p className="font-mono text-xs break-all text-muted-foreground">{fingerprint ? `Key ${fingerprint}` : "Key pending"}</p>
          <Button type="button" size="sm" variant="outline" disabled={!publicKey} onClick={downloadTicket}>
            Download pair ticket
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <h3 className="font-display text-xl">Optical sensor</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The camera is the sensor. It can read a pair QR on the other screen, then lock the painted panel. Cell
            colors may shift, so the lock allows a small color slack. A glare stripe still fails the frame.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={cameraOn} onClick={() => void startCamera()}>
              Start camera
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!cameraOn} onClick={stopCamera}>
              Stop camera
            </Button>
            <Label className="inline-flex cursor-pointer items-center">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => void readStill(event.target.files?.[0])}
              />
              <span className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-sm">Load a photo</span>
            </Label>
          </div>
          <video ref={previewRef} className="max-h-48 w-full rounded-md bg-black" muted playsInline />
        </div>
        <div className="grid gap-3">
          <h3 className="font-display text-xl">Video codec add-on</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Record the panel as a WebM. Carry that file to the other machine and play it here. Playback uses the same
            lock as the camera. The codec is a file, not a network stream.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={recording || !painting} onClick={startRecording}>
              Record panel
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!recording} onClick={stopRecording}>
              Stop and save
            </Button>
            <Label className="inline-flex cursor-pointer items-center">
              <input
                type="file"
                accept="video/webm,video/mp4,video/quicktime"
                className="sr-only"
                onChange={(event) => playVideo(event.target.files?.[0])}
              />
              <span className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-sm">Play a video</span>
            </Label>
          </div>
          <p className="text-sm leading-relaxed" role="status">
            {recordStatus}
          </p>
          <video
            ref={fileVideoRef}
            className="max-h-48 w-full rounded-md bg-black"
            muted
            playsInline
            onEnded={() => {
              setVideoOn(false);
              setSenseStatus("The video ended.");
            }}
          />
        </div>
      </div>
      <p className="text-sm leading-relaxed" role="status">
        {senseStatus}
      </p>
      <canvas ref={scratchRef} className="hidden" />
    </Card>
  );
}
