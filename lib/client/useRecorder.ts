"use client";
/**
 * Mic capture: MediaRecorder for the audio + an AnalyserNode the waveform reads every frame.
 * Never throws into React; failures surface as `error` codes (MIC_DENIED, MIC_UNSUPPORTED).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "starting" | "recording";
export const MAX_RECORD_MS = 25_000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return undefined;
}

export function useRecorder(onDone: (blob: Blob, ms: number) => void) {
  const [state, setState] = useState<RecState>("idle");
  const [error, setError] = useState<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const cleanup = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== "closed") void ctxRef.current.close().catch(() => {});
    ctxRef.current = null;
    recRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback((cancel = false) => {
    cancelled.current = cancel;
    const r = recRef.current;
    if (r && r.state !== "inactive") r.stop();
    else { cleanup(); setState("idle"); }
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("MIC_UNSUPPORTED");
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(an);
      analyserRef.current = an;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        const ms = Date.now() - startedAt.current;
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        cleanup();
        setState("idle");
        if (!cancelled.current) doneRef.current(blob, ms);
      };
      recRef.current = rec;
      rec.start(250);
      startedAt.current = Date.now();
      setState("recording");
      timer.current = setTimeout(() => stop(false), MAX_RECORD_MS);
    } catch (e) {
      cleanup();
      setState("idle");
      const n = (e as Error).name;
      setError(n === "NotAllowedError" || n === "SecurityError" ? "MIC_DENIED" : "MIC_UNSUPPORTED");
    }
  }, [state, cleanup, stop]);

  return { state, error, setError, start, stop, analyserRef };
}
