"use client";
import { useEffect, useRef } from "react";

export type WaveMode = "idle" | "recording" | "thinking" | "speaking";

/**
 * Rolling bar waveform on a canvas. While recording it reads the live AnalyserNode
 * (RMS per frame → newest bar on the right); while thinking/speaking it draws a soft
 * synthetic motion so the dock never looks frozen. One rAF loop, no React re-renders.
 */
export function Waveform({ analyserRef, mode, color = "#B9552F", accent = "#E3A93B" }: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  mode: WaveMode;
  color?: string;
  accent?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const BARS = 44;
    const hist = new Float32Array(BARS);
    let buf: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;
    let t = 0;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(64, now - (last || now));
      last = now;
      t += dt / 1000;
      const m = modeRef.current;
      const an = analyserRef.current;
      // advance the history ~ every 45 ms
      const step = m === "recording" ? 45 : 70;
      const shouldShift = Math.floor(t * 1000 / step) !== Math.floor((t * 1000 - dt) / step);
      let v = 0;
      if (m === "recording" && an) {
        if (!buf || buf.length !== an.fftSize) buf = new Uint8Array(new ArrayBuffer(an.fftSize));
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) { const x = (buf[i]! - 128) / 128; s += x * x; }
        v = Math.min(1, Math.sqrt(s / buf.length) * 5.5);
      } else if (m === "speaking") {
        v = 0.25 + 0.35 * Math.abs(Math.sin(t * 5.1) * Math.sin(t * 2.3 + 1));
      } else if (m === "thinking") {
        v = 0.12 + 0.1 * Math.sin(t * 6);
      } else {
        v = 0.04;
      }
      if (reduced) {
        hist.fill(m === "recording" ? Math.max(0.15, v) : 0.06);
      } else if (shouldShift) {
        hist.copyWithin(0, 1);
        hist[BARS - 1] = v;
      } else {
        hist[BARS - 1] = Math.max(hist[BARS - 1]! * 0.9, v);
      }
      if (m === "idle") for (let i = 0; i < BARS; i++) hist[i] = hist[i]! * 0.94 + 0.04 * 0.06;

      const w = c.clientWidth;
      const h = c.clientHeight;
      g.clearRect(0, 0, w, h);
      const gap = 3;
      const bw = Math.max(2, (w - gap * (BARS - 1)) / BARS);
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `${color}33`);
      grad.addColorStop(0.55, color);
      grad.addColorStop(1, accent);
      g.fillStyle = grad;
      for (let i = 0; i < BARS; i++) {
        const amp = hist[i]!;
        const wave = m === "thinking" ? 0.5 + 0.5 * Math.sin(t * 5 - i * 0.35) : 1;
        const bh = Math.max(3, amp * wave * (h - 4));
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        g.beginPath();
        g.roundRect(x, y, bw, bh, bw / 2);
        g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [analyserRef, color, accent]);

  return <canvas ref={canvas} className="h-full w-full" aria-hidden />;
}
