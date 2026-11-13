"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useApp } from "@/components/shell/AppContext";
import { BriefingCard } from "@/components/shell/BriefingCard";
import { istClock, istDayClock } from "@/components/shell/time";
import { KhetScene } from "@/components/khet/KhetScene";
import { HealthBubble } from "@/components/khet/HealthBubble";
import { TimeScrubber } from "@/components/khet/TimeScrubber";
import { RowGlow, SprayLayer } from "@/components/khet/SprayLayer";
import { IconSpray } from "@/components/shell/Icons";
import type { CropId, StageId } from "@/components/khet/sprites";

/** Spray tasks seen in progress, kept across tab switches so "done" is noticed on return. */
let seenSpraying: string[] = [];

/** Approximate centre of India: used for the sun ONLY when the farm location is not known yet. */
const FALLBACK_LATLON = { lat: 22.97, lon: 78.66 };

export function KhetTab() {
  const { state, t, lang } = useApp();
  const [scrubT, setScrubT] = useState<number | null>(null);
  const wx = state?.weather ?? null;
  const crop = state?.crop;
  const lat = state?.profile.lat ?? FALLBACK_LATLON.lat;
  const lon = state?.profile.lon ?? FALLBACK_LATLON.lon;
  const sceneCrop = useMemo(() => (crop ? { id: crop.id as CropId, stage: crop.stage as StageId } : null), [crop?.id, crop?.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const hourly = wx?.hourly ?? null;
  const isDemo = wx?.source === "demo";
  const reduced = useReducedMotion();

  // spray animation: any spray task in progress → sprayer crosses the rows; when one of those
  // tasks turns done → rows glow once (the Care Score orb springs on its own score change).
  const tasks = state?.tasks;
  const sprayingIds = useMemo(() => (tasks ?? []).filter((x) => x.type === "spray" && x.status === "in_progress").map((x) => x.id), [tasks]);
  const spraying = sprayingIds.length > 0;
  const [glowKey, setGlowKey] = useState(0);
  useEffect(() => {
    if (!tasks) return;
    const finished = seenSpraying.some((id) => tasks.find((x) => x.id === id)?.status === "done");
    seenSpraying = sprayingIds;
    if (finished) setGlowKey((k) => k + 1);
  }, [sprayingIds, tasks]);
  useEffect(() => {
    if (!glowKey) return;
    const tm = setTimeout(() => setGlowKey(0), 2600);
    return () => clearTimeout(tm);
  }, [glowKey]);

  return (
    <div id="panel-khet" className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      <div className="relative h-[44vh] min-h-[290px] shrink-0 overflow-hidden rounded-[30px]" style={{ boxShadow: "var(--glass-shadow)" }}>
        <KhetScene hourly={hourly} time={scrubT} lat={lat} lon={lon} crop={sceneCrop} />
        {spraying && !reduced && <SprayLayer />}
        {glowKey > 0 && !reduced && <RowGlow key={glowKey} />}

        {/* data source + timestamp for every weather-driven visual */}
        <div className="absolute left-3 top-3 flex max-w-[64%] flex-col items-start gap-1.5">
          {wx ? (
            <div className="num flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-[11.5px] font-medium text-white/90 backdrop-blur-md" data-testid="wx-source">
              {isDemo ? (
                <span className="rounded-full px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide text-white" style={{ background: "var(--ks-clay)" }}>DEMO</span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: wx.stale ? "var(--ks-amber)" : "var(--ks-leaf-bright)" }} />
              )}
              <span className="truncate">{isDemo ? t.demo : "Open-Meteo"} · {istClock(wx.fetchedAt)} IST{wx.stale ? ` · ${t.stale}` : ""}</span>
            </div>
          ) : (
            <div className="rounded-full bg-black/35 px-2.5 py-1 text-[11.5px] font-medium text-white/90 backdrop-blur-md" data-testid="wx-source">
              {t.noWeather} · {t.noWeatherHint}
            </div>
          )}
          <AnimatePresence initial={false}>
            {spraying && (
              <motion.div
                key="spraying"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md"
                style={{ background: "color-mix(in srgb, var(--ks-leaf) 78%, transparent)" }}
                data-testid="spraying-badge"
              >
                <IconSpray size={14} /> {t.sprayingNow}
              </motion.div>
            )}
          </AnimatePresence>
          {scrubT != null && (
            <div className="num rounded-full bg-black/30 px-2.5 py-1 text-[11.5px] text-white/90 backdrop-blur-md">{t.forecastAt} · {istDayClock(scrubT, lang)}</div>
          )}
        </div>

        {state && <HealthBubble health={state.health} />}

        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="glass flex items-end justify-between rounded-[22px] p-3.5">
            <div className="min-w-0">
              <div className="eyebrow" style={{ color: "var(--muted)" }}>{crop ? `${crop.name} · ${t.cropDay} ${crop.day}` : t.today}</div>
              <div className="font-display truncate text-[26px] leading-tight">{crop ? crop.stageLabel : t.noCrop}</div>
            </div>
            {crop && (
              <div className="h-12 w-12 shrink-0">
                <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-label={`${Math.round(crop.progress * 100)}%`}>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="3.5" />
                  <motion.circle cx="18" cy="18" r="15" fill="none" stroke="var(--ks-leaf)" strokeWidth="3.5" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" initial={{ strokeDashoffset: 1 }} animate={{ strokeDashoffset: 1 - crop.progress }} transition={{ type: "spring", stiffness: 60, damping: 16 }} />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      {wx && hourly && hourly.length > 1 && (
        <TimeScrubber
          hourly={hourly}
          strip={state?.strip ?? []}
          value={scrubT}
          onChange={setScrubT}
          lat={lat}
          lon={lon}
          source={{ label: "Open-Meteo", fetchedAt: wx.fetchedAt, stale: wx.stale, demo: isDemo }}
        />
      )}
      <BriefingCard compact />
    </div>
  );
}

