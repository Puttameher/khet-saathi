"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { TaskView, Lang } from "@/lib/client/api";
import type { TaskStatus } from "@/lib/tasks";
import type { TaskType, Reason } from "@/lib/rules";
import { addDays, istDateKey } from "@/lib/time";
import { Celebrate } from "@/components/shell/Celebrate";
import { IconArrowRight, IconCheck, IconClock, IconDots, IconDrop, IconPlay, IconSack, IconSickle, IconSpray } from "@/components/shell/Icons";
import { STATUS_LABEL, TASK_LABEL, VERDICT_LABEL, reasonText, type Copy } from "@/components/shell/i18n";
import { istClock, istDateLabel, istDayClock } from "@/components/shell/time";
import { verdictColor } from "@/components/shell/verdict";

export type TaskAction = { kind: "START" | "COMPLETE" | "POSTPONE" } | { kind: "RESCHEDULE"; date: string };

const TYPE_STYLE: Record<TaskType, { Icon: typeof IconSpray; color: string }> = {
  spray: { Icon: IconSpray, color: "var(--ks-monsoon)" },
  irrigate: { Icon: IconDrop, color: "#3E86B5" },
  fertilize: { Icon: IconSack, color: "var(--ks-haldi-deep)" },
  harvest: { Icon: IconSickle, color: "#B8862B" },
  other: { Icon: IconDots, color: "var(--ks-stone-500)" },
};
const STATUS_COLOR: Record<TaskStatus, string> = {
  planned: "var(--ks-stone-500)", go_ahead: "var(--ks-leaf)", skip_suggested: "var(--ks-clay)", in_progress: "var(--ks-monsoon)",
  done: "var(--ks-leaf)", postponed: "var(--ks-amber)", cancelled: "var(--ks-stone-500)",
};
const PRE_START: TaskStatus[] = ["planned", "go_ahead", "skip_suggested"];
const sevRank: Record<Reason["severity"], number> = { skip: 0, wait: 1, info: 2, ok: 3 };

export function TaskCard({ task, lang, t, onAction, pendingKind }: { task: TaskView; lang: Lang; t: Copy; onAction: (a: TaskAction) => void; pendingKind: string | null }) {
  const [burst, setBurst] = useState(0);
  const { Icon, color } = TYPE_STYLE[task.type];
  const d = istDateLabel(task.plannedDate, lang);
  const ev = task.evaluation;
  const done = task.status === "done";
  const showVerdict = ev && !done && task.status !== "cancelled" && task.status !== "in_progress";
  const vc = verdictColor(ev?.verdict);
  const reasons = (ev?.reasons ?? [])
    .filter((r) => r.severity !== "ok" || r.code === "CLEAR")
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
    .slice(0, 3);

  const act = (a: TaskAction) => {
    if (a.kind === "COMPLETE") setBurst((b) => b + 1);
    try { navigator.vibrate?.(a.kind === "COMPLETE" ? [10, 40, 18] : 10); } catch { /* noop */ }
    onAction(a);
  };
  const tomorrow = addDays(istDateKey(new Date()), 1);
  const suggestedDate = ev?.suggestedWindow ? istDateKey(new Date(ev.suggestedWindow.start)) : null;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: done ? 0.78 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="glass relative overflow-hidden rounded-[26px] p-4"
    >
      <div className="flex items-start gap-3.5">
        <motion.span
          className="relative grid h-14 w-14 shrink-0 place-items-center rounded-[18px]"
          style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
          animate={done ? { scale: [1, 1.18, 1] } : { scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 12 }}
        >
          {done ? <IconCheck size={28} strokeWidth={2.2} style={{ color: "var(--ks-leaf)" }} /> : <Icon size={28} />}
          {burst > 0 && <Celebrate key={burst} />}
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-[18px] font-semibold leading-tight">{TASK_LABEL[lang][task.type]}</h3>
            <span className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ color: STATUS_COLOR[task.status], background: `color-mix(in oklab, ${STATUS_COLOR[task.status]} 13%, transparent)` }}>
              {STATUS_LABEL[lang][task.status]}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[14px] text-[var(--muted)]">
            <IconClock size={15} />
            <span className="font-medium text-[var(--fg)]">{d.rel}</span>
            <span className="num">· {d.full}</span>
          </div>
          {task.notes && <p className="mt-1 line-clamp-2 text-[13.5px] text-[var(--muted)]">{task.notes}</p>}
          {done && task.completedAt && <p className="num mt-1 text-[12.5px] text-[var(--subtle)]">✓ {istDayClock(task.completedAt, lang)}</p>}
          {task.status === "in_progress" && task.startedAt && <p className="num mt-1 text-[12.5px]" style={{ color: "var(--ks-monsoon)" }}>▶ {istClock(task.startedAt)}</p>}
        </div>
      </div>

      {showVerdict && ev && (
        <div className="mt-3 rounded-[18px] p-3" style={{ background: vc.bg, boxShadow: `inset 0 0 0 1px ${vc.ring}` }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold text-white" style={{ background: vc.fg }}>
              <span className="h-2 w-2 rounded-full bg-white/90" />
              {VERDICT_LABEL[lang][ev.verdict]}
            </span>
            {reasons.map((r, i) => {
              const txt = reasonText(r, lang);
              return txt ? (
                <span key={i} className="num rounded-full px-2.5 py-1 text-[12.5px] font-medium" style={{ background: "var(--card)", color: r.severity === "skip" ? "var(--ks-clay)" : r.severity === "wait" ? "var(--ks-amber)" : "var(--muted)" }} title={r.threshold != null ? `limit ${r.threshold}${r.unit ?? ""}` : undefined}>
                  {txt}{r.threshold != null && r.unit ? <span className="opacity-60"> / {r.threshold}{r.unit === "°C" ? "°" : ""}</span> : null}
                </span>
              ) : null;
            })}
          </div>
          {(ev.window || ev.suggestedWindow) && (
            <div className="num mt-2 text-[13px]">
              {ev.window && <span>{t.window}: <b>{windowText(ev.window, lang, t.allDay)}</b></span>}
              {ev.suggestedWindow && ev.verdict !== "GO" && <span>{t.suggested}: <b>{istDayClock(ev.suggestedWindow.start, lang)}</b></span>}
            </div>
          )}
          <div className="num mt-1.5 text-[11px] text-[var(--subtle)]">
            {t.source}: {ev.dataSource === "demo" ? t.demo : ev.dataSource ?? "—"}
            {ev.dataFetchedAt ? ` · ${istClock(ev.dataFetchedAt)}` : ""} · {t.checked} {istClock(ev.evaluatedAt)} IST
          </div>
        </div>
      )}

      {!done && task.status !== "cancelled" && (
        <div className="mt-3 flex gap-2">
          {PRE_START.includes(task.status) && (
            <ActionBtn onClick={() => act({ kind: "START" })} busy={pendingKind === "START"} color="var(--ks-monsoon)" icon={<IconPlay size={18} />} label={t.start} />
          )}
          {(PRE_START.includes(task.status) || task.status === "in_progress") && (
            <ActionBtn primary onClick={() => act({ kind: "COMPLETE" })} busy={pendingKind === "COMPLETE"} color="var(--ks-leaf)" icon={<IconCheck size={20} strokeWidth={2.2} />} label={t.done} />
          )}
          {task.status !== "postponed" ? (
            <ActionBtn onClick={() => act({ kind: "POSTPONE" })} busy={pendingKind === "POSTPONE"} color="var(--ks-amber)" icon={<IconClock size={18} />} label={t.postpone} />
          ) : (
            <ActionBtn primary onClick={() => act({ kind: "RESCHEDULE", date: suggestedDate && suggestedDate >= tomorrow ? suggestedDate : tomorrow })} busy={pendingKind === "RESCHEDULE"} color="var(--ks-haldi-deep)" icon={<IconArrowRight size={18} />} label={istDateLabel(suggestedDate && suggestedDate >= tomorrow ? suggestedDate : tomorrow, lang).rel} />
          )}
        </div>
      )}
    </motion.li>
  );
}

function windowText(w: { start: number; end: number }, lang: Lang, allDay: string): string {
  if (w.end - w.start >= 20 * 3_600_000) return `${istDateLabel(istDateKey(new Date(w.start)), lang).rel} · ${allDay}`;
  return `${istClock(w.start)}–${istClock(w.end)}`;
}

function ActionBtn({ onClick, busy, color, icon, label, primary }: { onClick: () => void; busy: boolean; color: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={busy}
      className={`tap flex h-14 items-center justify-center gap-2 rounded-[18px] px-3 text-[15px] font-semibold ${primary ? "flex-[1.4]" : "flex-1"}`}
      style={primary ? { background: color, color: "#fff", boxShadow: `0 10px 22px -12px ${color}` } : { background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.span key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <motion.span key="i" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>{icon}</motion.span>
        )}
      </AnimatePresence>
      {label}
    </motion.button>
  );
}
