/**
 * Deterministic field-work advisory engine. NO LLM. Pure functions over an
 * hourly forecast + the thresholds in config/spray-rules.json.
 *
 * Verdicts:
 *  GO          a clean window exists at (or right after) the planned time
 *  WAIT        not now, but a clean window exists later the same day, or the day is only marginal
 *  SKIP_TODAY  the planned day has no workable window (skip-level problems all day)
 *  UNKNOWN     no forecast covers the planned day / task type has no weather rule (we refuse to guess)
 */
import type { HourPoint } from "@/lib/weather";
import type { RulesConfig } from "@/lib/config";
import { addDays, istDateKey, istHour, istToUtc, PART_OF_DAY_START_HOUR, type DateKey, type PartOfDay } from "@/lib/time";

export type TaskType = "spray" | "irrigate" | "fertilize" | "harvest" | "other";
export type Verdict = "GO" | "WAIT" | "SKIP_TODAY" | "UNKNOWN";
export type Severity = "ok" | "info" | "wait" | "skip";
export type ReasonCode =
  | "RAIN_PROB" | "RAIN_MM" | "RAIN_24H" | "WIND" | "GUST" | "HEAT" | "THUNDER" | "FUNGAL_RISK"
  | "NO_FORECAST" | "DAY_OVER" | "NO_RULE" | "CLEAR";

export interface Reason {
  code: ReasonCode;
  severity: Severity;
  value?: number;
  threshold?: number;
  unit?: "%" | "mm" | "km/h" | "°C";
  /** epoch ms of the hour that triggered it */
  at?: number;
}
export interface Window { start: number; end: number }
export interface Evaluation {
  taskType: TaskType;
  plannedDate: DateKey;
  verdict: Verdict;
  reasons: Reason[];
  window: Window | null;
  suggestedWindow: Window | null;
  evaluatedAt: number;
  rulesVersion: number;
  dataSource: string | null;
  dataFetchedAt: string | null;
}

const HOUR = 3_600_000;
const rank: Record<Severity, number> = { ok: 0, info: 1, wait: 2, skip: 3 };
const worst = (rs: Reason[]): Severity => rs.reduce<Severity>((w, r) => (rank[r.severity] > rank[w] ? r.severity : w), "ok");

function hoursIn(hourly: HourPoint[], start: number, end: number) {
  return hourly.filter((h) => h.t >= start && h.t < end);
}

/** Check a single spray window. Exported for tests and the time scrubber. */
export function checkSprayWindow(hours: HourPoint[], cfg: RulesConfig): Reason[] {
  const s = cfg.spray;
  const reasons: Reason[] = [];
  if (!hours.length) return [{ code: "NO_FORECAST", severity: "skip" }];
  // rain over the whole rain-fast window
  const maxProb = hours.reduce((m, h) => Math.max(m, h.precipProb ?? 0), 0);
  const probHour = hours.find((h) => (h.precipProb ?? 0) === maxProb);
  const totalMm = round1(hours.reduce((a, h) => a + h.precipMm, 0));
  if (maxProb >= s.rainProbabilitySkip) reasons.push({ code: "RAIN_PROB", severity: "skip", value: maxProb, threshold: s.rainProbabilitySkip, unit: "%", at: probHour?.t });
  else if (maxProb >= s.rainProbabilityWait) reasons.push({ code: "RAIN_PROB", severity: "wait", value: maxProb, threshold: s.rainProbabilityWait, unit: "%", at: probHour?.t });
  if (totalMm >= s.rainMmSkip) reasons.push({ code: "RAIN_MM", severity: "skip", value: totalMm, threshold: s.rainMmSkip, unit: "mm" });
  else if (totalMm >= s.rainMmWait) reasons.push({ code: "RAIN_MM", severity: "wait", value: totalMm, threshold: s.rainMmWait, unit: "mm" });
  const thunder = hours.find((h) => s.thunderCodes.includes(h.weatherCode));
  if (thunder) reasons.push({ code: "THUNDER", severity: "skip", value: thunder.weatherCode, at: thunder.t });
  // application hours: the first 2 hours of the window (when the farmer is actually spraying)
  const app = hours.slice(0, 2);
  const maxWind = app.reduce((m, h) => Math.max(m, h.windKmh), 0);
  const windHour = app.find((h) => h.windKmh === maxWind);
  if (maxWind >= s.windKmhSkip) reasons.push({ code: "WIND", severity: "skip", value: round1(maxWind), threshold: s.windKmhSkip, unit: "km/h", at: windHour?.t });
  else if (maxWind >= s.windKmhWait) reasons.push({ code: "WIND", severity: "wait", value: round1(maxWind), threshold: s.windKmhWait, unit: "km/h", at: windHour?.t });
  const maxGust = app.reduce((m, h) => Math.max(m, h.gustKmh ?? 0), 0);
  if (maxGust >= s.gustKmhWait && maxWind < s.windKmhSkip) reasons.push({ code: "GUST", severity: "wait", value: round1(maxGust), threshold: s.gustKmhWait, unit: "km/h" });
  const maxT = app.reduce((m, h) => Math.max(m, h.tempC), -99);
  if (maxT >= s.heatCSkip) reasons.push({ code: "HEAT", severity: "skip", value: round1(maxT), threshold: s.heatCSkip, unit: "°C" });
  else if (maxT >= s.heatCWait) reasons.push({ code: "HEAT", severity: "wait", value: round1(maxT), threshold: s.heatCWait, unit: "°C" });
  const avgHum = hours.reduce((a, h) => a + h.humidity, 0) / hours.length;
  if (avgHum >= s.humidityFungalRiskPct) reasons.push({ code: "FUNGAL_RISK", severity: "info", value: Math.round(avgHum), threshold: s.humidityFungalRiskPct, unit: "%" });
  return reasons;
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

interface Candidate { win: Window; reasons: Reason[]; sev: Severity }

function sprayCandidates(hourly: HourPoint[], day: DateKey, cfg: RulesConfig, notBefore: number): Candidate[] {
  const out: Candidate[] = [];
  for (let h = cfg.dayStartHour; h <= cfg.dayEndHour - 2; h++) {
    const start = istToUtc(day, h).getTime();
    if (start + HOUR <= notBefore) continue;
    const end = start + cfg.windowHours * HOUR;
    const hrs = hoursIn(hourly, start, end);
    if (hrs.length < Math.min(cfg.windowHours, 3)) continue; // insufficient coverage → not a candidate
    const reasons = checkSprayWindow(hrs, cfg);
    out.push({ win: { start, end }, reasons, sev: worst(reasons) });
  }
  return out;
}

const clean = (c: Candidate) => rank[c.sev] <= rank.info;

function nextCleanSprayWindow(hourly: HourPoint[], fromDay: DateKey, cfg: RulesConfig, notBefore: number, days = 3): Window | null {
  for (let i = 0; i < days; i++) {
    const c = sprayCandidates(hourly, addDays(fromDay, i), cfg, notBefore).find(clean);
    if (c) return c.win;
  }
  return null;
}

export interface EvalInput {
  type: TaskType;
  plannedDate: DateKey;
  partOfDay?: PartOfDay | null;
}

export function evaluateTask(
  task: EvalInput,
  hourly: HourPoint[] | null,
  cfg: RulesConfig,
  now: Date,
  meta: { source: string | null; fetchedAt: string | null } = { source: null, fetchedAt: null },
): Evaluation {
  const base = {
    taskType: task.type,
    plannedDate: task.plannedDate,
    evaluatedAt: now.getTime(),
    rulesVersion: cfg.version,
    dataSource: meta.source,
    dataFetchedAt: meta.fetchedAt,
  };
  const unknown = (code: ReasonCode): Evaluation => ({ ...base, verdict: "UNKNOWN", reasons: [{ code, severity: "info" }], window: null, suggestedWindow: null });

  if (task.type === "other") return unknown("NO_RULE");
  if (!hourly || hourly.length === 0) return unknown("NO_FORECAST");
  const dayStart = istToUtc(task.plannedDate, 0).getTime();
  const dayEnd = dayStart + 24 * HOUR;
  const lastT = hourly[hourly.length - 1]!.t;
  if (dayStart + cfg.dayStartHour * HOUR > lastT) return unknown("NO_FORECAST");
  const notBefore = now.getTime();
  const today = istDateKey(now);
  const isPastDay = task.plannedDate < today;
  const evalDay = isPastDay ? today : task.plannedDate;

  if (task.type === "spray" || task.type === "harvest") {
    const cands = sprayCandidates(hourly, evalDay, harvestAdjusted(cfg, task.type), notBefore);
    if (!cands.length) {
      const sug = nextCleanSprayWindow(hourly, addDays(evalDay, 1), harvestAdjusted(cfg, task.type), notBefore);
      const dayOver = evalDay === today && istHour(now) >= cfg.dayEndHour - 2;
      if (dayOver) return { ...base, verdict: "SKIP_TODAY", reasons: [{ code: "DAY_OVER", severity: "skip" }], window: null, suggestedWindow: sug };
      return { ...unknown("NO_FORECAST"), suggestedWindow: sug };
    }
    // preferred window: requested part of day, else the earliest remaining
    const prefHour = task.partOfDay ? PART_OF_DAY_START_HOUR[task.partOfDay] : null;
    const pref =
      (prefHour !== null && cands.find((c) => istHour(new Date(c.win.start)) >= prefHour)) || cands[0]!;
    if (clean(pref)) {
      return { ...base, verdict: "GO", reasons: pref.reasons.length ? pref.reasons : [{ code: "CLEAR", severity: "ok" }], window: pref.win, suggestedWindow: pref.win };
    }
    const laterClean = cands.find((c) => c.win.start > pref.win.start && clean(c)) ?? cands.find(clean);
    if (laterClean) {
      return { ...base, verdict: "WAIT", reasons: pref.reasons, window: pref.win, suggestedWindow: laterClean.win };
    }
    const sug = nextCleanSprayWindow(hourly, addDays(evalDay, 1), harvestAdjusted(cfg, task.type), notBefore);
    const allSkip = cands.every((c) => c.sev === "skip");
    return { ...base, verdict: allSkip ? "SKIP_TODAY" : "WAIT", reasons: pref.reasons, window: pref.win, suggestedWindow: sug };
  }

  // irrigate / fertilize: look at rain over the 24h from the planned morning
  const start = Math.max(istToUtc(evalDay, cfg.dayStartHour).getTime(), Math.min(notBefore, dayEnd));
  const hrs = hoursIn(hourly, start, start + 24 * HOUR);
  if (hrs.length < 12) return unknown("NO_FORECAST");
  const mm = round1(hrs.reduce((a, h) => a + h.precipMm, 0));
  const maxProb = hrs.reduce((m, h) => Math.max(m, h.precipProb ?? 0), 0);
  const reasons: Reason[] = [];
  if (task.type === "irrigate") {
    const c = cfg.irrigate;
    if (mm >= c.rainMmSkip24h) reasons.push({ code: "RAIN_24H", severity: "skip", value: mm, threshold: c.rainMmSkip24h, unit: "mm" });
    else if (mm >= c.rainMmWait24h) reasons.push({ code: "RAIN_24H", severity: "wait", value: mm, threshold: c.rainMmWait24h, unit: "mm" });
    else if (maxProb >= c.rainProbabilityWait24h) reasons.push({ code: "RAIN_PROB", severity: "wait", value: maxProb, threshold: c.rainProbabilityWait24h, unit: "%" });
  } else {
    const c = cfg.fertilize;
    if (mm >= c.rainMmSkip) reasons.push({ code: "RAIN_24H", severity: "skip", value: mm, threshold: c.rainMmSkip, unit: "mm" });
    else if (mm >= c.rainMmWait) reasons.push({ code: "RAIN_24H", severity: "wait", value: mm, threshold: c.rainMmWait, unit: "mm" });
    else if (maxProb >= c.rainProbabilityWait) reasons.push({ code: "RAIN_PROB", severity: "wait", value: maxProb, threshold: c.rainProbabilityWait, unit: "%" });
  }
  const sev = worst(reasons);
  const win = { start, end: start + 24 * HOUR };
  const verdict: Verdict = sev === "skip" ? "SKIP_TODAY" : sev === "wait" ? "WAIT" : "GO";
  return { ...base, verdict, reasons: reasons.length ? reasons : [{ code: "CLEAR", severity: "ok" }], window: win, suggestedWindow: verdict === "GO" ? win : null };
}

/** harvest uses the same window logic but ignores wind/heat (only rain/thunder matter) */
function harvestAdjusted(cfg: RulesConfig, type: TaskType): RulesConfig {
  if (type !== "harvest") return cfg;
  return {
    ...cfg,
    spray: {
      ...cfg.spray,
      rainProbabilityWait: cfg.harvest.rainProbabilityWait,
      rainProbabilitySkip: Math.max(cfg.harvest.rainProbabilityWait + 30, 70),
      rainMmSkip: cfg.harvest.rainMmSkip,
      thunderCodes: cfg.harvest.thunderCodes,
      windKmhWait: 999, windKmhSkip: 999, gustKmhWait: 999, heatCWait: 999, heatCSkip: 999, humidityFungalRiskPct: 101,
    },
  };
}

/** Hour-by-hour spray suitability strip for the time scrubber (next N hours). */
export function sprayStrip(hourly: HourPoint[], cfg: RulesConfig, fromMs: number, hours = 48): { t: number; sev: Severity }[] {
  const out: { t: number; sev: Severity }[] = [];
  const startIdx = hourly.findIndex((h) => h.t >= fromMs - HOUR);
  if (startIdx < 0) return out;
  for (let i = startIdx; i < Math.min(hourly.length, startIdx + hours); i++) {
    const h = hourly[i]!;
    const win = hoursIn(hourly, h.t, h.t + cfg.windowHours * HOUR);
    const hr = istHour(new Date(h.t));
    const daylight = hr >= cfg.dayStartHour && hr <= cfg.dayEndHour - 2;
    out.push({ t: h.t, sev: daylight ? worst(checkSprayWindow(win, cfg)) : "skip" });
  }
  return out;
}

/** Stable signature for alert dedupe: verdict + primary reason codes + day. */
export function evaluationSignature(e: Evaluation): string {
  const codes = e.reasons.filter((r) => r.severity === "wait" || r.severity === "skip").map((r) => r.code).sort().join("+");
  return `${e.plannedDate}:${e.verdict}:${codes || "none"}`;
}
