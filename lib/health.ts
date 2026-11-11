/**
 * Crop Care Score (0–100): a care score based on the farmer's own inputs and
 * the weather. NOT a yield, disease or medical claim. Every point is traceable
 * to a factor the UI shows when the bubble is tapped.
 *
 *   score = clamp(BASE + Σ factor.delta, 0, 100)
 *
 * Factors (all capped):
 *   onTime        +3 per task done on/before its planned day (last 30d), max +12
 *   overdue       −8 per active task whose planned day has passed, max −24
 *   sprayRecent   +6 if a spray was completed in the last 14 days
 *   irrigation    +5 if irrigation logged in the last 7 days
 *   dryStress     −8 if no irrigation for 10+ days AND < 10 mm rain in the last 7 days
 *   heatStress    −6 if max temp ≥ 38 °C in the last 3 days or the next 24 h
 *   waterlog      −5 if ≥ 50 mm rain in the last 48 h
 *   checkIn       +5 checked in today/yesterday; 0 for 2–3 days; −2/day beyond 3, max −10
 */
import type { HourPoint } from "@/lib/weather";
import type { Task } from "@/lib/tasks";
import { diffDays, istDateKey } from "@/lib/time";

export const HEALTH_BASE = 70;
export type FactorId = "onTime" | "overdue" | "sprayRecent" | "irrigation" | "dryStress" | "heatStress" | "waterlog" | "checkIn";
export interface Factor { id: FactorId; delta: number; detail: Record<string, number | string> }
export type Band = "healthy" | "attention" | "risk";
export interface HealthResult { score: number; band: Band; base: number; factors: Factor[]; computedAt: string; label: string }

export interface HealthInput {
  now: Date;
  tasks: Pick<Task, "type" | "status" | "plannedDate" | "completedAt">[];
  /** timeline: irrigation logs (ISO) including completed irrigate tasks */
  irrigationLogs: string[];
  lastCheckIn: string | null;
  hourly: HourPoint[] | null;
}

const H = 3_600_000;

export function computeHealth(inp: HealthInput): HealthResult {
  const { now } = inp;
  const today = istDateKey(now);
  const factors: Factor[] = [];
  const push = (id: FactorId, delta: number, detail: Factor["detail"]) => {
    if (delta !== 0) factors.push({ id, delta, detail });
  };

  const done = inp.tasks.filter((t) => t.status === "done" && t.completedAt);
  const onTime = done.filter((t) => {
    const ck = istDateKey(new Date(t.completedAt!));
    return diffDays(today, ck) <= 30 && ck <= t.plannedDate;
  }).length;
  push("onTime", Math.min(12, onTime * 3), { count: onTime });

  const overdue = inp.tasks.filter(
    (t) => ["planned", "go_ahead", "skip_suggested", "in_progress"].includes(t.status) && t.plannedDate < today,
  ).length;
  push("overdue", -Math.min(24, overdue * 8), { count: overdue });

  const lastSpray = done
    .filter((t) => t.type === "spray")
    .map((t) => new Date(t.completedAt!).getTime())
    .sort((a, b) => b - a)[0];
  if (lastSpray !== undefined && now.getTime() - lastSpray <= 14 * 24 * H) {
    push("sprayRecent", 6, { daysAgo: Math.floor((now.getTime() - lastSpray) / (24 * H)) });
  }

  const irr = [...inp.irrigationLogs, ...done.filter((t) => t.type === "irrigate").map((t) => t.completedAt!)]
    .map((s) => new Date(s).getTime())
    .filter((x) => x <= now.getTime())
    .sort((a, b) => b - a);
  const daysSinceIrr = irr[0] !== undefined ? (now.getTime() - irr[0]) / (24 * H) : Infinity;
  if (daysSinceIrr <= 7) push("irrigation", 5, { daysAgo: Math.floor(daysSinceIrr) });

  if (inp.hourly && inp.hourly.length) {
    const t0 = now.getTime();
    const rain7 = sum(inp.hourly.filter((h) => h.t > t0 - 7 * 24 * H && h.t <= t0).map((h) => h.precipMm));
    const rain48 = sum(inp.hourly.filter((h) => h.t > t0 - 48 * H && h.t <= t0).map((h) => h.precipMm));
    const maxT = Math.max(-99, ...inp.hourly.filter((h) => h.t > t0 - 72 * H && h.t <= t0 + 24 * H).map((h) => h.tempC));
    if (daysSinceIrr >= 10 && rain7 < 10) push("dryStress", -8, { rain7dMm: r1(rain7), daysSinceIrrigation: Number.isFinite(daysSinceIrr) ? Math.floor(daysSinceIrr) : "never" });
    if (maxT >= 38) push("heatStress", -6, { maxTempC: r1(maxT) });
    if (rain48 >= 50) push("waterlog", -5, { rain48hMm: r1(rain48) });
  }

  if (inp.lastCheckIn) {
    const d = diffDays(today, istDateKey(new Date(inp.lastCheckIn)));
    const delta = d <= 1 ? 5 : d <= 3 ? 0 : -Math.min(10, (d - 3) * 2);
    push("checkIn", delta, { daysAgo: d });
  } else {
    push("checkIn", -4, { daysAgo: "never" });
  }

  const raw = HEALTH_BASE + factors.reduce((a, f) => a + f.delta, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    score,
    band: bandOf(score),
    base: HEALTH_BASE,
    factors,
    computedAt: now.toISOString(),
    label: "care score based on your inputs and weather",
  };
}

export function bandOf(score: number): Band {
  return score >= 70 ? "healthy" : score >= 45 ? "attention" : "risk";
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r1 = (x: number) => Math.round(x * 10) / 10;
