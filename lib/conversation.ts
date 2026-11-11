/**
 * The logic between speech-in and speech-out. One farmer utterance → intent →
 * deterministic action on tasks/rules → one short spoken reply.
 */
import { RULES, type Lang } from "@/lib/config";
import { evaluateTask, type Evaluation, type TaskType } from "@/lib/rules";
import { transition, isActive, type TaskEvent } from "@/lib/tasks";
import { parseIntent, answerGrounded } from "@/lib/nlu";
import type { Intent } from "@/lib/nlu-rules";
import { onboardingTurn, isOnboarded } from "@/lib/onboarding";
import { weatherForFarmer } from "@/lib/monitor";
import {
  ackAlerts, ackAlertsForTask, addMessage, addTimeline, createTask, getProfile, getSetting, listTasks,
  markAlertsSpoken, pendingAlerts, saveTask, setSetting, type TaskRow,
} from "@/lib/repo";
import { PHRASES, TASK_NAME, verdictSentence, weatherDaySentence } from "@/lib/speech";
import { addDays, formatIstTime, istDateKey, relativeLabel, resolveRelativeDate } from "@/lib/time";
import type { Forecast } from "@/lib/weather";

export type TurnAction =
  | { kind: "task_created" | "task_rescheduled" | "task_started" | "task_done" | "task_cancelled" | "task_postponed" | "task_kept"; taskId: string; taskType: TaskType }
  | { kind: "irrigation_logged" }
  | { kind: "profile_confirmed" }
  | { kind: "answer"; evaluation?: Evaluation };

export interface TurnResult {
  reply: string;
  lang: Lang;
  intent: Pick<Intent, "kind" | "taskType" | "source" | "confidence"> | null;
  actions: TurnAction[];
  celebrate: boolean;
  onboarding: { step: string; done: boolean } | null;
}

const focusKey = "focusTaskId";

function pickTask(tasks: TaskRow[], type: TaskType | null | undefined): TaskRow | null {
  const focusId = getSetting<string>(focusKey);
  const active = tasks.filter((t) => isActive(t.status));
  if (type) {
    const ofType = active.filter((t) => t.type === type);
    return ofType.find((t) => t.id === focusId) ?? ofType.find((t) => t.status === "in_progress") ?? ofType[0] ?? null;
  }
  return active.find((t) => t.id === focusId) ?? (active.length === 1 ? active[0]! : null);
}

function evalFor(t: { type: TaskType; plannedDate: string; partOfDay?: TaskRow["partOfDay"] }, fc: Forecast | null, now: Date): Evaluation {
  return evaluateTask(t, fc?.hourly ?? null, RULES, now, { source: fc ? (fc.source === "demo" ? "demo" : "open-meteo") : null, fetchedAt: fc?.fetchedAt ?? null });
}

export async function handleTurn(text: string, opts: { lang?: Lang; mode?: "talk" | "checkin"; now?: Date } = {}): Promise<TurnResult> {
  const now = opts.now ?? new Date();
  const profile = getProfile();
  const lang: Lang = opts.lang ?? profile.language;
  const P = PHRASES[lang];
  const clean = text.trim().slice(0, 600);
  addMessage("farmer", clean, null, now);

  if (!isOnboarded()) {
    const r = await onboardingTurn(clean, lang, now);
    addMessage("saathi", r.reply, { onboarding: r.step }, now);
    return { reply: r.reply, lang, intent: null, actions: r.done ? [{ kind: "profile_confirmed" }] : [], celebrate: r.done, onboarding: { step: r.step, done: r.done } };
  }

  const tasks = listTasks();
  const activeTypes = [...new Set(tasks.filter((t) => isActive(t.status)).map((t) => t.type))];
  const focusId = getSetting<string>(focusKey);
  const focus = tasks.find((t) => t.id === focusId && isActive(t.status)) ?? null;
  const intent = await parseIntent(clean, { activeTypes, focusType: focus?.type ?? null, mode: opts.mode ?? "talk" }, now);
  const actions: TurnAction[] = [];
  let celebrate = false;
  let reply: string = P.didntUnderstand;
  const dateOf = (phrase: string | null | undefined) => (phrase ? resolveRelativeDate(phrase, now) : null) ?? resolveRelativeDate(clean, now);

  const apply = (t: TaskRow, ev: TaskEvent): TaskRow | null => {
    const r = transition(t, ev, now);
    if (!r.ok) return null;
    saveTask(r.task, ev.type === "RESCHEDULE" ? { lastVerdict: null, lastEvaluation: null } : {}, now);
    return { ...t, ...r.task };
  };

  switch (intent.kind) {
    case "create_task": {
      const type = intent.taskType ?? null;
      if (!type) break;
      const d = dateOf(intent.datePhrase);
      if (!d) {
        reply = P.needDate(TASK_NAME[lang][type]);
        setSetting("pendingCreate", { type, notes: intent.notes ?? null });
        break;
      }
      const dup = tasks.find((t) => isActive(t.status) && t.type === type && t.plannedDate === d.dateKey);
      const task = dup ?? createTask({ type, plannedDate: d.dateKey, partOfDay: d.partOfDay ?? null, notes: intent.notes ?? null }, now);
      const wx = await weatherForFarmer({ now });
      const ev = evalFor(task, wx.forecast, now);
      if (wx.forecast) {
        const r = transition(task, { type: "VERDICT", verdict: ev.verdict }, now);
        saveTask(r.ok ? r.task : task, { lastVerdict: ev.verdict, lastEvaluation: ev }, now);
      }
      setSetting(focusKey, task.id);
      reply = `${P.created(TASK_NAME[lang][type], relativeLabel(d.dateKey, now, lang))} ${wx.forecast ? verdictSentence(type, d.dateKey, ev, now, lang) : P.noWeather}`;
      actions.push({ kind: "task_created", taskId: task.id, taskType: type });
      break;
    }
    case "reschedule_task": {
      const t = pickTask(tasks, intent.taskType);
      const d = dateOf(intent.datePhrase);
      if (!t) { reply = P.noSuchTask(TASK_NAME[lang][intent.taskType ?? "other"]); break; }
      if (!d) { reply = P.needDate(TASK_NAME[lang][t.type]); setSetting(focusKey, t.id); break; }
      const nt = apply(t, { type: "RESCHEDULE", date: d.dateKey, partOfDay: d.partOfDay ?? t.partOfDay });
      if (!nt) break;
      ackAlertsForTask(t.id, now);
      const wx = await weatherForFarmer({ now });
      const ev = evalFor(nt, wx.forecast, now);
      if (wx.forecast) {
        const r = transition(nt, { type: "VERDICT", verdict: ev.verdict }, now);
        saveTask(r.ok ? r.task : nt, { lastVerdict: ev.verdict, lastEvaluation: ev }, now);
      }
      reply = `${P.rescheduled(TASK_NAME[lang][t.type], relativeLabel(d.dateKey, now, lang))} ${wx.forecast ? verdictSentence(t.type, d.dateKey, ev, now, lang) : ""}`.trim();
      actions.push({ kind: "task_rescheduled", taskId: t.id, taskType: t.type });
      break;
    }
    case "complete_task": {
      const t = pickTask(tasks, intent.taskType);
      if (!t) { reply = P.noSuchTask(TASK_NAME[lang][intent.taskType ?? "other"]); break; }
      const nt = apply(t, { type: "COMPLETE" });
      if (!nt) break;
      ackAlertsForTask(t.id, now);
      addTimeline("task_done", { type: t.type, plannedDate: t.plannedDate }, t.id, now);
      if (t.type === "irrigate") addTimeline("irrigation", {}, t.id, now);
      reply = P.done(TASK_NAME[lang][t.type]);
      celebrate = true;
      actions.push({ kind: "task_done", taskId: t.id, taskType: t.type });
      break;
    }
    case "start_task": {
      const t = pickTask(tasks, intent.taskType);
      if (!t) { reply = P.noSuchTask(TASK_NAME[lang][intent.taskType ?? "other"]); break; }
      const nt = apply(t, { type: "START" });
      if (!nt) break;
      setSetting(focusKey, t.id);
      reply = P.started(TASK_NAME[lang][t.type]);
      actions.push({ kind: "task_started", taskId: t.id, taskType: t.type });
      break;
    }
    case "cancel_task": {
      const t = pickTask(tasks, intent.taskType);
      if (!t) { reply = P.noSuchTask(TASK_NAME[lang][intent.taskType ?? "other"]); break; }
      if (!apply(t, { type: "CANCEL" })) break;
      ackAlertsForTask(t.id, now);
      reply = P.cancelled(TASK_NAME[lang][t.type]);
      actions.push({ kind: "task_cancelled", taskId: t.id, taskType: t.type });
      break;
    }
    case "postpone_task": {
      const t = pickTask(tasks, intent.taskType);
      if (!t) { reply = P.noSuchTask(TASK_NAME[lang][intent.taskType ?? "other"]); break; }
      if (!apply(t, { type: "POSTPONE" })) break;
      setSetting(focusKey, t.id);
      reply = P.postponed(TASK_NAME[lang][t.type]);
      actions.push({ kind: "task_postponed", taskId: t.id, taskType: t.type });
      break;
    }
    case "keep": {
      const pending = getSetting<{ type: TaskType } | null>("pendingCreate");
      const t = focus ?? pickTask(tasks, null);
      if (t) {
        ackAlertsForTask(t.id, now);
        actions.push({ kind: "task_kept", taskId: t.id, taskType: t.type });
      } else if (!pending) {
        ackAlerts(pendingAlerts().map((a) => a.id), now);
      }
      reply = P.kept;
      break;
    }
    case "deny":
      reply = P.askReply;
      break;
    case "log_irrigation":
      addTimeline("irrigation", {}, null, now);
      reply = P.irrigationLogged;
      celebrate = true;
      actions.push({ kind: "irrigation_logged" });
      break;
    case "ask": {
      const r = await answerQuestion(clean, intent, lang, now);
      reply = r.text;
      actions.push({ kind: "answer", evaluation: r.evaluation });
      break;
    }
    default: {
      // A bare date after "kab karna hai?" completes a pending create
      const pending = getSetting<{ type: TaskType; notes: string | null } | null>("pendingCreate");
      const d = resolveRelativeDate(clean, now);
      if (pending && d) {
        setSetting("pendingCreate", null);
        return handleTurn(`${pending.type} ${d.matched || clean} karna hai`, { ...opts, now });
      }
    }
  }
  if (intent.kind !== "create_task") setSetting("pendingCreate", null);
  addMessage("saathi", reply, { intent: intent.kind, source: intent.source }, now);
  return { reply, lang, intent: { kind: intent.kind, taskType: intent.taskType, source: intent.source, confidence: intent.confidence }, actions, celebrate, onboarding: null };
}

/** Questions are answered from the rules engine first; the LLM only phrases grounded facts. */
async function answerQuestion(text: string, intent: Intent, lang: Lang, now: Date): Promise<{ text: string; evaluation?: Evaluation }> {
  const P = PHRASES[lang];
  const wx = await weatherForFarmer({ now });
  const fc = wx.forecast;
  const d = (intent.datePhrase ? resolveRelativeDate(intent.datePhrase, now) : null) ?? resolveRelativeDate(text, now);
  const day = d?.dateKey ?? istDateKey(now);
  if (!fc) return { text: P.noWeather };
  if (intent.askTopic === "can_do_task" || intent.askTopic === "should_irrigate") {
    const type: TaskType = intent.askTopic === "should_irrigate" ? "irrigate" : intent.taskType ?? "spray";
    const ev = evalFor({ type, plannedDate: day, partOfDay: d?.partOfDay ?? null }, fc, now);
    return { text: verdictSentence(type, day, ev, now, lang), evaluation: ev };
  }
  if (intent.askTopic === "weather") {
    const parts = [weatherDaySentence(fc, day, now, lang), d ? null : weatherDaySentence(fc, addDays(day, 1), now, lang)].filter(Boolean);
    return { text: parts.join(" ") || P.noWeather };
  }
  // open question → grounded LLM answer with refusal
  const profile = getProfile();
  const tasks = listTasks().filter((t) => isActive(t.status)).map((t) => ({ type: t.type, plannedDate: t.plannedDate, status: t.status, verdict: t.lastVerdict }));
  const facts = {
    today: istDateKey(now),
    crop: profile.crop,
    sowingDate: profile.sowingDate,
    irrigation: profile.irrigation,
    tasks,
    forecastDays: fc.daily.filter((x) => x.date >= istDateKey(now)).map((x) => ({ date: x.date, tMax: x.tMax, tMin: x.tMin, rainMm: x.precipSum, rainProbMax: x.precipProbMax })),
    sprayVerdictToday: evalFor({ type: "spray", plannedDate: istDateKey(now) }, fc, now).verdict,
    weatherSource: fc.source,
  };
  const a = await answerGrounded(text, facts, lang);
  if (!a) return { text: P.noAnswer };
  return { text: a.grounded ? a.answer : P.noAnswer };
}

export interface Briefing { text: string; alertIds: string[]; focusTaskId: string | null; weatherAsOf: string | null; stale: boolean; source: string | null }

/** Daily check-in briefing (target ≤ 20 s of speech): weather today/tomorrow + each task's verdict + changes. */
export async function buildBriefing(now = new Date()): Promise<Briefing> {
  const profile = getProfile();
  const lang = profile.language;
  const P = PHRASES[lang];
  const wx = await weatherForFarmer({ now });
  const fc = wx.forecast;
  const parts: string[] = [P.greet];
  const today = istDateKey(now);
  if (!fc) parts.push(P.noWeather);
  else {
    if (wx.stale) parts.push(P.staleWeather(formatIstTime(new Date(fc.fetchedAt))));
    const w = weatherDaySentence(fc, today, now, lang);
    if (w) parts.push(w);
    const w2 = weatherDaySentence(fc, addDays(today, 1), now, lang);
    if (w2) parts.push(w2);
  }
  const alerts = pendingAlerts();
  const active = listTasks(["planned", "go_ahead", "skip_suggested", "in_progress", "postponed"]).filter((t) => t.plannedDate >= addDays(today, -3)).slice(0, 3);
  if (alerts.length) parts.push(P.changed);
  let focus: string | null = null;
  for (const t of active) {
    if (t.status === "in_progress") { parts.push(P.started(TASK_NAME[lang][t.type])); continue; }
    if (t.status === "postponed") continue;
    const ev = evalFor(t, fc, now);
    parts.push(verdictSentence(t.type, t.plannedDate, ev, now, lang));
    if (!focus || ev.verdict !== "GO") focus = t.id;
  }
  if (!active.length) parts.push(P.noTasks);
  else parts.push(P.askReply);
  if (focus) setSetting(focusKey, focus);
  setSetting("lastCheckIn", now.toISOString());
  addTimeline("checkin", {}, null, now);
  markAlertsSpoken(alerts.map((a) => a.id), now);
  const text = parts.join(" ");
  addMessage("saathi", text, { briefing: true }, now);
  return { text, alertIds: alerts.map((a) => a.id), focusTaskId: focus, weatherAsOf: fc?.fetchedAt ?? null, stale: wx.stale, source: fc?.source ?? null };
}
