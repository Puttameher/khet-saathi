import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { APP } from "@/lib/config";
import { log } from "@/lib/log";

export interface HourPoint {
  /** epoch ms (UTC instant) */
  t: number;
  tempC: number;
  humidity: number;
  precipProb: number | null;
  precipMm: number;
  weatherCode: number;
  cloudCover: number;
  windKmh: number;
  gustKmh: number | null;
  isDay: boolean;
  soilMoisture: number | null;
}
export interface DayPoint {
  date: string; // IST date key
  sunrise: number;
  sunset: number;
  tMax: number;
  tMin: number;
  precipSum: number;
  precipProbMax: number | null;
  weatherCode: number;
}
export interface Forecast {
  lat: number;
  lon: number;
  hourly: HourPoint[];
  daily: DayPoint[];
  current: { tempC: number; humidity: number; weatherCode: number; cloudCover: number; windKmh: number; isDay: boolean; t: number } | null;
  source: "open-meteo" | "demo";
  sourceUrl: string;
  fetchedAt: string; // ISO
  demoScenario?: string;
}
export interface WeatherResult {
  forecast: Forecast | null;
  stale: boolean;
  error?: string;
}

const nums = z.array(z.number().nullable());
const OpenMeteoSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  current: z
    .object({
      time: z.number(),
      temperature_2m: z.number(),
      relative_humidity_2m: z.number(),
      weather_code: z.number(),
      cloud_cover: z.number(),
      wind_speed_10m: z.number(),
      is_day: z.number(),
    })
    .optional(),
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: nums,
    relative_humidity_2m: nums,
    precipitation_probability: nums,
    precipitation: nums,
    weather_code: nums,
    cloud_cover: nums,
    wind_speed_10m: nums,
    wind_gusts_10m: nums,
    is_day: nums,
    soil_moisture_0_to_1cm: nums.optional(),
  }),
  daily: z.object({
    time: z.array(z.number()),
    sunrise: z.array(z.number()),
    sunset: z.array(z.number()),
    temperature_2m_max: nums,
    temperature_2m_min: nums,
    precipitation_sum: nums,
    precipitation_probability_max: nums,
    weather_code: nums,
  }),
});

const HOURLY = [
  "temperature_2m", "relative_humidity_2m", "precipitation_probability", "precipitation", "weather_code",
  "cloud_cover", "wind_speed_10m", "wind_gusts_10m", "is_day", "soil_moisture_0_to_1cm",
].join(",");
const DAILY = [
  "sunrise", "sunset", "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max", "weather_code",
].join(",");
const CURRENT = "temperature_2m,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,is_day";

export function forecastUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: HOURLY,
    daily: DAILY,
    current: CURRENT,
    timezone: "Asia/Kolkata",
    timeformat: "unixtime",
    wind_speed_unit: "kmh",
    past_days: "7",
    forecast_days: "4",
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

function n(v: number | null | undefined, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function dateKeyFromUnix(sec: number): string {
  const s = new Date(sec * 1000 + 330 * 60_000);
  return s.toISOString().slice(0, 10);
}

export function parseOpenMeteo(json: unknown, fetchedAt: Date, url: string): Forecast {
  const r = OpenMeteoSchema.parse(json);
  const h = r.hourly;
  const hourly: HourPoint[] = h.time.map((t, i) => ({
    t: t * 1000,
    tempC: n(h.temperature_2m[i]),
    humidity: n(h.relative_humidity_2m[i]),
    precipProb: h.precipitation_probability[i] ?? null,
    precipMm: n(h.precipitation[i]),
    weatherCode: n(h.weather_code[i]),
    cloudCover: n(h.cloud_cover[i]),
    windKmh: n(h.wind_speed_10m[i]),
    gustKmh: h.wind_gusts_10m[i] ?? null,
    isDay: n(h.is_day[i]) === 1,
    soilMoisture: h.soil_moisture_0_to_1cm?.[i] ?? null,
  }));
  const d = r.daily;
  const daily: DayPoint[] = d.time.map((t, i) => ({
    date: dateKeyFromUnix(t),
    sunrise: n(d.sunrise[i]) * 1000,
    sunset: n(d.sunset[i]) * 1000,
    tMax: n(d.temperature_2m_max[i]),
    tMin: n(d.temperature_2m_min[i]),
    precipSum: n(d.precipitation_sum[i]),
    precipProbMax: d.precipitation_probability_max[i] ?? null,
    weatherCode: n(d.weather_code[i]),
  }));
  const c = r.current;
  return {
    lat: r.latitude,
    lon: r.longitude,
    hourly,
    daily,
    current: c
      ? { t: c.time * 1000, tempC: c.temperature_2m, humidity: c.relative_humidity_2m, weatherCode: c.weather_code, cloudCover: c.cloud_cover, windKmh: c.wind_speed_10m, isDay: c.is_day === 1 }
      : null,
    source: "open-meteo",
    sourceUrl: url.replace(/latitude=[^&]+&longitude=[^&]+/, "latitude=…&longitude=…"),
    fetchedAt: fetchedAt.toISOString(),
  };
}

function cacheKey(lat: number, lon: number) {
  return `om:${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

function readCache(key: string): Forecast | null {
  const row = getDb().select().from(schema.weatherCache).where(eq(schema.weatherCache.key, key)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as Forecast;
  } catch {
    return null;
  }
}

/**
 * Real forecast from Open-Meteo with an SQLite cache. On network failure the
 * last cached forecast is returned with `stale: true` and its timestamp; if
 * there is no cache the result has `forecast: null` (never fabricated).
 */
export async function getForecast(lat: number, lon: number, opts: { force?: boolean; now?: Date } = {}): Promise<WeatherResult> {
  const now = opts.now ?? new Date();
  const key = cacheKey(lat, lon);
  const cached = readCache(key);
  if (cached && !opts.force) {
    const age = now.getTime() - new Date(cached.fetchedAt).getTime();
    if (age < APP.weatherCacheMinutes * 60_000) return { forecast: cached, stale: false };
  }
  const url = forecastUrl(lat, lon);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const fc = parseOpenMeteo(await res.json(), now, url);
    getDb()
      .insert(schema.weatherCache)
      .values({ key, fetchedAt: fc.fetchedAt, payload: JSON.stringify(fc) })
      .onConflictDoUpdate({ target: schema.weatherCache.key, set: { fetchedAt: fc.fetchedAt, payload: JSON.stringify(fc) } })
      .run();
    log.info("weather.fetched", { hours: fc.hourly.length });
    return { forecast: fc, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("weather.fetch_failed", { error: msg, haveCache: !!cached });
    return { forecast: cached, stale: !!cached, error: msg };
  }
}

// ---- Geocoding ----
const GeoSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        admin1: z.string().optional(),
        admin2: z.string().optional(),
        country_code: z.string().optional(),
      }),
    )
    .optional(),
});
export interface Place { name: string; lat: number; lon: number; admin1?: string; admin2?: string; label: string }

/** Open-Meteo only matches native-script names when `language` matches the script (STT gives Devanagari/Telugu). */
export function geocodeLanguage(q: string): "hi" | "te" | "en" {
  if (/[\u0900-\u097F]/.test(q)) return "hi";
  if (/[\u0C00-\u0C7F]/.test(q)) return "te";
  return "en";
}

export async function geocode(query: string): Promise<Place[]> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: "5", language: geocodeLanguage(q), format: "json", countryCode: "IN" })}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const r = GeoSchema.parse(await res.json());
  return (r.results ?? [])
    .filter((x) => !x.country_code || x.country_code === "IN")
    .map((x) => ({
      name: x.name,
      lat: x.latitude,
      lon: x.longitude,
      admin1: x.admin1,
      admin2: x.admin2,
      label: [x.name, x.admin2, x.admin1].filter(Boolean).join(", "),
    }));
}

/** WMO weather code → coarse condition used by scene + speech */
export type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "heavy_rain" | "thunder";
export function conditionOf(code: number, precipMm = 0): Condition {
  if (code >= 95) return "thunder";
  if (code === 65 || code === 82 || precipMm >= 4) return "heavy_rain";
  if ((code >= 61 && code <= 64) || (code >= 80 && code <= 81) || precipMm >= 0.5) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "cloudy";
  if (code === 1 || code === 2) return "partly";
  return "clear";
}
