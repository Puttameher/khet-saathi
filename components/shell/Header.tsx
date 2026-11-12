"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/shell/AppContext";
import { IconMoon, IconSun } from "@/components/shell/Icons";

export function Header() {
  const { state, t } = useApp();
  const [night, setNight] = useState(false);
  useEffect(() => {
    const read = () => setNight(document.documentElement.dataset.theme === "night");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const toggle = () => {
    localStorage.setItem("ks-theme", night ? "day" : "night");
    window.dispatchEvent(new Event("ks-theme"));
  };
  const cur = state?.weather?.current;
  const demo = state?.weather?.demoScenario;
  return (
    <header className="relative z-20 flex items-center justify-between gap-3 px-5 pb-2" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
      <div className="min-w-0">
        <div className="font-display text-[28px] leading-none tracking-tight">
          Khet <span className="italic" style={{ color: "var(--ks-haldi-deep)" }}>Saathi</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
          {state?.crop ? <span className="truncate">{state.crop.name} · {state.crop.stageLabel}</span> : <span className="truncate">{state?.profile.placeLabel ?? "\u00a0"}</span>}
          {demo && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: "var(--ks-clay)" }}>{t.demo}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {cur && (
          <div className="glass num flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium" aria-label={`${Math.round(cur.tempC)}°C`}>
            {cur.isDay ? <IconSun size={18} style={{ color: "var(--ks-haldi)" }} /> : <IconMoon size={18} style={{ color: "var(--ks-sky)" }} />}
            {Math.round(cur.tempC)}°
          </div>
        )}
        <button onClick={toggle} className="tap glass grid h-14 w-14 place-items-center rounded-full" aria-label={night ? "Day mode" : "Night mode"}>
          {night ? <IconSun size={22} style={{ color: "var(--ks-haldi)" }} /> : <IconMoon size={22} style={{ color: "var(--ks-monsoon)" }} />}
        </button>
      </div>
    </header>
  );
}
