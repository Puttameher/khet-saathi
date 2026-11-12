"use client";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconAlert, IconSparkle } from "@/components/shell/Icons";

export interface ToastMsg { id: number; msg: string; tone: "error" | "info" }

export function Toast({ msg, onDone }: { msg: ToastMsg | null; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(onDone, 4200);
    return () => clearTimeout(id);
  }, [msg, onDone]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[84px] z-50 flex justify-center px-4" aria-live="assertive">
      <AnimatePresence>
        {msg && (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="glass-strong pointer-events-auto flex max-w-full items-start gap-2.5 rounded-2xl px-4 py-3 text-[14.5px]"
            role="status"
            onClick={onDone}
          >
            {msg.tone === "error" ? <IconAlert size={20} style={{ color: "var(--ks-clay)", flexShrink: 0 }} /> : <IconSparkle size={20} style={{ color: "var(--ks-haldi)", flexShrink: 0 }} />}
            <span>{msg.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
