"use client";
import { motion } from "motion/react";
import { IconMic, IconStop } from "@/components/shell/Icons";
import type { WaveMode } from "@/components/baat/Waveform";

/** The one primary action on Baat: a 104px mic. Tap to talk, tap again to send. */
export function MicButton({ mode, onPress, label, disabled }: { mode: WaveMode; onPress: () => void; label: string; disabled?: boolean }) {
  const rec = mode === "recording";
  const busy = mode === "thinking";
  return (
    <div className="relative grid h-[120px] w-[120px] place-items-center">
      {rec && (
        <>
          <span aria-hidden className="pulse-ring absolute inset-2 rounded-full" style={{ background: "rgba(185,85,47,0.25)" }} />
          <span aria-hidden className="pulse-ring absolute inset-2 rounded-full" style={{ background: "rgba(185,85,47,0.18)", animationDelay: "0.6s" }} />
        </>
      )}
      {busy && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: "conic-gradient(from 0deg, transparent 0 60%, var(--ks-haldi) 85%, transparent 100%)", WebkitMask: "radial-gradient(circle, transparent 54px, #000 55px)", mask: "radial-gradient(circle, transparent 54px, #000 55px)" }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
        />
      )}
      <motion.button
        type="button"
        onClick={onPress}
        disabled={disabled}
        whileTap={{ scale: 0.92 }}
        animate={{ scale: rec ? 1.04 : 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 18 }}
        className="tap relative grid h-[104px] w-[104px] place-items-center rounded-full text-white disabled:opacity-50"
        style={{
          background: rec
            ? "radial-gradient(circle at 35% 30%, #D9774F, var(--ks-clay) 60%, #8E3C1E)"
            : "radial-gradient(circle at 35% 30%, #F2C266, var(--ks-haldi) 45%, var(--ks-haldi-deep))",
          color: rec ? "#fff" : "var(--ks-loam-900)",
          boxShadow: rec
            ? "0 18px 40px -12px rgba(185,85,47,0.75), inset 0 1px 0 rgba(255,255,255,0.35)"
            : "0 18px 40px -14px rgba(185,127,23,0.8), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
        aria-label={label}
        aria-pressed={rec}
      >
        {rec ? <IconStop size={38} /> : <IconMic size={42} strokeWidth={2} />}
      </motion.button>
    </div>
  );
}
