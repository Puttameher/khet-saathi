"use client";
import { motion } from "motion/react";
import { useApp } from "@/components/shell/AppContext";
import { BriefingCard } from "@/components/shell/BriefingCard";
import { IconCloudRain, IconDrop, IconWind } from "@/components/shell/Icons";
import { istClock } from "@/components/shell/time";

/** Placeholder until the animated field scene lands: calm hills + rows, real weather + crop stage numbers. */
export function KhetTab() {
  const { state, t } = useApp();
  const cur = state?.weather?.current;
  const today = state?.weather?.daily[0];
  const crop = state?.crop;
  return (
    <div id="panel-khet" className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      <div className="relative h-[46vh] min-h-[280px] overflow-hidden rounded-[30px]" style={{ background: "linear-gradient(180deg, var(--sky-top, #8DB8DC), var(--sky-bottom, #E7EFE9))" }}>
        <style>{`[data-theme="night"] #ks-scene{--sky-top:#0B1020;--sky-bottom:#2A2F48;--hill-far:#3B4A3A;--hill-near:#2C3A2C;--soil:#4A3626}`}</style>
        <svg id="ks-scene" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sky-top, #8DB8DC)" />
              <stop offset="1" stopColor="var(--sky-bottom, #E7EFE9)" />
            </linearGradient>
            <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#FFE7A8" />
              <stop offset="0.6" stopColor="#F4C46A" stopOpacity="0.9" />
              <stop offset="1" stopColor="#F4C46A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="400" height="300" fill="url(#sky)" />
          {cur?.isDay === false ? (
            <g className="floaty"><circle cx="300" cy="80" r="40" fill="#E9E4D4" opacity="0.12" /><circle cx="300" cy="80" r="20" fill="#EDE7D3" /><circle cx="308" cy="74" r="17" fill="var(--sky-top, #0B1020)" /></g>
          ) : (
            <circle className="floaty" cx="300" cy="80" r="46" fill="url(#sun)" />
          )}
          <path d="M0 190 C80 150 140 170 210 160 C290 148 340 165 400 150 V300 H0Z" fill="var(--hill-far, #7E9A73)" opacity="0.75" />
          <path d="M0 215 C90 190 170 205 250 196 C320 188 360 200 400 194 V300 H0Z" fill="var(--hill-near, #5F7F52)" />
          <path d="M0 232 H400 V300 H0Z" fill="var(--soil, #8A6643)" />
          {Array.from({ length: 9 }).map((_, i) => (
            <g key={i} className="row-reveal" style={{ ["--reveal-delay" as string]: `${i * 70}ms` }}>
              <path
                className="row-sway"
                style={{ ["--sway-delay" as string]: `${i * -0.37}s`, ["--sway-amp" as string]: `${Math.min(6, 1 + (cur?.windKmh ?? 6) / 6)}deg` }}
                d={`M${20 + i * 44} 300 C${24 + i * 44} 270 ${18 + i * 44} 250 ${26 + i * 44} 236`}
                stroke={i % 2 ? "#4F8A4A" : "#7DB36A"}
                strokeWidth="9"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          ))}
        </svg>
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="glass flex items-end justify-between rounded-[22px] p-3.5">
            <div>
              <div className="eyebrow" style={{ color: "var(--muted)" }}>{crop ? `${t.today} · ${crop.day}` : t.today}</div>
              <div className="font-display text-[26px] leading-tight">{crop ? crop.stageLabel : t.sceneSoon}</div>
            </div>
            {crop && (
              <div className="h-12 w-12">
                <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-label={`${Math.round(crop.progress * 100)}%`}>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="3.5" />
                  <motion.circle cx="18" cy="18" r="15" fill="none" stroke="var(--ks-leaf)" strokeWidth="3.5" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" initial={{ strokeDashoffset: 1 }} animate={{ strokeDashoffset: 1 - crop.progress }} transition={{ type: "spring", stiffness: 60, damping: 16 }} />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      {cur && (
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<IconCloudRain size={20} />} color="var(--ks-monsoon)" value={`${today?.precipProbMax ?? 0}%`} />
          <Stat icon={<IconWind size={20} />} color="var(--ks-sage)" value={`${Math.round(cur.windKmh)} km/h`} />
          <Stat icon={<IconDrop size={20} />} color="var(--ks-sky)" value={`${Math.round(cur.humidity)}%`} />
        </div>
      )}
      {state?.weather && (
        <div className="px-1 text-[11.5px] text-[var(--subtle)]">
          {state.weather.source === "demo" ? t.demo : "Open-Meteo"} · {istClock(state.weather.fetchedAt)} IST{state.weather.stale ? ` · ${t.stale}` : ""}
        </div>
      )}
      <BriefingCard compact />
    </div>
  );
}

function Stat({ icon, color, value }: { icon: React.ReactNode; color: string; value: string }) {
  return (
    <div className="glass flex h-16 items-center justify-center gap-2 rounded-[20px]">
      <span style={{ color }}>{icon}</span>
      <span className="num text-[16px] font-semibold">{value}</span>
    </div>
  );
}
