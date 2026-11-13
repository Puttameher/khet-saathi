"use client";
/**
 * The living field. One requestAnimationFrame loop drives every moving part by writing
 * transforms/opacity (and a few colours when light changes) straight to DOM refs — React
 * renders the structure once and only re-renders when crop/stage change.
 *
 * Inputs are REAL: hourly forecast (Open-Meteo or a visibly-marked demo overlay), farm
 * lat/lon for the sun, crop + stage from the profile. With no forecast the scene shows a
 * neutral sky (sun by time only, no clouds/rain) — weather is never invented.
 */
import { memo, useEffect, useRef, useState } from "react";
import type { HourPoint } from "@/lib/weather";
import { scene as SC, sky as SKY } from "@/design/tokens";
import {
  SKY_KEYS, celestial, clamp01, cloudSpeed, daylight, lerp, mixHex, moonPhase, rainIntensity,
  skyLayerOpacity, smoothstep, sunElevation, swayDeg, weatherAt, type SkyKey,
} from "@/lib/client/scene";
import { PlantSprite, stageSpacing, type CropId, type StageId } from "@/components/khet/sprites";
import { RainSystem } from "@/components/khet/rain";

export interface KhetSceneProps {
  hourly: HourPoint[] | null;
  /** epoch ms to show; null = live (now) */
  time: number | null;
  lat: number;
  lon: number;
  crop: { id: CropId; stage: StageId } | null;
  className?: string;
}

const VB_W = 400, VB_H = 320, FIELD_Y = 192;
const ROWS = 7;

// deterministic pseudo-random
const prand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return Math.round((x - Math.floor(x)) * 1e4) / 1e4; // rounded: identical on server and client
};

const CLOUDS = [
  ...[0, 1, 2, 3, 4].map((i) => ({ depth: 0, x0: i * 95 + prand(i) * 40, y: 28 + prand(i + 10) * 38, s: 0.5 + prand(i + 20) * 0.15, th: [0.12, 0.42, 0.62, 0.3, 0.8][i]!, base: 0.6 })),
  ...[0, 1, 2, 3].map((i) => ({ depth: 1, x0: i * 120 + 40 + prand(i + 30) * 50, y: 58 + prand(i + 40) * 34, s: 0.8 + prand(i + 50) * 0.2, th: [0.05, 0.5, 0.25, 0.72][i]!, base: 0.82 })),
  ...[0, 1, 2].map((i) => ({ depth: 2, x0: i * 170 + prand(i + 60) * 60, y: 92 + prand(i + 70) * 26, s: 1.15 + prand(i + 80) * 0.25, th: [0.2, 0.55, 0.85][i]!, base: 0.92 })),
];
const STARS = Array.from({ length: 46 }, (_, i) => ({ x: prand(i + 100) * VB_W, y: prand(i + 200) * 150, r: 0.4 + prand(i + 300) * 0.9, tw: prand(i + 400) }));

const ROW_GEOM = Array.from({ length: ROWS }, (_, i) => {
  const f = i / (ROWS - 1);
  return { y: FIELD_Y + 7 + Math.pow(f, 1.3) * 118, s: 0.36 + 0.84 * Math.pow(f, 1.2), off: prand(i + 500) };
});

function CloudShape() {
  return (
    <>
      <rect x="-44" y="-9" width="88" height="17" rx="8.5" />
      <circle cx="-24" cy="-8" r="14" />
      <circle cx="-2" cy="-15" r="19" />
      <circle cx="20" cy="-7" r="13" />
      <circle cx="35" cy="-1" r="8.5" />
      <circle cx="-38" cy="-1" r="8.5" />
    </>
  );
}

interface Live { cloud: number; rain: number; wind: number; gust: number; soil: number; storm: number; fog: number; drizzle: boolean; thunder: boolean; hasData: boolean }

export const KhetScene = memo(function KhetScene({ hourly, time, lat, lon, crop, className }: KhetSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const skyRefs = useRef<Partial<Record<SkyKey | "ocDay" | "ocNight" | "storm", HTMLDivElement | null>>>({});
  const props = useRef({ hourly, time, lat, lon });
  props.current = { hourly, time, lat, lon };

  // moon phase is time-dependent → computed after mount only (no SSR mismatch)
  const [phase, setPhase] = useState(0.5);
  useEffect(() => setPhase(moonPhase(time ?? Date.now())), [time]);
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const waxing = phase < 0.5;

  useEffect(() => {
    const root = rootRef.current!, svg = svgRef.current!, canvas = canvasRef.current!;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T | null;
    const qa = (sel: string) => Array.from(svg.querySelectorAll(sel));
    const sun = q<SVGGElement>("[data-k=sun]")!, moon = q<SVGGElement>("[data-k=moon]")!;
    const sunGlow = q<SVGCircleElement>("[data-k=sunglow]")!;
    const stars = q<SVGGElement>("[data-k=stars]")!;
    const cloudEls = qa("[data-k=cloud]") as SVGGElement[];
    const cloudDark = qa("[data-k=clouddark]") as SVGGElement[];
    const depthEls = [0, 1, 2].map((d) => q<SVGGElement>(`[data-k=cdepth${d}]`)!);
    const hillFar = q<SVGPathElement>("[data-k=hillfar]")!, hillNear = q<SVGPathElement>("[data-k=hillnear]")!;
    const hillFarG = q<SVGGElement>("[data-k=hillfarg]")!, hillNearG = q<SVGGElement>("[data-k=hillnearg]")!;
    const fieldG = q<SVGGElement>("[data-k=field]")!, soil = q<SVGRectElement>("[data-k=soil]")!;
    const celestialG = q<SVGGElement>("[data-k=celestial]")!;
    const puddles = q<SVGGElement>("[data-k=puddles]")!;
    const mist = q<SVGRectElement>("[data-k=mist]")!;
    const trees = q<SVGGElement>("[data-k=trees]")!;
    const sway = () => qa("[data-k=sway]") as SVGGElement[];
    let swayEls = sway();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let rain: RainSystem | null = null;
    try { rain = new RainSystem(canvas); } catch { rain = null; }

    // smoothed state
    let tCur = props.current.time ?? Date.now();
    const cur: Live = { cloud: 0, rain: 0, wind: 0, gust: 0, soil: 0.35, storm: 0, fog: 0, drizzle: false, thunder: false, hasData: false };
    let first = true;
    let lastPaint = { light: -1, soil: -1, storm: -1 };
    let par = { x: 0, y: 0 }, parT = { x: 0, y: 0 };
    let clock = 0, last = 0, raf = 0, running = false;
    let nextStrike = 3, flash = 0, flash2 = -1;
    let dbgTick = 0;

    let visL = 0, visR = VB_W;
    const layout = () => {
      const r = root.getBoundingClientRect();
      const scale = Math.max(r.width / VB_W, r.height / VB_H);
      const visW = r.width / scale;
      visL = (VB_W - visW) / 2; visR = visL + visW;
      const offY = r.height - VB_H * scale;
      rain?.resize(r.width, r.height, window.devicePixelRatio || 1);
      if (rain) rain.groundTop = clamp01((offY + FIELD_Y * scale) / r.height);
    };

    const targetLive = (t: number): Live => {
      const w = props.current.hourly ? weatherAt(props.current.hourly, t) : null;
      if (!w) return { cloud: 0, rain: 0, wind: 3, gust: 0, soil: 0.35, storm: 0, fog: 0, drizzle: false, thunder: false, hasData: false };
      const inten = rainIntensity(w.precipMm, w.condition);
      const storm = w.condition === "thunder" ? 1 : w.condition === "heavy_rain" ? 0.75 : w.condition === "rain" ? 0.45 : w.condition === "drizzle" ? 0.18 : 0;
      return {
        cloud: Math.max(w.cloud, storm * 0.9), rain: inten, wind: w.windKmh, gust: w.gustKmh ?? 0, soil: Math.max(w.soil, inten * 0.8),
        storm: storm * Math.max(0.5, w.cloud), fog: w.condition === "fog" ? 0.8 : w.humidity >= 95 ? 0.3 : 0,
        drizzle: w.condition === "drizzle", thunder: w.condition === "thunder", hasData: true,
      };
    };

    const paint = (light: number, wet: number, storm: number) => {
      if (Math.abs(light - lastPaint.light) < 0.004 && Math.abs(wet - lastPaint.soil) < 0.004 && Math.abs(storm - lastPaint.storm) < 0.004) return;
      lastPaint = { light, soil: wet, storm };
      const dark = clamp01(1 - light + storm * 0.3);
      hillFar.setAttribute("fill", mixHex(mixHex(SC.hillFar[0], "#8C9890", storm * 0.4), SC.hillFar[1], dark));
      hillNear.setAttribute("fill", mixHex(mixHex(SC.hillNear[0], "#66756A", storm * 0.4), SC.hillNear[1], dark));
      trees.setAttribute("fill", mixHex("#45663F", "#1E2A20", dark));
      const soilDay = mixHex(SC.soilDry[0], SC.soilWet[0], wet), soilNight = mixHex(SC.soilDry[1], SC.soilWet[1], wet);
      const soilC = mixHex(soilDay, soilNight, dark);
      soil.setAttribute("fill", soilC);
      const st = fieldG.style;
      st.setProperty("--k-soil-dark", mixHex(soilC, "#000000", 0.32));
      st.setProperty("--k-leaf", mixHex(SC.leafYoung, "#1B2A20", dark * 0.78));
      st.setProperty("--k-leaf2", mixHex(SC.leafMature, "#142019", dark * 0.78));
      st.setProperty("--k-grain", mixHex(SC.grainGold, "#3C3423", dark * 0.75));
      st.setProperty("--k-grain-deep", mixHex("#C2902F", "#2E281B", dark * 0.75));
      st.setProperty("--k-bulb", mixHex(SC.onionBulb, "#3A2A30", dark * 0.75));
      puddles.style.setProperty("--k-sheen", mixHex("#DCEAF2", "#3A4A66", dark));
    };

    const frame = (dt: number, still: boolean) => {
      const P = props.current;
      const target = P.time ?? Date.now();
      if (first || still || Math.abs(target - tCur) > 72 * 3_600_000) tCur = target;
      else tCur += (target - tCur) * (1 - Math.exp(-dt / 0.32));
      const tgt = targetLive(tCur);
      const k = first || still ? 1 : 1 - Math.exp(-dt / 0.6);
      cur.cloud = lerp(cur.cloud, tgt.cloud, k);
      cur.rain = lerp(cur.rain, tgt.rain, k);
      cur.wind = lerp(cur.wind, tgt.wind, k);
      cur.gust = lerp(cur.gust, tgt.gust, k);
      cur.soil = lerp(cur.soil, tgt.soil, k);
      cur.storm = lerp(cur.storm, tgt.storm, k);
      cur.fog = lerp(cur.fog, tgt.fog, k);
      cur.drizzle = tgt.drizzle; cur.thunder = tgt.thunder; cur.hasData = tgt.hasData;
      first = false;

      const elev = sunElevation(tCur, P.lat, P.lon);
      const day = daylight(elev);
      const light = day * (1 - 0.4 * cur.storm);

      // sky: stacked base keyframes + overcast + storm, opacity only
      const ops = skyLayerOpacity(elev);
      for (const kf of SKY_KEYS) { const el = skyRefs.current[kf.id]; if (el) el.style.opacity = ops[kf.id].toFixed(3); }
      const oc = smoothstep(0.3, 1, cur.cloud) * 0.92;
      const s = skyRefs.current;
      if (s.ocDay) s.ocDay.style.opacity = (oc * day).toFixed(3);
      if (s.ocNight) s.ocNight.style.opacity = (oc * (1 - day)).toFixed(3);
      if (s.storm) s.storm.style.opacity = (cur.storm * 0.85 * (0.35 + 0.65 * day)).toFixed(3);

      // stars
      stars.style.opacity = ((1 - smoothstep(-14, -4, elev)) * Math.pow(1 - cur.cloud, 1.6) * 0.95).toFixed(3);

      // sun / moon: x by arc fraction, sun height by real elevation
      const c = celestial(tCur, P.lat, P.lon);
      const sunOp = smoothstep(-3, 1.5, elev);
      if (c.body === "sun" || sunOp > 0) {
        const f = c.body === "sun" ? c.frac : c.frac < 0.5 ? 1.02 : -0.02;
        const y = 168 - (Math.max(-6, Math.min(70, elev)) / 70) * 140;
        sun.setAttribute("transform", `translate(${(visL + 26 + f * (visR - visL - 52)).toFixed(1)} ${y.toFixed(1)})`);
      }
      sun.style.opacity = sunOp.toFixed(3);
      sunGlow.style.opacity = ((1 - cur.cloud * 0.8) * (0.55 + 0.45 * smoothstep(0, 12, elev))).toFixed(3);
      const moonOp = (1 - smoothstep(-7, -1, elev)) * (1 - cur.cloud * 0.75);
      if (c.body === "moon") {
        const mx = visL + 30 + c.frac * (visR - visL - 60), my = 150 - Math.sin(c.frac * Math.PI) * 105;
        moon.setAttribute("transform", `translate(${mx.toFixed(1)} ${my.toFixed(1)})`);
      }
      moon.style.opacity = (c.body === "moon" ? moonOp : 0).toFixed(3);

      // clouds drift with wind (3 depths), visibility by real cover, darker in storms/night
      const darkC = clamp01(cur.storm * 0.95 + (1 - day) * 0.85 + smoothstep(0.7, 1, cur.cloud) * 0.25);
      for (let i = 0; i < CLOUDS.length; i++) {
        const cd = CLOUDS[i]!;
        const span = VB_W + 260;
        const x = still ? cd.x0 : ((((cd.x0 + clock * cloudSpeed(cur.wind, cd.depth)) % span) + span) % span) - 130;
        const vis = smoothstep(cd.th - 0.14, cd.th + 0.06, cur.cloud) * cd.base;
        const el = cloudEls[i]!;
        el.setAttribute("transform", `translate(${x.toFixed(1)} ${cd.y.toFixed(1)}) scale(${cd.s.toFixed(3)})`);
        el.style.opacity = vis.toFixed(3);
        cloudDark[i]!.style.opacity = darkC.toFixed(3);
      }

      // parallax (pointer / tilt + slow idle breathing)
      const kp = still ? 1 : 1 - Math.exp(-dt / 0.5);
      par.x += (parT.x - par.x) * kp; par.y += (parT.y - par.y) * kp;
      const idle = still ? 0 : Math.sin(clock / 9) * 0.25;
      const px = par.x + idle, py = par.y;
      celestialG.setAttribute("transform", `translate(${(px * -1.5).toFixed(2)} ${(py * -1).toFixed(2)})`);
      depthEls.forEach((el, d) => el.setAttribute("transform", `translate(${(px * -(2 + d * 2)).toFixed(2)} ${(py * -(1 + d)).toFixed(2)})`));
      hillFarG.setAttribute("transform", `translate(${(px * -3).toFixed(2)} ${(py * -1).toFixed(2)})`);
      hillNearG.setAttribute("transform", `translate(${(px * -5).toFixed(2)} ${(py * -1.5).toFixed(2)})`);
      fieldG.setAttribute("transform", `translate(${(px * -8).toFixed(2)} 0)`);

      // crop sway ∝ wind (gusts add flutter), a wave travelling back→front
      const amp = swayDeg(cur.wind, cur.gust);
      const freq = 0.9 + Math.min(1.6, cur.wind / 18);
      const lean = amp * 0.35;
      for (let i = 0; i < swayEls.length; i++) {
        const el = swayEls[i]!;
        const y = Number(el.dataset.y);
        const a = still ? lean * 0.5 : lean + amp * 0.65 * Math.sin(clock * freq * 2.1 - i * 0.55) + amp * 0.15 * Math.sin(clock * freq * 5.3 + i);
        el.setAttribute("transform", `translate(0 ${y}) skewX(${a.toFixed(2)}) translate(0 ${-y})`);
      }

      // soil + puddle sheen + mist
      paint(light, cur.soil, cur.storm);
      puddles.style.opacity = (smoothstep(0.55, 0.95, cur.soil) * 0.7 + cur.rain * 0.25).toFixed(3);
      mist.style.opacity = (cur.fog * 0.85).toFixed(3);

      // rain + lightning
      if (rain) {
        const rp = { intensity: cur.rain < 0.02 ? 0 : cur.rain, windKmh: cur.wind, drizzle: cur.drizzle, night: 1 - day };
        if (still) {
          if (rp.intensity > 0) rain.stillFrame(rp); else rain.clear();
        } else {
          rain.step(Math.min(dt, 0.05), rp);
          if (cur.thunder && cur.storm > 0.4) {
            nextStrike -= dt;
            if (nextStrike <= 0) { rain.strike(); flash = 1; flash2 = 0.13; nextStrike = 2.5 + Math.random() * 5.5; }
          }
          if (rp.intensity > 0 || rain.active) rain.draw(rp);
        }
      }
      if (flash2 >= 0) { flash2 -= dt; if (flash2 < 0) flash = Math.max(flash, 0.75); }
      if (flashRef.current) flashRef.current.style.opacity = (flash * 0.5).toFixed(3);
      flash = Math.max(0, flash - dt * 5);

      if (++dbgTick % 20 === 0 || still) {
        root.dataset.elev = elev.toFixed(1);
        root.dataset.cloud = cur.cloud.toFixed(2);
        root.dataset.rain = cur.rain.toFixed(2);
        root.dataset.wind = cur.wind.toFixed(1);
      }
    };

    const loop = (ts: number) => {
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 1 / 60;
      last = ts;
      clock += dt;
      frame(dt, false);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || document.hidden || reduced.matches) return;
      running = true; last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    const still = () => { stop(); frame(0, true); };

    const onVis = () => (document.hidden ? stop() : reduced.matches ? still() : start());
    const onMotion = () => (reduced.matches ? still() : start());
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      parT = { x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 };
    };
    const onLeave = () => { parT = { x: 0, y: 0 }; };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      parT = { x: Math.max(-1, Math.min(1, e.gamma / 25)), y: Math.max(-1, Math.min(1, (e.beta - 45) / 40)) };
    };
    const ro = new ResizeObserver(() => { layout(); if (reduced.matches) still(); });
    ro.observe(root);
    layout();
    document.addEventListener("visibilitychange", onVis);
    reduced.addEventListener("change", onMotion);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    window.addEventListener("deviceorientation", onTilt);
    // rows remount when crop/stage changes → refresh the sway list
    const mo = new MutationObserver(() => { swayEls = sway(); });
    mo.observe(fieldG, { childList: true, subtree: true });
    (root as HTMLDivElement & { __ksRedraw?: () => void }).__ksRedraw = () => { if (reduced.matches) still(); };
    if (reduced.matches) still(); else start();
    return () => {
      stop();
      ro.disconnect(); mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduced.removeEventListener("change", onMotion);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, []);

  // reduced-motion: no loop, so redraw once whenever inputs change
  useEffect(() => {
    (rootRef.current as (HTMLDivElement & { __ksRedraw?: () => void }) | null)?.__ksRedraw?.();
  }, [hourly, time, lat, lon, crop]);

  const skyBg = (top: string, hor: string) => `linear-gradient(180deg, ${top} 0%, ${hor} 58%, ${hor} 100%)`;
  const skyLayers: { id: SkyKey | "ocDay" | "ocNight" | "storm"; bg: string; base: number }[] = [
    { id: "night", bg: skyBg(SKY.night[0], SKY.night[1]), base: 1 },
    { id: "astro", bg: skyBg(SKY.astro[0], SKY.astro[1]), base: 0 },
    { id: "dawn", bg: skyBg(SKY.dawn[0], SKY.dawn[1]), base: 0 },
    { id: "golden", bg: skyBg(SKY.golden[0], SKY.golden[1]), base: 0 },
    { id: "day", bg: skyBg(SKY.day[0], SKY.day[1]), base: 0 },
    { id: "ocDay", bg: skyBg(SKY.overcastDay[0], SKY.overcastDay[1]), base: 0 },
    { id: "ocNight", bg: skyBg(SKY.overcastNight[0], SKY.overcastNight[1]), base: 0 },
    { id: "storm", bg: skyBg(SKY.storm[0], SKY.storm[1]), base: 0 },
  ];

  const spacing = crop ? stageSpacing[crop.stage] : 1;
  const stageKey = crop ? `${crop.id}-${crop.stage}` : "none";

  return (
    <div ref={rootRef} className={`absolute inset-0 overflow-hidden ${className ?? ""}`} style={{ contain: "strict" }} aria-hidden>
      {skyLayers.map((l) => (
        <div key={l.id} ref={(el) => { skyRefs.current[l.id] = el; }} className="absolute inset-0" style={{ background: l.bg, opacity: l.base, willChange: "opacity" }} />
      ))}
      <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="ks-sunglow">
            <stop offset="0" stopColor="#FFF3C9" stopOpacity="0.95" />
            <stop offset="0.25" stopColor="#FFD98A" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FFC56B" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ks-moonglow">
            <stop offset="0" stopColor="#E9EEFF" stopOpacity="0.35" />
            <stop offset="1" stopColor="#E9EEFF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ks-fieldshade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.22" />
            <stop offset="0.35" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id="ks-mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E6EBE8" stopOpacity="0" />
            <stop offset="0.5" stopColor="#E6EBE8" stopOpacity="0.75" />
            <stop offset="1" stopColor="#E6EBE8" stopOpacity="0.15" />
          </linearGradient>
          <radialGradient id="ks-puddle">
            <stop offset="0" stopColor="var(--k-sheen, #DCEAF2)" stopOpacity="0.75" />
            <stop offset="1" stopColor="var(--k-sheen, #DCEAF2)" stopOpacity="0" />
          </radialGradient>
          <mask id="ks-moonmask">
            <circle cx="0" cy="0" r="11" fill="#fff" />
            <circle cx={((waxing ? -1 : 1) * 22 * illum).toFixed(2)} cy="-1" r="11.5" fill="#000" />
          </mask>
          <g id="ks-plant">{crop && <PlantSprite crop={crop.id} stage={crop.stage} />}</g>
        </defs>

        <g data-k="stars" style={{ opacity: 0 }}>
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={s.r.toFixed(2)} fill="#F4F1E6" className="ks-twinkle" style={{ animationDelay: `${(-s.tw * 5).toFixed(2)}s` }} />
          ))}
        </g>

        <g data-k="celestial">
          <g data-k="sun" style={{ opacity: 0 }}>
            <circle data-k="sunglow" r="70" fill="url(#ks-sunglow)" />
            <circle r="15" fill="#FFF1C4" />
            <circle r="15" fill="none" stroke="#FFE39A" strokeOpacity="0.6" strokeWidth="3" />
          </g>
          <g data-k="moon" style={{ opacity: 0 }}>
            <circle r="44" fill="url(#ks-moonglow)" />
            <circle r="11" fill="#2A3150" opacity="0.35" />
            <circle r="11" fill="#EFEAD8" mask="url(#ks-moonmask)" />
          </g>
        </g>

        {[0, 1, 2].map((d) => (
          <g key={d} data-k={`cdepth${d}`}>
            {CLOUDS.map((c, i) => c.depth === d && (
              <g key={i} data-k="cloud" style={{ opacity: 0 }}>
                <g fill="#FFFFFF"><CloudShape /></g>
                <ellipse cx="0" cy="5" rx="40" ry="4" fill="#5A6470" opacity="0.12" />
                <g data-k="clouddark" fill="#3B424D" style={{ opacity: 0 }}><CloudShape /></g>
              </g>
            ))}
          </g>
        ))}

        <g data-k="hillfarg">
          <path data-k="hillfar" fill={SC.hillFar[0]} d="M-30 160 C40 128 95 138 150 144 C210 150 250 124 310 128 C360 131 395 144 440 138 V320 H-30Z" />
        </g>
        <g data-k="hillnearg">
          <path data-k="hillnear" fill={SC.hillNear[0]} d="M-40 186 C30 166 90 174 160 178 C230 182 290 164 350 170 C390 174 420 180 450 176 V320 H-40Z" />
          <g data-k="trees" fill="#45663F">
            {[[58, 173, 1], [72, 175, 0.75], [300, 166, 1.1], [318, 169, 0.8], [204, 179, 0.7]].map(([x, y, s], i) => (
              <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
                <rect x="-0.9" y="-4" width="1.8" height="5" />
                <circle cx="0" cy="-8" r="5.2" />
                <circle cx="3" cy="-6" r="3.6" />
                <circle cx="-3" cy="-6" r="3.4" />
              </g>
            ))}
          </g>
        </g>

        <rect data-k="mist" x="-40" y="128" width="480" height="80" fill="url(#ks-mist)" style={{ opacity: 0 }} />

        <g data-k="field">
          <rect data-k="soil" x="-40" y={FIELD_Y} width="480" height={VB_H - FIELD_Y + 10} fill={SC.soilDry[0]} />
          <rect x="-40" y={FIELD_Y} width="480" height={VB_H - FIELD_Y + 10} fill="url(#ks-fieldshade)" />
          <g data-k="puddles" style={{ opacity: 0 }}>
            {[[70, 300, 34], [250, 294, 42], [350, 309, 26], [160, 252, 22], [310, 238, 18]].map(([x, y, r], i) => (
              <ellipse key={i} cx={x} cy={y} rx={r} ry={(r ?? 20) * 0.16} fill="url(#ks-puddle)" />
            ))}
          </g>
          <g key={stageKey}>
            {ROW_GEOM.map((r, i) => {
              const step = 30 * r.s * spacing;
              const n = Math.ceil(470 / step) + 1;
              return (
                <g key={i} className="ks-row-in" style={{ animationDelay: `${120 + i * 85}ms` }}>
                  <ellipse cx="200" cy={r.y + 1.2 * r.s} rx="260" ry={2.6 * r.s} fill="var(--k-soil-dark)" opacity="0.55" />
                  {crop && (
                    <g data-k="sway" data-y={r.y}>
                      {Array.from({ length: n }, (_, j) => {
                        const x = -30 + j * step + r.off * step + (prand(i * 50 + j) - 0.5) * step * 0.25;
                        const s = r.s * (0.9 + prand(i * 70 + j) * 0.2);
                        return <use key={j} href="#ks-plant" transform={`translate(${x.toFixed(1)} ${r.y.toFixed(1)}) scale(${s.toFixed(3)})`} />;
                      })}
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div ref={flashRef} className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 80% at 50% 10%, #F2F5FF, rgba(220,230,255,0.4))", opacity: 0, willChange: "opacity" }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(130% 90% at 50% 40%, transparent 55%, rgba(10,8,5,0.28))" }} />
    </div>
  );
});
