"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage } from "@/lib/client/api";
import { useApp } from "@/components/shell/AppContext";
import { IconAlert, IconCheck, IconPause, IconSpeaker } from "@/components/shell/Icons";
import { verdictColor } from "@/components/shell/verdict";

/** Pending weather-change alerts from the monitor. Speak or acknowledge; ack hides it server-side. */
export function AlertBanner() {
  const { state, setState, t, lang, say, speaker, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const alerts = state?.alerts ?? [];
  const top = alerts[0];
  const key = top ? `alert-${top.id}` : "";
  const playing = speaker.currentKey === key && speaker.state !== "idle";

  const ack = async () => {
    if (!top) return;
    setBusy(true);
    try {
      const r = await api.ackAlerts(alerts.map((a) => a.id));
      setState(r.state);
    } catch (e) {
      toast(errorMessage(e, lang));
    } finally {
      setBusy(false);
    }
  };

  const c = verdictColor(top?.verdict ?? "WAIT");
  return (
    <AnimatePresence initial={false}>
      {top && (
        <motion.div
          key="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          className="relative z-10 overflow-hidden px-4"
        >
          <div className="glass mb-2 flex items-center gap-3 rounded-[22px] p-2.5 pl-3.5" style={{ boxShadow: `inset 3px 0 0 ${c.fg}, var(--glass-shadow)` }} role="alert">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: c.bg, color: c.fg }}>
              <IconAlert size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold" style={{ color: c.fg }}>
                {t.alertTitle}{alerts.length > 1 ? ` · ${alerts.length}` : ""}
              </div>
              <div className="line-clamp-2 text-[14px] leading-snug">{top.message}</div>
            </div>
            <button
              className="tap grid h-14 w-14 shrink-0 place-items-center rounded-full"
              style={{ background: c.bg, color: c.fg }}
              aria-label={t.listen}
              onClick={() => (playing ? speaker.stop() : void say(top.message, key))}
            >
              {playing ? <IconPause size={20} /> : <IconSpeaker size={22} />}
            </button>
            <button className="tap grid h-14 w-14 shrink-0 place-items-center rounded-full hairline border" aria-label={t.dismiss} disabled={busy} onClick={ack}>
              <IconCheck size={22} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
