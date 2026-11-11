/**
 * DEMO MODE ONLY (env DEMO_MODE=1). Overlays a scripted scenario on top of the
 * REAL Open-Meteo forecast so storms can be shown on cue in the demo video.
 * The UI shows a persistent "DEMO WEATHER" badge whenever a scenario is active,
 * and every advisory built from it carries source "demo".
 */
import type { Forecast, HourPoint } from "@/lib/weather";
import { addDays, istDateKey, istToUtc } from "@/lib/time";

export const DEMO_SCENARIOS = ["off", "clear", "storm"] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];
export const demoEnabled = () => process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";

export function applyDemo(fc: Forecast, scenario: DemoScenario, now: Date): Forecast {
  if (scenario === "off") return fc;
  const today = istDateKey(now);
  const stormStart = istToUtc(addDays(today, 1), 12).getTime();
  const stormEnd = istToUtc(addDays(today, 2), 20).getTime();
  const hourly: HourPoint[] = fc.hourly.map((h) => {
    if (h.t < now.getTime() - 3_600_000) return h; // never rewrite the past
    if (scenario === "clear") return { ...h, precipProb: 5, precipMm: 0, weatherCode: h.isDay ? 0 : 1, cloudCover: 10, windKmh: Math.min(h.windKmh, 8), gustKmh: Math.min(h.gustKmh ?? 12, 14) };
    if (h.t >= stormStart && h.t < stormEnd) {
      const peak = Math.sin(((h.t - stormStart) / (stormEnd - stormStart)) * Math.PI);
      return { ...h, precipProb: 85 + Math.round(10 * peak), precipMm: +(1 + 7 * peak).toFixed(1), weatherCode: peak > 0.55 ? 95 : 63, cloudCover: 100, windKmh: +(14 + 20 * peak).toFixed(1), gustKmh: +(25 + 30 * peak).toFixed(1), humidity: 92 };
    }
    return { ...h, precipProb: Math.min(h.precipProb ?? 0, 15), precipMm: 0, weatherCode: Math.min(h.weatherCode, 2), windKmh: Math.min(h.windKmh, 10) };
  });
  const daily = fc.daily.map((d) => {
    const hrs = hourly.filter((h) => istDateKey(new Date(h.t)) === d.date);
    if (!hrs.length || d.date < today) return d;
    return {
      ...d,
      precipSum: +hrs.reduce((a, h) => a + h.precipMm, 0).toFixed(1),
      precipProbMax: Math.max(...hrs.map((h) => h.precipProb ?? 0)),
      weatherCode: Math.max(...hrs.map((h) => h.weatherCode)),
    };
  });
  const cur = fc.current;
  const nowHour = hourly.find((h) => h.t <= now.getTime() && h.t + 3_600_000 > now.getTime());
  return {
    ...fc,
    hourly,
    daily,
    current: cur && nowHour ? { ...cur, weatherCode: nowHour.weatherCode, cloudCover: nowHour.cloudCover, windKmh: nowHour.windKmh } : cur,
    source: "demo",
    demoScenario: scenario,
  };
}
