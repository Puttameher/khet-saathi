/** IST display helpers for the client (pure, no server deps). */
import { relativeLabel } from "@/lib/time";
import type { Lang } from "@/lib/config";

export function istClock(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));
}
export function istDayClock(iso: string | number | Date, lang: Lang): string {
  const d = new Date(iso);
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  return `${relativeLabel(key, new Date(), lang)} ${istClock(d)}`;
}
export function istDateLabel(dateKey: string, lang: Lang): { rel: string; full: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 6));
  const full = new Intl.DateTimeFormat(lang === "te" ? "te-IN" : "hi-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(dt);
  return { rel: relativeLabel(dateKey, new Date(), lang), full };
}
