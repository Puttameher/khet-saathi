import { CROPS, RULES, cropStage, type Lang } from "@/lib/config";
import { evaluateTask, sprayStrip, type Evaluation } from "@/lib/rules";
import { computeHealth, type HealthResult } from "@/lib/health";
import { weatherForFarmer } from "@/lib/monitor";
import { getProfile, getSetting, listTasks, listTimeline, pendingAlerts, listMessages, type Profile, type AlertRow } from "@/lib/repo";
import { isActive, type TaskStatus } from "@/lib/tasks";
import { diffDays, istDateKey } from "@/lib/time";
import { gnaniStt, gnaniTts } from "@/lib/gnani";
import { llm, LLM_MODEL } from "@/lib/llm";
import { demoEnabled } from "@/lib/demo";
import { getOnboarding } from "@/lib/onboarding";
import type { HourPoint, DayPoint } from "@/lib/weather";
import type { TaskType } from "@/lib/rules";
import type { PartOfDay } from "@/lib/time";

export interface TaskView {
  id: string;
  type: TaskType;
  plannedDate: string;
  partOfDay: PartOfDay | null;
  notes: string | null;
  status: TaskStatus;
  evaluation: Evaluation | null;
  startedAt: string | null;
  completedAt: string | null;
  label: unknown;
}

export interface AppState {
  now: string;
  profile: Profile & { onboarded: boolean };
  onboardingStep: string | null;
  crop: { id: string; name: string; day: number; stage: string; stageLabel: string; progress: number } | null;
  tasks: TaskView[];
  alerts: AlertRow[];
  weather: {
    current: { tempC: number; humidity: number; weatherCode: number; cloudCover: number; windKmh: number; isDay: boolean } | null;
    hourly: HourPoint[];
    daily: DayPoint[];
    fetchedAt: string;
    stale: boolean;
    source: string;
    sourceUrl: string;
    demoScenario: string | null;
  } | null;
  weatherError: string | null;
  strip: { t: number; sev: string }[];
  health: HealthResult;
  timeline: { kind: string; at: string; payload: unknown }[];
  messages: { id: string; at: string; role: "farmer" | "saathi"; text: string }[];
  services: { stt: boolean; tts: boolean; llm: boolean; llmModel: string };
  demo: { enabled: boolean; scenario: string };
  rules: typeof RULES;
  cropsVerified: boolean;
}

export async function buildState(now = new Date(), opts: { force?: boolean } = {}): Promise<AppState> {
  const p = getProfile();
  const lang: Lang = p.language;
  const wx = await weatherForFarmer({ now, force: opts.force });
  const fc = wx.forecast;
  const tasks = listTasks();
  const today = istDateKey(now);
  const views: TaskView[] = tasks
    .filter((t) => isActive(t.status) || (t.completedAt && diffDays(today, istDateKey(new Date(t.completedAt))) <= 14) || diffDays(today, t.plannedDate) <= 3)
    .map((t) => ({
      id: t.id,
      type: t.type,
      plannedDate: t.plannedDate,
      partOfDay: t.partOfDay,
      notes: t.notes,
      status: t.status,
      evaluation: isActive(t.status) && t.status !== "in_progress"
        ? fc
          ? evaluateTask(t, fc.hourly, RULES, now, { source: fc.source === "demo" ? "demo" : "open-meteo", fetchedAt: fc.fetchedAt })
          : t.lastEvaluation
        : t.lastEvaluation,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      label: t.label,
    }));
  const timeline = listTimeline(60);
  const health = computeHealth({
    now,
    tasks,
    irrigationLogs: timeline.filter((e) => e.kind === "irrigation" && !e.taskId).map((e) => e.at),
    lastCheckIn: getSetting<string>("lastCheckIn"),
    hourly: fc?.hourly ?? null,
  });
  let crop: AppState["crop"] = null;
  if (p.crop && p.sowingDate) {
    const day = diffDays(today, p.sowingDate);
    const st = cropStage(p.crop, day);
    crop = { id: p.crop, name: CROPS.crops[p.crop].names[lang === "te" ? "te" : "hi"], day, stage: st.stage, stageLabel: st.label[lang], progress: st.progress };
  }
  const windowStart = now.getTime() - 6 * 3_600_000;
  return {
    now: now.toISOString(),
    profile: { ...p, onboarded: !!p.confirmedAt },
    onboardingStep: p.confirmedAt ? null : getOnboarding().step,
    crop,
    tasks: views,
    alerts: pendingAlerts(),
    weather: fc
      ? {
          current: fc.current,
          hourly: fc.hourly.filter((h) => h.t >= windowStart && h.t <= now.getTime() + 50 * 3_600_000),
          daily: fc.daily.filter((d) => d.date >= today),
          fetchedAt: fc.fetchedAt,
          stale: wx.stale,
          source: fc.source,
          sourceUrl: fc.sourceUrl,
          demoScenario: fc.demoScenario ?? null,
        }
      : null,
    weatherError: wx.error ?? null,
    strip: fc ? sprayStrip(fc.hourly, RULES, now.getTime(), 48) : [],
    health,
    timeline: timeline.map((e) => ({ kind: e.kind, at: e.at, payload: e.payload })),
    messages: listMessages(30).map((m) => ({ id: m.id, at: m.at, role: m.role, text: m.text })),
    services: { stt: gnaniStt.available(), tts: gnaniTts.available(), llm: llm.available(), llmModel: LLM_MODEL() },
    demo: { enabled: demoEnabled(), scenario: demoEnabled() ? getSetting<string>("demoScenario") ?? "off" : "off" },
    rules: RULES,
    cropsVerified: CROPS._verified,
  };
}
