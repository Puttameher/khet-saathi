/**
 * Pure scene model for the Khet scene: turns real data (forecast hour, farm lat/lon,
 * time) into the numbers the animated layers need. No DOM, no randomness → unit tested.
 *
 * Sun position: NOAA solar-position approximation (±0.5°), good enough for sky colour.
 * Moon phase: mean synodic month from the J2000 new moon (±1 day), used only for the crescent.
 */
import type { HourPoint } from "@/lib/weather";
import { conditionOf, type Condition } from "@/lib/weather-codes";

const RAD = Math.PI / 180;
const DAY = 86_400_000;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function julian(ms: number) {
  return ms / DAY + 2440587.5;
}

/** Solar declination (rad) and equation of time (minutes) for an instant. */
function solarParams(ms: number) {
  const jc = (julian(ms) - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot =
    4 / RAD *
    (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eot };
}

/** Sun elevation in degrees above the horizon (negative below). */
export function sunElevation(ms: number, lat: number, lon: number): number {
  const { decl, eot } = solarParams(ms);
  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const tst = (((utcMin + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * RAD;
  const cosZ = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / RAD;
}

/** Sunrise/sunset (epoch ms) of the UTC-noon-anchored local solar day containing `ms`. */
export function sunTimes(ms: number, lat: number, lon: number): { rise: number; set: number; noon: number } {
  const base = Math.floor((ms + lon * 240_000) / DAY) * DAY; // UTC midnight of the local solar date
  const { decl, eot } = solarParams(base + DAY / 2);
  const noon = base + (720 - 4 * lon - eot) * 60_000;
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD; // degrees
  return { rise: noon - H * 4 * 60_000, set: noon + H * 4 * 60_000, noon };
}

/** Where the sun/moon sits on its arc: 0 = rising (left), 1 = setting (right); `up` false → hidden. */
export function celestial(ms: number, lat: number, lon: number): { body: "sun" | "moon"; frac: number } {
  const today = sunTimes(ms, lat, lon);
  if (ms >= today.rise && ms <= today.set) return { body: "sun", frac: (ms - today.rise) / (today.set - today.rise) };
  if (ms > today.set) {
    const next = sunTimes(ms + DAY, lat, lon);
    return { body: "moon", frac: (ms - today.set) / (next.rise - today.set) };
  }
  const prev = sunTimes(ms - DAY, lat, lon);
  return { body: "moon", frac: (ms - prev.set) / (today.rise - prev.set) };
}

/** 0 new … 0.5 full … 1 new */
export function moonPhase(ms: number): number {
  const p = ((julian(ms) - 2451550.1) / 29.530588853) % 1;
  return p < 0 ? p + 1 : p;
}

// ---------- sky ----------
/** Ordered base sky keyframes by sun elevation (deg). Opacities stack: layer i is opaque, i+1 fades in. */
export const SKY_KEYS = [
  { id: "night", elev: -14 },
  { id: "astro", elev: -7 },
  { id: "dawn", elev: -1 },
  { id: "golden", elev: 6 },
  { id: "day", elev: 18 },
] as const;
export type SkyKey = (typeof SKY_KEYS)[number]["id"];

/** Opacity for each stacked base layer so the composite is a linear blend between neighbours. */
export function skyLayerOpacity(elev: number): Record<SkyKey, number> {
  const out = { night: 1, astro: 0, dawn: 0, golden: 0, day: 0 } as Record<SkyKey, number>;
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const a = SKY_KEYS[i - 1]!, b = SKY_KEYS[i]!;
    out[b.id] = clamp01((elev - a.elev) / (b.elev - a.elev));
  }
  return out;
}

/** 1 in full daylight, 0 in full night (twilight in between). */
export const daylight = (elev: number) => smoothstep(-8, 6, elev);

// ---------- weather at time ----------
export interface SceneWeather {
  cloud: number; // 0..1
  precipMm: number; // mm/h
  precipProb: number | null;
  windKmh: number;
  gustKmh: number | null;
  tempC: number;
  humidity: number;
  code: number;
  condition: Condition;
  soil: number; // 0..1 wetness
  t: number; // hour the values belong to (nearest)
}

/** Linear interpolation of the hourly forecast at `ms` (codes from the nearest hour). Null if out of range. */
export function weatherAt(hourly: HourPoint[], ms: number): SceneWeather | null {
  if (!hourly.length) return null;
  const first = hourly[0]!, last = hourly[hourly.length - 1]!;
  if (ms < first.t - 3_600_000 || ms > last.t + 3_600_000) return null;
  let i = hourly.findIndex((h) => h.t > ms);
  if (i <= 0) i = i === 0 ? 1 : hourly.length - 1;
  const a = hourly[Math.max(0, i - 1)]!, b = hourly[Math.min(hourly.length - 1, i)]!;
  const f = b.t === a.t ? 0 : clamp01((ms - a.t) / (b.t - a.t));
  const near = f < 0.5 ? a : b;
  const precipMm = lerp(a.precipMm, b.precipMm, f);
  return {
    cloud: clamp01(lerp(a.cloudCover, b.cloudCover, f) / 100),
    precipMm,
    precipProb: a.precipProb == null || b.precipProb == null ? near.precipProb : lerp(a.precipProb, b.precipProb, f),
    windKmh: lerp(a.windKmh, b.windKmh, f),
    gustKmh: a.gustKmh == null || b.gustKmh == null ? near.gustKmh : lerp(a.gustKmh, b.gustKmh, f),
    tempC: lerp(a.tempC, b.tempC, f),
    humidity: lerp(a.humidity, b.humidity, f),
    code: near.weatherCode,
    condition: conditionOf(near.weatherCode, precipMm),
    soil: soilWetness(hourly, ms),
    t: near.t,
  };
}

/** Soil wetness 0..1: Open-Meteo 0–1 cm soil moisture (m³/m³) when present, else rain in the past 24 h. */
export function soilWetness(hourly: HourPoint[], ms: number): number {
  let near: HourPoint | undefined;
  for (const h of hourly) if (h.t <= ms + 1_800_000) near = h;
  if (near?.soilMoisture != null) return clamp01((near.soilMoisture - 0.12) / 0.3);
  const rain24 = hourly.filter((h) => h.t > ms - DAY && h.t <= ms).reduce((s, h) => s + h.precipMm, 0);
  return clamp01(rain24 / 20);
}

/** Particle intensity 0..1 from mm/h (drizzle ≈ 0.1–0.3, rain 0.3–0.7, downpour → 1). */
export function rainIntensity(precipMm: number, condition: Condition): number {
  const wet = condition === "drizzle" || condition === "rain" || condition === "heavy_rain" || condition === "thunder";
  if (!wet && precipMm < 0.1) return 0;
  const base = condition === "drizzle" ? 0.15 : condition === "thunder" ? 0.55 : 0.25;
  return clamp01(Math.max(base, Math.log1p(precipMm) / Math.log1p(12)));
}

/** Crop sway amplitude in degrees from wind (km/h); calm fields still breathe a little. */
export function swayDeg(windKmh: number, gustKmh: number | null = null): number {
  const w = Math.max(windKmh, (gustKmh ?? 0) * 0.6);
  return Math.min(11, 0.8 + w * 0.32);
}

/** Cloud drift speed px/s at depth (0 far … 2 near) for a wind speed. */
export function cloudSpeed(windKmh: number, depth: number): number {
  return (1.5 + windKmh * 0.55) * (0.45 + depth * 0.45);
}
