"use client";
import { motion } from "motion/react";
import { useApp } from "@/components/shell/AppContext";
import { IconPause, IconPlay, IconSparkle } from "@/components/shell/Icons";
import { istClock } from "@/components/shell/time";

/** The daily check-in: fetched on app open, offered for playback (never autoplayed). */
export function BriefingCard({ compact = false }: { compact?: boolean }) {
  const { briefing, t, say, speaker } = useApp();
  const key = "briefing";
  const active = speaker.currentKey === key && speaker.state !== "idle";
  if (briefing.status === "error") return null;
  const loading = briefing.status === "loading";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="glass relative overflow-hidden rounded-[26px] p-4"
    >
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-60 blur-2xl" style={{ background: "radial-gradient(circle, rgba(227,169,59,0.45), transparent 70%)" }} />
      <div className="relative flex items-center gap-3.5">
        <button
          disabled={loading || !briefing.text}
          onClick={() => (active ? speaker.stop() : briefing.text && void say(briefing.text, key))}
          className="tap relative grid h-16 w-16 shrink-0 place-items-center rounded-full text-[var(--ks-loam-900)] disabled:opacity-60"
          style={{ background: "linear-gradient(145deg, var(--ks-haldi), var(--ks-haldi-deep))", boxShadow: "0 10px 26px -10px rgba(185,127,23,0.8), inset 0 1px 0 rgba(255,255,255,0.4)" }}
          aria-label={t.briefingPlay}
        >
          {active && speaker.state === "playing" && <span aria-hidden className="pulse-ring absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px var(--ks-haldi)" }} />}
          {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : active ? <IconPause size={24} /> : <IconPlay size={24} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--ks-haldi-deep)" }}>
            <IconSparkle size={14} /> {t.briefingTitle}
            {briefing.weatherAsOf && <span className="num font-normal text-[var(--subtle)]">· {istClock(briefing.weatherAsOf)}</span>}
          </div>
          <p className={`mt-1 text-[15px] leading-snug ${compact ? "line-clamp-2" : "line-clamp-4"} ${loading ? "shine rounded text-transparent" : ""}`}>
            {loading ? t.briefingLoading : briefing.text}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
