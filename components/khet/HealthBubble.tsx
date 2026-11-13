"use client";
/**
 * Crop Care Score orb (P1 #8). Breathing, spring-animated 0–100 score from lib/health.ts
 * (delivered in /api/state). Tap → sheet that explains every point. Always labelled as a
 * care score based on the farmer's inputs and weather — never a yield or disease claim.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useMotionValueEvent, useSpring } from "motion/react";
import type { HealthResult } from "@/lib/health";
import { health as HC } from "@/design/tokens";
import { useApp } from "@/components/shell/AppContext";
import { istDayClock } from "@/components/shell/time";
import { IconCheck, IconClock, IconClose, IconCloudRain, IconDrop, IconSparkle, IconSpray, IconSun } from "@/components/shell/Icons";
import { factorText, WEATHER_FACTORS } from "@/components/khet/healthCopy";

const ICON = {
  onTime: IconCheck, overdue: IconClock, sprayRecent: IconSpray, irrigation: IconDrop,
  dryStress: IconSun, heatStress: IconSun, waterlog: IconCloudRain, checkIn: IconSparkle,
} as const;

export function HealthBubble({ health }: { health: HealthResult }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const c = HC[health.band];
  const spring = useSpring(health.score, { stiffness: 110, damping: 15, mass: 0.9 });
  const [shown, setShown] = useState(health.score);
  const prev = useRef(health.score);
  const [bump, setBump] = useState(0);
  useMotionValueEvent(spring, "change", (v) => setShown(Math.round(v)));
  useEffect(() => {
    if (health.score !== prev.current) {
      setBump((b) => b + (health.score > prev.current ? 1 : -1));
      prev.current = health.score;
    }
    spring.set(health.score);
  }, [health.score, spring]);

  return (
    <>
      <motion.button
        type="button"
        onClick={() => { setOpen(true); try { navigator.vibrate?.(8); } catch { /* unsupported */ } }}
        className="tap absolute right-3 top-3 grid h-[78px] w-[78px] place-items-center rounded-full"
        aria-label={`${t.careTitle}: ${health.score} / 100. ${health.label}`}
        data-testid="health-orb"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.5 }}
        whileTap={{ scale: 0.9 }}
      >
        {/* glow */}
        <motion.span
          aria-hidden
          className="absolute inset-[-10px] rounded-full"
          style={{ background: `radial-gradient(circle, ${c.glow}, transparent 68%)` }}
          animate={{ opacity: [0.55, 1, 0.55], scale: [0.94, 1.06, 0.94] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* orb body breathes; re-keyed on score change for a spring pop */}
        <motion.span
          key={bump}
          aria-hidden
          className="absolute inset-[6px] rounded-full"
          style={{
            background: `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.85) 0%, ${c.core} 22%, ${c.mid} 78%, ${c.mid} 100%)`,
            boxShadow: `0 10px 30px -8px ${c.glow}, inset 0 -6px 14px rgba(0,0,0,0.18), inset 0 2px 3px rgba(255,255,255,0.5)`,
          }}
          initial={bump === 0 ? false : { scale: 1.22 }}
          animate={{ scale: [1, 1.045, 1] }}
          transition={{ scale: { duration: 4.2, repeat: Infinity, ease: "easeInOut" } }}
        />
        <span className="relative flex flex-col items-center leading-none text-white" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.25)" }}>
          <span className="num text-[26px] font-semibold tracking-tight">{shown}</span>
          <span className="mt-0.5 text-[9.5px] font-medium opacity-90">{t.careTitle}</span>
        </span>
      </motion.button>
      <HealthSheet open={open} onClose={() => setOpen(false)} health={health} />
    </>
  );
}

function HealthSheet({ open, onClose, health }: { open: boolean; onClose: () => void; health: HealthResult }) {
  const { t, lang, state } = useApp();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!mounted) return null;
  const c = HC[health.band];
  const wx = state?.weather;
  const factors = [...health.factors].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 mx-auto max-w-[480px]" role="dialog" aria-modal="true" aria-label={t.careTitle}>
          <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="glass-strong absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[30px] px-5 pb-8 pt-3 no-scrollbar"
            style={{ paddingBottom: "max(28px, env(safe-area-inset-bottom))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => { if (i.offset.y > 110 || i.velocity.y > 600) onClose(); }}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--line)]" style={{ background: "var(--subtle)", opacity: 0.4 }} />
            <div className="flex items-start gap-4">
              <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full text-white" style={{ background: `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.8), ${c.core} 24%, ${c.mid} 80%)`, boxShadow: `0 10px 26px -8px ${c.glow}` }}>
                <span className="num text-[28px] font-semibold">{health.score}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[28px] leading-none">{t.careTitle}</div>
                <p className="mt-1.5 text-[14px] leading-snug text-[var(--muted)]">{t.careLabel}</p>
                <p className="mt-0.5 text-[11.5px] text-[var(--subtle)]">{health.label}</p>
              </div>
              <button onClick={onClose} className="tap glass -mr-1 grid h-14 w-14 shrink-0 place-items-center rounded-full" aria-label={t.close}>
                <IconClose size={20} />
              </button>
            </div>

            <ul className="mt-5 flex flex-col gap-2">
              <li className="flex items-center justify-between rounded-[18px] px-4 py-3" style={{ background: "var(--card)" }}>
                <span className="text-[15px] text-[var(--muted)]">{t.careBase}</span>
                <span className="num text-[16px] font-semibold">{health.base}</span>
              </li>
              {factors.length === 0 && <li className="px-4 py-2 text-[14px] text-[var(--subtle)]">{t.careNoFactors}</li>}
              {factors.map((f, i) => {
                const Ico = ICON[f.id];
                const up = f.delta > 0;
                const col = up ? "var(--ks-leaf)" : f.delta <= -6 ? "var(--ks-clay)" : "var(--ks-amber)";
                return (
                  <motion.li
                    key={f.id}
                    className="flex items-center gap-3 rounded-[18px] px-4 py-3"
                    style={{ background: "var(--card)" }}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.08 + i * 0.05 }}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ color: col, background: up ? "var(--ks-v-go-bg)" : "var(--ks-v-wait-bg)" }}><Ico size={20} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug">{factorText(f, lang)}</span>
                      {WEATHER_FACTORS.includes(f.id) && wx && (
                        <span className="num block text-[11px] text-[var(--subtle)]">{wx.source === "demo" ? t.demo : "Open-Meteo"} · {istDayClock(wx.fetchedAt, lang)}</span>
                      )}
                    </span>
                    <span className="num rounded-full px-2.5 py-1 text-[14px] font-semibold" style={{ color: col, background: up ? "var(--ks-v-go-bg)" : "var(--ks-v-wait-bg)" }}>
                      {up ? "+" : "−"}{Math.abs(f.delta)}
                    </span>
                  </motion.li>
                );
              })}
            </ul>
            <p className="mt-4 text-[12.5px] leading-snug text-[var(--subtle)]">
              {t.careNote} <span className="opacity-80">Not a yield or disease estimate.</span>
              <br />
              <span className="num">{istDayClock(health.computedAt, lang)} IST</span>
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
