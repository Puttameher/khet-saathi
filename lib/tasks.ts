/**
 * Task state machine (pure).
 *
 *   planned ──verdict GO──▶ go_ahead ◀──verdict GO── skip_suggested
 *      │  ╲──verdict WAIT/SKIP──▶ skip_suggested ◀──WAIT/SKIP── go_ahead
 *      │
 *   planned | go_ahead | skip_suggested ──START──▶ in_progress ──COMPLETE──▶ done
 *   (COMPLETE is also allowed directly from the three pre-start states: "spray ho gaya")
 *   any active ──POSTPONE──▶ postponed       any active ──CANCEL──▶ cancelled
 *   any active | postponed ──RESCHEDULE(date)──▶ planned (re-evaluated by the monitor)
 *   done, cancelled are terminal.
 */
import { z } from "zod";
import type { TaskType, Verdict } from "@/lib/rules";
import type { DateKey, PartOfDay } from "@/lib/time";

export const TaskStatus = z.enum(["planned", "go_ahead", "skip_suggested", "in_progress", "done", "postponed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TaskTypeSchema = z.enum(["spray", "irrigate", "fertilize", "harvest", "other"]);

export const ACTIVE: TaskStatus[] = ["planned", "go_ahead", "skip_suggested", "in_progress", "postponed"];
export const TERMINAL: TaskStatus[] = ["done", "cancelled"];

export interface HistoryEntry {
  at: string;
  from: TaskStatus;
  to: TaskStatus;
  event: TaskEvent["type"];
  detail?: string;
}

export interface Task {
  id: string;
  type: TaskType;
  plannedDate: DateKey;
  partOfDay: PartOfDay | null;
  notes: string | null;
  status: TaskStatus;
  history: HistoryEntry[];
  startedAt: string | null;
  completedAt: string | null;
}

export type TaskEvent =
  | { type: "VERDICT"; verdict: Verdict }
  | { type: "START" }
  | { type: "COMPLETE" }
  | { type: "POSTPONE" }
  | { type: "RESCHEDULE"; date: DateKey; partOfDay?: PartOfDay | null }
  | { type: "CANCEL" }
  | { type: "KEEP" };

export type TransitionResult =
  | { ok: true; task: Task; changed: boolean }
  | { ok: false; task: Task; error: "TERMINAL" | "INVALID_TRANSITION" };

const PRE_START: TaskStatus[] = ["planned", "go_ahead", "skip_suggested"];

function nextStatus(status: TaskStatus, ev: TaskEvent): TaskStatus | null | "noop" {
  switch (ev.type) {
    case "VERDICT":
      if (!PRE_START.includes(status)) return "noop"; // verdicts don't move started/finished/postponed tasks
      if (ev.verdict === "GO") return "go_ahead";
      if (ev.verdict === "WAIT" || ev.verdict === "SKIP_TODAY") return "skip_suggested";
      return "planned"; // UNKNOWN: back to neutral, never claim go/skip without data
    case "START":
      return PRE_START.includes(status) ? "in_progress" : null;
    case "COMPLETE":
      return PRE_START.includes(status) || status === "in_progress" ? "done" : null;
    case "POSTPONE":
      return status === "postponed" ? "noop" : ACTIVE.includes(status) ? "postponed" : null;
    case "RESCHEDULE":
      return ACTIVE.includes(status) ? "planned" : null;
    case "CANCEL":
      return ACTIVE.includes(status) ? "cancelled" : null;
    case "KEEP":
      return ACTIVE.includes(status) ? "noop" : null;
  }
}

export function canTransition(status: TaskStatus, ev: TaskEvent): boolean {
  if (TERMINAL.includes(status)) return false;
  return nextStatus(status, ev) !== null;
}

export function transition(task: Task, ev: TaskEvent, now: Date): TransitionResult {
  if (TERMINAL.includes(task.status)) return { ok: false, task, error: "TERMINAL" };
  const nx = nextStatus(task.status, ev);
  if (nx === null) return { ok: false, task, error: "INVALID_TRANSITION" };
  const at = now.toISOString();
  if (nx === "noop" || (nx === task.status && ev.type !== "RESCHEDULE")) return { ok: true, task, changed: false };
  const t: Task = { ...task, history: [...task.history] };
  let detail: string | undefined;
  if (ev.type === "RESCHEDULE") {
    detail = `${task.plannedDate}→${ev.date}`;
    t.plannedDate = ev.date;
    if (ev.partOfDay !== undefined) t.partOfDay = ev.partOfDay;
    t.startedAt = null;
  }
  if (ev.type === "VERDICT") detail = ev.verdict;
  if (nx === "in_progress") t.startedAt = at;
  if (nx === "done") t.completedAt = at;
  t.history.push({ at, from: task.status, to: nx, event: ev.type, detail });
  t.status = nx;
  return { ok: true, task: t, changed: true };
}

export function isActive(s: TaskStatus) {
  return ACTIVE.includes(s);
}
