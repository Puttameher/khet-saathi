"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage } from "@/lib/client/api";
import type { TaskView } from "@/lib/client/api";
import { useApp } from "@/components/shell/AppContext";
import { IconMic, IconRefresh, IconTasks } from "@/components/shell/Icons";
import { istClock } from "@/components/shell/time";
import { TaskCard, type TaskAction } from "@/components/kaam/TaskCard";

const OPTIMISTIC: Record<TaskAction["kind"], TaskView["status"]> = { START: "in_progress", COMPLETE: "done", POSTPONE: "postponed", RESCHEDULE: "planned" };

export function KaamTab() {
  const { state, setState, lang, t, toast, setTab } = useApp();
  const [pending, setPending] = useState<Record<string, string>>({});
  const [optimistic, setOptimistic] = useState<Record<string, Partial<TaskView>>>({});
  const [refreshing, setRefreshing] = useState(false);
  // just-completed cards stay in place briefly so the celebration plays where the farmer tapped
  const [lingering, setLingering] = useState<Set<string>>(new Set());

  const tasks = (state?.tasks ?? []).map((x) => ({ ...x, ...optimistic[x.id] }));
  const active = tasks.filter((x) => (x.status !== "done" && x.status !== "cancelled") || lingering.has(x.id)).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const finished = tasks.filter((x) => x.status === "done" && !lingering.has(x.id)).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const onAction = async (task: TaskView, a: TaskAction) => {
    setPending((p) => ({ ...p, [task.id]: a.kind }));
    if (a.kind === "COMPLETE") {
      setLingering((l) => new Set(l).add(task.id));
      setTimeout(() => setLingering((l) => { const n = new Set(l); n.delete(task.id); return n; }), 1600);
    }
    setOptimistic((o) => ({ ...o, [task.id]: { status: OPTIMISTIC[a.kind], ...(a.kind === "COMPLETE" ? { completedAt: new Date().toISOString() } : {}), ...(a.kind === "RESCHEDULE" ? { plannedDate: a.date } : {}) } }));
    try {
      const r = a.kind === "RESCHEDULE" ? await api.reschedule(task.id, a.date) : await api.taskEvent(task.id, a.kind);
      setState(r.state);
    } catch (e) {
      toast(errorMessage(e, lang));
    } finally {
      setOptimistic((o) => { const n = { ...o }; delete n[task.id]; return n; });
      setPending((p) => { const n = { ...p }; delete n[task.id]; return n; });
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try { setState((await api.monitor()).state); } catch (e) { toast(errorMessage(e, lang)); } finally { setRefreshing(false); }
  };

  return (
    <div id="panel-kaam" className="no-scrollbar flex flex-1 flex-col overflow-y-auto px-4 pb-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="eyebrow">{t.active}</div>
          <div className="font-display text-[30px] leading-none">{active.length}</div>
        </div>
        <button onClick={refresh} disabled={refreshing} className="tap glass flex h-14 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium" aria-label={t.refresh}>
          <motion.span animate={refreshing ? { rotate: 360 } : { rotate: 0 }} transition={refreshing ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0.2 }} style={{ color: "var(--ks-monsoon)" }}>
            <IconRefresh size={20} />
          </motion.span>
          <span className="num text-[var(--muted)]">{state?.weather ? istClock(state.weather.fetchedAt) : "—"}</span>
        </button>
      </div>

      {state && active.length === 0 && finished.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass mt-4 flex flex-col items-center gap-3 rounded-[28px] p-8 text-center">
          <span className="floaty grid h-20 w-20 place-items-center rounded-full" style={{ background: "color-mix(in oklab, var(--ks-haldi) 18%, transparent)", color: "var(--ks-haldi-deep)" }}>
            <IconTasks size={36} />
          </span>
          <div className="font-display text-[24px]">{t.noTasks}</div>
          <p className="text-[14px] text-[var(--muted)]">{t.noTasksHint}</p>
          <button onClick={() => setTab("baat")} className="tap mt-1 flex h-14 items-center gap-2 rounded-full px-6 text-[15px] font-semibold text-white" style={{ background: "var(--ks-clay)" }}>
            <IconMic size={20} /> {t.goSpeak}
          </button>
        </motion.div>
      )}

      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {active.map((x) => (
            <TaskCard key={x.id} task={x} lang={lang} t={t} pendingKind={pending[x.id] ?? null} onAction={(a) => void onAction(x, a)} />
          ))}
        </AnimatePresence>
      </ul>
      {finished.length > 0 && (
        <>
          <div className="eyebrow mb-2 mt-6">{t.recent}</div>
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {finished.map((x) => (
                <TaskCard key={x.id} task={x} lang={lang} t={t} pendingKind={null} onAction={() => {}} />
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}
    </div>
  );
}
