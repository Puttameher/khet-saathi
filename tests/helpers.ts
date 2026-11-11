import type { HourPoint, Forecast } from "@/lib/weather";
import { addDays, istToUtc, type DateKey } from "@/lib/time";

export function hours(fromDay: DateKey, days: number, f: (h: number, dayIdx: number) => Partial<HourPoint> = () => ({})): HourPoint[] {
  const out: HourPoint[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      out.push({
        t: istToUtc(addDays(fromDay, d), h).getTime(),
        tempC: 26, humidity: 60, precipProb: 5, precipMm: 0, weatherCode: 1, cloudCover: 20, windKmh: 6, gustKmh: 12,
        isDay: h >= 6 && h < 18, soilMoisture: 0.25,
        ...f(h, d),
      });
    }
  }
  return out;
}

/** Open-Meteo-shaped JSON (unixtime) for fetch mocks */
export function openMeteoJson(hourly: HourPoint[]) {
  const days = [...new Set(hourly.map((h) => new Date(h.t + 330 * 60000).toISOString().slice(0, 10)))];
  return {
    latitude: 17.0, longitude: 82.2,
    current: { time: hourly[0]!.t / 1000, temperature_2m: 26, relative_humidity_2m: 60, weather_code: 1, cloud_cover: 20, wind_speed_10m: 6, is_day: 1 },
    hourly: {
      time: hourly.map((h) => h.t / 1000),
      temperature_2m: hourly.map((h) => h.tempC),
      relative_humidity_2m: hourly.map((h) => h.humidity),
      precipitation_probability: hourly.map((h) => h.precipProb),
      precipitation: hourly.map((h) => h.precipMm),
      weather_code: hourly.map((h) => h.weatherCode),
      cloud_cover: hourly.map((h) => h.cloudCover),
      wind_speed_10m: hourly.map((h) => h.windKmh),
      wind_gusts_10m: hourly.map((h) => h.gustKmh),
      is_day: hourly.map((h) => (h.isDay ? 1 : 0)),
      soil_moisture_0_to_1cm: hourly.map((h) => h.soilMoisture),
    },
    daily: {
      time: days.map((d) => istToUtc(d, 0).getTime() / 1000),
      sunrise: days.map((d) => istToUtc(d, 6, 15).getTime() / 1000),
      sunset: days.map((d) => istToUtc(d, 17, 40).getTime() / 1000),
      temperature_2m_max: days.map((d) => Math.max(...hourly.filter((h) => new Date(h.t + 330 * 60000).toISOString().startsWith(d)).map((h) => h.tempC))),
      temperature_2m_min: days.map(() => 18),
      precipitation_sum: days.map((d) => hourly.filter((h) => new Date(h.t + 330 * 60000).toISOString().startsWith(d)).reduce((a, h) => a + h.precipMm, 0)),
      precipitation_probability_max: days.map((d) => Math.max(...hourly.filter((h) => new Date(h.t + 330 * 60000).toISOString().startsWith(d)).map((h) => h.precipProb ?? 0))),
      weather_code: days.map((d) => Math.max(...hourly.filter((h) => new Date(h.t + 330 * 60000).toISOString().startsWith(d)).map((h) => h.weatherCode))),
    },
  };
}
export type { Forecast };
