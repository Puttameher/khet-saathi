/**
 * The "it watches for me" job. Idempotent per run key; deterministic verdicts.
 */
import { getForecast, type WeatherResult } from "@/lib/weather";
import { evaluateTask, evaluationSignature, type Evaluation } from "@/lib/rules";
import { RULES, type Lang } from "@/lib/config";
import { transition } from "@/lib/tasks";
import { applyDemo, demoEnabled, type DemoScenario } from "@/lib/demo";
import { createAlertOnce, getProfile, getSetting, listTasks, saveTask } from "@/lib/repo";
import { verdictSentence } from "@/lib/speech";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { log } from "@/lib/log";

export async function weatherForFarmer(opts: { force?: boolean; now?: Date } = {}): Promise<WeatherResult & { demo: DemoScenario }> {
  const p = getProfile();
  const now = opts.now ?? new Date();
  if (p.lat === null || p.lon === null) return { forecast: null, stale: false, error: "NO_LOCATION", demo: "off" };
  const res = await getForecast(p.lat, p.lon, opts);
  const scenario = demoEnabled() ? (getSetting<DemoScenario>("demoScenario") ?? "off") : "off";
  if (res.forecast && scenario !== "off") return { ...res, forecast: applyDemo(res.forecast, scenario, now), demo: scenario };
  return { ...res, demo: "off" };
}

export interface MonitorSummary { evaluated: number; alertsCreated: number; weatherOk: boolean; stale: boolean; skipped?: string }

/** Evaluate all pre-start tasks; apply verdict transitions; alert on GO→WAIT/SKIP changes (deduped). */
export async function runMonitor(opts: { now?: Date; force?: boolean } = {}): Promise<MonitorSummary> {
  const now = opts.now ?? new Date();
  const wx = await weatherForFarmer({ now, force: opts.force });
  const fc = wx.forecast;
  const lang: Lang = getProfile().language;
  const tasks = listTasks(["planned", "go_ahead", "skip_suggested"]);
  let alertsCreated = 0;
  for (const t of tasks) {
    const ev: Evaluation = evaluateTask(t, fc?.hourly ?? null, RULES, now, { source: fc ? (fc.source === "demo" ? "demo" : "open-meteo") : null, fetchedAt: fc?.fetchedAt ?? null });
    // Without a forecast we keep the previous verdict instead of flipping to UNKNOWN on a network blip.
    if (!fc) continue;
    const prev = t.lastVerdict;
    const tr = transition(t, { type: "VERDICT", verdict: ev.verdict }, now);
    const next = tr.ok ? tr.task : t;
    saveTask(next, { lastVerdict: ev.verdict, lastEvaluation: ev }, now);
    const worsened = (ev.verdict === "WAIT" || ev.verdict === "SKIP_TODAY") && prev !== ev.verdict;
    if (worsened) {
      const created = createAlertOnce({
        taskId: t.id,
        kind: "verdict_change",
        verdict: ev.verdict,
        message: verdictSentence(t.type, t.plannedDate, ev, now, lang),
        dedupeKey: `${t.id}:${evaluationSignature(ev)}`,
        evaluation: ev,
      }, now);
      if (created) alertsCreated++;
    }
  }
  const summary = { evaluated: fc ? tasks.length : 0, alertsCreated, weatherOk: !!fc, stale: wx.stale };
  log.info("monitor.run", summary);
  return summary;
}

/** Idempotent wrapper used by the scheduler: one run per (IST date, slot). */
export async function runMonitorSlot(runKey: string, now = new Date()): Promise<MonitorSummary> {
  const db = getDb();
  const ins = db.insert(schema.schedulerRuns).values({ runKey, startedAt: now.toISOString(), status: "running" }).onConflictDoNothing().run();
  if (ins.changes === 0) return { evaluated: 0, alertsCreated: 0, weatherOk: true, stale: false, skipped: "already_ran" };
  try {
    const s = await runMonitor({ now, force: true });
    db.update(schema.schedulerRuns).set({ finishedAt: new Date().toISOString(), status: "ok", summary: JSON.stringify(s) }).where(eq(schema.schedulerRuns.runKey, runKey)).run();
    return s;
  } catch (e) {
    db.update(schema.schedulerRuns).set({ finishedAt: new Date().toISOString(), status: "error", summary: (e as Error).message.slice(0, 200) }).where(eq(schema.schedulerRuns.runKey, runKey)).run();
    throw e;
  }
}
