/**
 * In-process scheduler (node-cron) for the 06:00 / 12:00 / 18:00 IST monitor
 * runs. Started once from instrumentation.ts. Each fire computes a run key
 * `YYYY-MM-DD@HH:MM` (IST) and runMonitorSlot() refuses duplicates, so
 * restarts, double registration or multiple instances on one DB can't double-run.
 * Missed slots (server was down) are caught up once on boot.
 */
import cron from "node-cron";
import { monitorTimes } from "@/lib/config";
import { istDateKey, istToUtc } from "@/lib/time";
import { runMonitorSlot } from "@/lib/monitor";
import { log } from "@/lib/log";

const g = globalThis as unknown as { __ksScheduler?: boolean };

export function slotKey(now: Date, hhmm: string) {
  return `${istDateKey(now)}@${hhmm}`;
}

/** The most recent slot at or before `now`, today (IST). */
export function latestDueSlot(now: Date, times = monitorTimes()): string | null {
  const today = istDateKey(now);
  const due = times.filter((t) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return istToUtc(today, h, m).getTime() <= now.getTime();
  });
  const last = due.sort().pop();
  return last ? `${today}@${last}` : null;
}

export function startScheduler() {
  if (g.__ksScheduler) return;
  if (process.env.SCHEDULER_ENABLED === "0") {
    log.info("scheduler.disabled");
    return;
  }
  g.__ksScheduler = true;
  for (const t of monitorTimes()) {
    const [h, m] = t.split(":").map(Number) as [number, number];
    cron.schedule(`${m} ${h} * * *`, () => {
      const key = slotKey(new Date(), t);
      runMonitorSlot(key).catch((e) => log.error("scheduler.run_failed", { key, error: (e as Error).message }));
    }, { timezone: "Asia/Kolkata", name: `monitor-${t}` });
  }
  const catchUp = latestDueSlot(new Date());
  if (catchUp) setTimeout(() => runMonitorSlot(catchUp).catch((e) => log.error("scheduler.catchup_failed", { error: (e as Error).message })), 3000);
  log.info("scheduler.started", { times: monitorTimes() });
}
