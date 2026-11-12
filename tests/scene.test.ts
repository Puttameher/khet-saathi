import { describe, expect, it } from "vitest";
import { celestial, moonPhase, rainIntensity, skyLayerOpacity, soilWetness, sunElevation, sunTimes, swayDeg, weatherAt, daylight } from "@/lib/client/scene";
import { istToUtc } from "@/lib/time";
import type { HourPoint } from "@/lib/weather";

const KANPUR = { lat: 26.45, lon: 80.33 };
const ist = (h: number, m = 0) => istToUtc("2026-11-12", h).getTime() + m * 60_000;
const hp = (t: number, o: Partial<HourPoint> = {}): HourPoint => ({ t, tempC: 25, humidity: 60, precipProb: 0, precipMm: 0, weatherCode: 0, cloudCover: 0, windKmh: 5, gustKmh: 10, isDay: true, soilMoisture: null, ...o });

describe("scene: sun", () => {
  it("sunrise/sunset for Kanpur in mid-November land near 06:25 / 17:20 IST", () => {
    const { rise, set } = sunTimes(ist(12), KANPUR.lat, KANPUR.lon);
    expect(Math.abs(rise - ist(6, 25))).toBeLessThan(15 * 60_000);
    expect(Math.abs(set - ist(17, 20))).toBeLessThan(15 * 60_000);
  });
  it("elevation is high at noon, negative at midnight, ~0 at sunrise", () => {
    expect(sunElevation(ist(12), KANPUR.lat, KANPUR.lon)).toBeGreaterThan(40);
    expect(sunElevation(ist(0), KANPUR.lat, KANPUR.lon)).toBeLessThan(-40);
    const { rise } = sunTimes(ist(12), KANPUR.lat, KANPUR.lon);
    expect(Math.abs(sunElevation(rise, KANPUR.lat, KANPUR.lon))).toBeLessThan(1.5);
  });
  it("celestial: sun by day (arc fraction), moon by night", () => {
    const noon = celestial(ist(12), KANPUR.lat, KANPUR.lon);
    expect(noon.body).toBe("sun");
    expect(noon.frac).toBeGreaterThan(0.4);
    expect(noon.frac).toBeLessThan(0.65);
    expect(celestial(ist(22), KANPUR.lat, KANPUR.lon).body).toBe("moon");
    const early = celestial(ist(3), KANPUR.lat, KANPUR.lon);
    expect(early.body).toBe("moon");
    expect(early.frac).toBeGreaterThan(0.5);
  });
  it("moon phase is in [0,1) and full-ish on a known full moon (2026-11-24)", () => {
    const p = moonPhase(Date.UTC(2026, 10, 24, 14));
    expect(p).toBeGreaterThan(0.43);
    expect(p).toBeLessThan(0.57);
  });
});

describe("scene: sky + weather", () => {
  it("sky layers blend monotonically, never hard-cut", () => {
    expect(skyLayerOpacity(-30)).toMatchObject({ night: 1, astro: 0, day: 0 });
    expect(skyLayerOpacity(60)).toMatchObject({ day: 1, golden: 1 });
    const a = skyLayerOpacity(10), b = skyLayerOpacity(10.5);
    expect(Math.abs(a.day - b.day)).toBeLessThan(0.1);
    expect(daylight(-20)).toBe(0);
    expect(daylight(30)).toBe(1);
  });
  it("weatherAt interpolates between hours and returns null outside the forecast", () => {
    const h = [hp(ist(10), { cloudCover: 0, windKmh: 10 }), hp(ist(11), { cloudCover: 100, windKmh: 20, weatherCode: 61, precipMm: 2 })];
    const w = weatherAt(h, ist(10, 30))!;
    expect(w.cloud).toBeCloseTo(0.5, 2);
    expect(w.windKmh).toBeCloseTo(15, 2);
    expect(w.condition).toBe("rain");
    expect(weatherAt(h, ist(20))).toBeNull();
    expect(weatherAt([], ist(10))).toBeNull();
  });
  it("rain intensity grows with mm/h and is zero when dry", () => {
    expect(rainIntensity(0, "clear")).toBe(0);
    expect(rainIntensity(0.2, "drizzle")).toBeLessThan(rainIntensity(3, "rain"));
    expect(rainIntensity(3, "rain")).toBeLessThan(rainIntensity(10, "heavy_rain"));
    expect(rainIntensity(50, "heavy_rain")).toBe(1);
  });
  it("soil wetness uses soil moisture when present, else recent rain", () => {
    expect(soilWetness([hp(ist(10), { soilMoisture: 0.42 })], ist(10))).toBeCloseTo(1, 1);
    expect(soilWetness([hp(ist(9), { precipMm: 10 })], ist(10))).toBeCloseTo(0.5, 2);
  });
  it("sway grows with wind and is capped", () => {
    expect(swayDeg(0)).toBeGreaterThan(0);
    expect(swayDeg(30)).toBeGreaterThan(swayDeg(5));
    expect(swayDeg(200)).toBe(11);
  });
});
