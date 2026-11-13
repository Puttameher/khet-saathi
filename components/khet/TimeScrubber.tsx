"use client";
/**
 * 48-hour time scrubber. Drag (pointer/touch) or use arrow keys to move through the hourly
 * forecast; the parent feeds the scrubbed instant to KhetScene so the sky, sun/moon, clouds,
 * rain and crop sway follow. The spray strip underneath is the rules engine's own hour-by-hour
 * output (`state.strip` from lib/rules sprayStrip) — this component only colours it.
 *
 * value === null means "live / now". Times are shown in IST.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HourPoint } from "@/lib/weather";
import type { Severity } from "@/lib/rules";
import { useApp } from "@/components/shell/AppContext";
import { IconCloudRain, IconDrop, IconRefresh, IconWind } from "@/components/shell/Icons";
import { istClock, istDayClock } from "@/components/shell/time";
import { relativeLabel } from "@/lib/time";
import { clamp01, daylight, mixHex, sunElevation, weatherAt } from "@/lib/client/scene";
import { palette } from "@/design/tokens";

const HOUR = 3_600_000;
const SPAN_H = 48;
const IST_OFF = 5.5 * HOUR;
const istHour = (ms: number) => new Date(ms + IST_OFF).getUTCHours();
const istKey = (ms: number) => new Date(ms + IST_OFF).toISOString().slice(0, 10);

type Spray = "GO" | "WAIT" | "SKIP";
/** Presentation only: the rules engine already decided the severity. */
const sprayOf = (sev: Severity | string): Spray => (sev === "skip" ? "SKIP" : sev === "wait" ? "WAIT" : "GO");
const SPRAY_COLOR: Record<Spray, string> = { GO: palette.leaf, WAIT: palette.amber, SKIP: palette.clay };

export interface TimeScrubberProps {
  hourly: HourPoint[];
  strip: { t: number; sev: string }[];
  value: number | null;
  onChange: (ms: number | null) => void;
  lat: number;
  lon: number;
  source: { label: string; fetchedAt: string; stale: boolean; demo: boolean };
}

export function TimeScrubber({ hourly, strip, value, onChange, lat, lon, source }: TimeScrubberProps) {
  const { t, lang } = useApp();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const t0 = now;
  const lastT = hourly.length ? hourly[hourly.length - 1]!.t : now;
  const t1 = Math.max(t0 + HOUR, Math.min(t0 + SPAN_H * HOUR, lastT));
  const span = t1 - t0;
  const pos = useCallback((ms: number) => clamp01((ms - t0) / span), [t0, span]);
  const shown = value ?? now;
  const live = value == null;

  // hours inside the window (for keyboard steps, labels, snapping)
  const hours = useMemo(() => hourly.filter((h) => h.t > t0 - HOUR && h.t <= t1 + 1).map((h) => h.t), [hourly, t0, t1]);
  const at = useMemo(() => weatherAt(hourly, shown), [hourly, shown]);
  const sprayAt = useMemo(() => {
    const s = strip.find((x) => shown >= x.t && shown < x.t + HOUR) ?? strip.find((x) => Math.abs(x.t - shown) < HOUR);
    return s ? sprayOf(s.sev) : null;
  }, [strip, shown]);

  // track background: day/night by real sun elevation at the farm, dawn/dusk warmed with haldi
  const gradient = useMemo(() => {
    const stops: string[] = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const ms = t0 + (span * i) / n;
      const elev = sunElevation(ms, lat, lon);
      const d = daylight(elev);
      let c = mixHex("#2B2620", "#EFE5CF", d);
      c = mixHex(c, palette.haldi, clamp01(1 - Math.abs(elev) / 7) * 0.45);
      stops.push(`${c} ${((i / n) * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [t0, span, lat, lon]);

  const stripBg = useMemo(() => {
    const segs = strip.filter((x) => x.t + HOUR > t0 && x.t < t1);
    if (!segs.length) return "var(--line)";
    const stops: string[] = [];
    for (const x of segs) {
      const night = sunElevation(x.t + HOUR / 2, lat, lon) < -3;
      const c = night ? mixHex(SPRAY_COLOR[sprayOf(x.sev)], "#E6DCC8", 0.68) : SPRAY_COLOR[sprayOf(x.sev)];
      const a = (pos(Math.max(x.t, t0)) * 100).toFixed(2), b = (pos(x.t + HOUR) * 100).toFixed(2);
      stops.push(`${c} ${a}%`, `${c} ${b}%`);
    }
    const end = pos(segs[segs.length - 1]!.t + HOUR) * 100;
    if (end < 100) stops.push(`rgba(0,0,0,0.06) ${end.toFixed(2)}%`, "rgba(0,0,0,0.06) 100%");
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [strip, t0, t1, pos, lat, lon]);

  const temps = useMemo(() => hourly.filter((h) => h.t >= t0 - HOUR && h.t <= t1 + HOUR), [hourly, t0, t1]);
  const tMin = Math.min(...temps.map((h) => h.tempC)), tMax = Math.max(...temps.map((h) => h.tempC));
  const tempPath = useMemo(() => {
    if (temps.length < 2) return "";
    const range = Math.max(4, tMax - tMin);
    return temps
      .map((h, i) => `${i ? "L" : "M"}${(pos(h.t) * 1000).toFixed(1)} ${(34 - ((h.tempC - tMin) / range) * 26).toFixed(1)}`)
      .join(" ");
  }, [temps, tMin, tMax, pos]);

  const ticks = useMemo(
    () => hours.filter((ms) => ms >= t0 && istHour(ms) % 6 === 0).map((ms) => ({ ms, h: istHour(ms) })),
    [hours, t0],
  );

  // ---------- interaction ----------
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastHourRef = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const rafRef = useRef(0);
  const [active, setActive] = useState(false);
  const reduced = useRef(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = m.matches;
    const f = () => (reduced.current = m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);

  /** Micro feedback when the scrub crosses an hour: a 3 ms buzz (where supported) and a knob pulse. */
  const feedback = useCallback((ms: number) => {
    const hk = Math.floor((ms + IST_OFF) / HOUR);
    if (lastHourRef.current === hk) return;
    const prev = lastHourRef.current;
    lastHourRef.current = hk;
    if (prev == null) return;
    const newDay = istHour(ms) === 0;
    try { navigator.vibrate?.(newDay ? 9 : 3); } catch { /* unsupported */ }
    if (!reduced.current) knobRef.current?.animate([{ transform: "translate(-50%,-50%) scale(1.18)" }, { transform: "translate(-50%,-50%) scale(1)" }], { duration: 160, easing: "cubic-bezier(0.22,1,0.36,1)" });
  }, []);

  const emit = useCallback(
    (ms: number | null) => {
      pending.current = ms;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        onChange(pending.current);
      });
    },
    [onChange],
  );
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const msAtX = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return t0 + clamp01((clientX - r.left) / r.width) * span;
  };
  /** Settle on a whole forecast hour; anything at/before now is "live". */
  const snap = (ms: number): number | null => {
    let best = ms, bd = Infinity;
    for (const h of hours) { const d = Math.abs(h - ms); if (d < bd) { bd = d; best = h; } }
    return best <= t0 + 20 * 60_000 ? null : best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setActive(true);
    lastHourRef.current = Math.floor((shown + IST_OFF) / HOUR);
    const ms = msAtX(e.clientX);
    feedback(ms);
    emit(ms);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const ms = msAtX(e.clientX);
    feedback(ms);
    emit(ms);
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    emit(snap(msAtX(e.clientX)));
  };

  const step = (dir: 1 | -1, n = 1) => {
    const cur = value ?? t0;
    let target = cur;
    if (dir > 0) {
      const next = hours.filter((h) => h > cur + 60_000);
      target = next[Math.min(n, next.length) - 1] ?? cur;
    } else {
      const prev = hours.filter((h) => h < cur - 60_000);
      target = prev[Math.max(0, prev.length - n)] ?? t0;
    }
    feedback(target);
    onChange(target <= t0 + 60_000 ? null : target);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") step(1);
    else if (k === "ArrowLeft" || k === "ArrowDown") step(-1);
    else if (k === "PageUp") step(1, 6);
    else if (k === "PageDown") step(-1, 6);
    else if (k === "Home") onChange(null);
    else if (k === "End") onChange(hours[hours.length - 1] ?? null);
    else return;
    e.preventDefault();
  };

  const backToNow = () => {
    try { navigator.vibrate?.(8); } catch { /* unsupported */ }
    lastHourRef.current = null;
    onChange(null);
  };

  const p = pos(shown);
  const readTime = live ? `${t.now} · ${istClock(now)}` : istDayClock(shown, lang);
  const sprayLabel = sprayAt ? (sprayAt === "GO" ? t.sprayGo : sprayAt === "WAIT" ? t.sprayWait : t.spraySkip) : null;
  const ahead = Math.round((shown - now) / HOUR);

  return (
    <section className="glass rounded-[24px] px-3.5 pb-2.5 pt-3" aria-label={t.scrubLabel} data-testid="time-scrubber-card">
      {/* readout */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <div className="flex items-baseline gap-2">
            <span className="font-display truncate text-[23px] leading-none" data-testid="scrub-time">{readTime}</span>
            {!live && ahead > 0 && <span className="num shrink-0 text-[12px] font-medium" style={{ color: "var(--subtle)" }}>+{ahead}h</span>}
            {live && <span className="truncate text-[11.5px] font-medium" style={{ color: "var(--subtle)" }}>{t.drag} →</span>}
          </div>
          <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
            {at ? (
              <>
                <span style={{ color: "var(--fg)" }} data-testid="scrub-temp">{Math.round(at.tempC)}°C</span>
                <span className="flex items-center gap-1"><IconCloudRain size={15} style={{ color: palette.monsoon }} />{at.precipProb != null ? `${Math.round(at.precipProb)}%` : `${at.precipMm.toFixed(1)} mm`}</span>
                <span className="flex items-center gap-1"><IconWind size={15} style={{ color: palette.sage }} />{Math.round(at.windKmh)} km/h</span>
                <span className="flex items-center gap-1"><IconDrop size={14} style={{ color: palette.sky }} />{Math.round(at.humidity)}%</span>
              </>
            ) : (
              <span>{t.noWeather}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={backToNow}
          disabled={live}
          aria-label={t.backToNow}
          className="tap num flex shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold disabled:pointer-events-none disabled:opacity-0 motion-safe:transition-opacity active:scale-95"
          style={{ background: "var(--glass-strong)", borderColor: "var(--line)", color: "var(--fg)" }}
          data-testid="scrub-now"
        >
          <IconRefresh size={16} style={{ color: palette.haldiDeep }} />
          {t.now}
        </button>
      </div>

      {/* track */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={t.scrubLabel}
        aria-valuemin={0}
        aria-valuemax={SPAN_H}
        aria-valuenow={Math.max(0, ahead)}
        aria-valuetext={`${readTime}${at ? `, ${Math.round(at.tempC)}°C` : ""}${sprayLabel ? `, ${t.sprayStrip}: ${sprayLabel}` : ""}`}
        data-testid="time-scrubber"
        data-t0={t0}
        data-t1={t1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        className="relative mt-2.5 h-[56px] cursor-grab select-none rounded-[16px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ks-haldi)] active:cursor-grabbing"
        style={{ touchAction: "pan-y", background: gradient, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06), inset 0 1px 6px rgba(0,0,0,0.12)" }}
      >
        <svg viewBox="0 0 1000 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible rounded-[16px]" aria-hidden>
          {/* rain chance bars */}
          {hourly.filter((h) => h.t >= t0 - HOUR && h.t < t1).map((h) => {
            const pr = h.precipProb ?? Math.min(100, h.precipMm * 25);
            if (pr < 8) return null;
            const x0 = pos(h.t) * 1000, x1 = pos(h.t + HOUR) * 1000;
            const hgt = (pr / 100) * 30;
            return <rect key={h.t} x={x0 + 0.8} y={60 - hgt} width={Math.max(0, x1 - x0 - 1.6)} height={hgt} fill={palette.monsoon} opacity={0.62} />;
          })}
          {/* temperature curve */}
          {tempPath && <path d={tempPath} fill="none" stroke={palette.haldiDeep} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" opacity={0.85} />}
          {/* 6-hourly ticks, stronger at IST midnight */}
          {ticks.map(({ ms, h }) => (
            <line key={ms} x1={pos(ms) * 1000} x2={pos(ms) * 1000} y1={h === 0 ? 0 : 46} y2={60} stroke={h === 0 ? "rgba(255,248,230,0.55)" : "rgba(30,25,19,0.28)"} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={h === 0 ? "3 3" : undefined} />
          ))}
        </svg>

        {/* thumb */}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${p * 100}%` }}>
          <div className="absolute inset-y-[-4px] left-[-1.5px] w-[3px] rounded-full" style={{ background: "var(--fg)", boxShadow: "0 0 0 1.5px rgba(255,252,245,0.85)" }} />
          <div
            ref={knobRef}
            className="absolute left-0 top-1/2 grid h-[28px] w-[28px] place-items-center rounded-full motion-safe:transition-[box-shadow] motion-safe:duration-150"
            style={{
              transform: "translate(-50%,-50%)",
              background: "#FFFCF5",
              boxShadow: `0 0 0 ${active ? 5 : 3}px ${sprayAt ? SPRAY_COLOR[sprayAt] : "var(--fg)"}, 0 4px 14px rgba(30,25,19,0.35)`,
            }}
          >
            <span className="flex gap-[2px]" aria-hidden>
              <i className="block h-2.5 w-[2px] rounded bg-[#8A8170]" /><i className="block h-2.5 w-[2px] rounded bg-[#8A8170]" />
            </span>
          </div>
        </div>
      </div>

      {/* spray window strip, straight from the rules engine; shares the track's time axis */}
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full" style={{ background: stripBg }} data-testid="spray-strip" aria-hidden>
        <span className="absolute inset-y-0 w-[2px] rounded-full" style={{ left: `calc(${p * 100}% - 1px)`, background: "var(--fg)" }} />
      </div>
      {/* hour labels (IST) */}
      <div className="num relative mt-1 h-4 text-[10.5px] font-medium" style={{ color: "var(--subtle)" }} aria-hidden>
        {ticks.map(({ ms, h }) => {
          const x = pos(ms);
          if (x < 0.035 || x > 0.965) return null;
          const lbl = h === 0 ? relativeLabel(istKey(ms), new Date(now), lang) : h === 12 ? "12 PM" : h === 6 ? "6 AM" : "6 PM";
          return (
            <span key={ms} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${x * 100}%`, color: h === 0 ? "var(--fg)" : undefined, fontWeight: h === 0 ? 700 : undefined }}>
              {lbl}
            </span>
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center gap-3 pl-0.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>
        <span className="font-semibold">{t.sprayStrip}</span>
        {(["GO", "WAIT", "SKIP"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: SPRAY_COLOR[k] }} />
            {k === "GO" ? t.sprayGo : k === "WAIT" ? t.sprayWait : t.spraySkip}
          </span>
        ))}
        {sprayLabel && !live && (
          <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: "#FFFCF5", background: SPRAY_COLOR[sprayAt!] }} data-testid="scrub-spray">
            {sprayLabel}
          </span>
        )}
      </div>

      {/* source + timestamp */}
      <div className="num mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--subtle)" }}>
        <span className="truncate">{t.source}: {source.demo ? `${t.demo} (Open-Meteo)` : source.label} · {istClock(source.fetchedAt)} IST{source.stale ? ` · ${t.stale}` : ""}
        </span>
      </div>
    </section>
  );
}
