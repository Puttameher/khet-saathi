"use client";
import { motion } from "motion/react";
import { useApp } from "@/components/shell/AppContext";
import type { Tab } from "@/components/shell/AppContext";
import { IconField, IconTalk, IconTasks } from "@/components/shell/Icons";

const TABS: { id: Tab; Icon: typeof IconField; color: string }[] = [
  { id: "khet", Icon: IconField, color: "var(--ks-leaf)" },
  { id: "kaam", Icon: IconTasks, color: "var(--ks-haldi-deep)" },
  { id: "baat", Icon: IconTalk, color: "var(--ks-clay)" },
];

export function TabBar() {
  const { tab, setTab, t, state } = useApp();
  const attention = state?.tasks.filter((x) => x.status === "skip_suggested" || x.evaluation?.verdict === "SKIP_TODAY" || x.evaluation?.verdict === "WAIT").length ?? 0;
  return (
    <nav className="relative z-20 px-3 pt-2" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }} aria-label="Tabs">
      <div className="glass-strong flex items-stretch gap-1 rounded-[28px] p-1.5" role="tablist">
        {TABS.map(({ id, Icon, color }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className="tap relative flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px]"
              style={{ color: active ? color : "var(--subtle)" }}
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-[22px]"
                  style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 22%, transparent)` }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <motion.span className="relative" animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                <Icon size={26} strokeWidth={active ? 2 : 1.75} />
                {id === "kaam" && attention > 0 && (
                  <span className="num absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] font-semibold text-white" style={{ background: "var(--ks-clay)" }}>
                    {attention}
                  </span>
                )}
              </motion.span>
              <span className="relative text-[13px] font-medium leading-none">{t.tabs[id]}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
