import { describe, expect, it } from "vitest";
import { evaluateTask, checkSprayWindow, evaluationSignature, sprayStrip } from "@/lib/rules";
import { RULES } from "@/lib/config";
import { istHour, istToUtc } from "@/lib/time";
import { hours } from "./helpers";

const now = istToUtc("2026-11-12", 6); // 06:00 IST
const day = "2026-11-12";

describe("spray rules engine", () => {
  it("GO on a calm dry day, with a window starting at day start", () => {
    const e = evaluateTask({ type: "spray", plannedDate: day }, hours(day, 3), RULES, now);
    expect(e.verdict).toBe("GO");
    expect(e.reasons[0]?.code).toBe("CLEAR");
    expect(istHour(new Date(e.window!.start))).toBe(RULES.dayStartHour);
  });

  it("SKIP_TODAY when it rains all day, suggests the next clean window tomorrow", () => {
    const fc = hours(day, 3, (_h, d) => (d === 0 ? { precipProb: 90, precipMm: 1.5, weatherCode: 63 } : {}));
    const e = evaluateTask({ type: "spray", plannedDate: day }, fc, RULES, now);
    expect(e.verdict).toBe("SKIP_TODAY");
    expect(e.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["RAIN_PROB", "RAIN_MM"]));
    expect(e.suggestedWindow).not.toBeNull();
    expect(new Date(e.suggestedWindow!.start).getTime()).toBeGreaterThanOrEqual(istToUtc("2026-11-13", 0).getTime());
  });

  it("WAIT when morning is windy but afternoon is calm, suggests the afternoon", () => {
    const fc = hours(day, 2, (h, d) => (d === 0 && h < 11 ? { windKmh: 20 } : {}));
    const e = evaluateTask({ type: "spray", plannedDate: day }, fc, RULES, now);
    expect(e.verdict).toBe("WAIT");
    expect(e.reasons.find((r) => r.code === "WIND")?.value).toBe(20);
    expect(istHour(new Date(e.suggestedWindow!.start))).toBeGreaterThanOrEqual(10);
  });

  it("rain arriving 4h after spraying still blocks (rain-fast window)", () => {
    const fc = hours(day, 2, (h, d) => (d === 0 && h >= 6 && h <= 18 && h % 5 === 0 ? { precipProb: 80, precipMm: 3 } : {}));
    const e = evaluateTask({ type: "spray", plannedDate: day, partOfDay: "morning" }, fc, RULES, now);
    expect(e.verdict).not.toBe("GO");
  });

  it("thunderstorm codes are always skip-level", () => {
    const r = checkSprayWindow(hours(day, 1, (h) => (h === 8 ? { weatherCode: 95 } : {})).slice(6, 12), RULES);
    expect(r.find((x) => x.code === "THUNDER")?.severity).toBe("skip");
  });

  it("heat at application time is flagged", () => {
    const r = checkSprayWindow(hours(day, 1, () => ({ tempC: 39 })).slice(10, 16), RULES);
    expect(r.find((x) => x.code === "HEAT")?.severity).toBe("skip");
  });

  it("high humidity adds an informational fungal flag without blocking", () => {
    const e = evaluateTask({ type: "spray", plannedDate: day }, hours(day, 2, () => ({ humidity: 92 })), RULES, now);
    expect(e.verdict).toBe("GO");
    expect(e.reasons.find((r) => r.code === "FUNGAL_RISK")?.severity).toBe("info");
  });

  it("respects preferred part of day", () => {
    const e = evaluateTask({ type: "spray", plannedDate: day, partOfDay: "evening" }, hours(day, 2), RULES, now);
    expect(istHour(new Date(e.window!.start))).toBe(16);
  });

  it("UNKNOWN when the planned day is beyond the forecast (refuses to guess)", () => {
    const e = evaluateTask({ type: "spray", plannedDate: "2026-11-25" }, hours(day, 3), RULES, now);
    expect(e.verdict).toBe("UNKNOWN");
    expect(e.reasons[0]?.code).toBe("NO_FORECAST");
  });

  it("UNKNOWN with no forecast at all", () => {
    expect(evaluateTask({ type: "spray", plannedDate: day }, null, RULES, now).verdict).toBe("UNKNOWN");
  });

  it("does not consider windows that already passed", () => {
    const late = istToUtc(day, 15);
    const fc = hours(day, 2, (h, d) => (d === 0 && h >= 15 ? { precipProb: 90, precipMm: 2 } : {}));
    const e = evaluateTask({ type: "spray", plannedDate: day }, fc, RULES, late);
    expect(e.verdict).not.toBe("GO");
  });

  it("irrigation: skip when ≥10 mm rain expected in 24h", () => {
    const fc = hours(day, 2, (h, d) => (d === 0 && h >= 12 && h < 17 ? { precipMm: 3, precipProb: 90 } : {}));
    const e = evaluateTask({ type: "irrigate", plannedDate: day }, fc, RULES, now);
    expect(e.verdict).toBe("SKIP_TODAY");
    expect(e.reasons[0]?.code).toBe("RAIN_24H");
  });

  it("irrigation: GO when dry", () => {
    expect(evaluateTask({ type: "irrigate", plannedDate: day }, hours(day, 2), RULES, now).verdict).toBe("GO");
  });

  it("harvest ignores wind but not rain", () => {
    const windy = hours(day, 2, () => ({ windKmh: 30 }));
    expect(evaluateTask({ type: "harvest", plannedDate: day }, windy, RULES, now).verdict).toBe("GO");
    const wet = hours(day, 2, (_h, d) => (d === 0 ? { precipProb: 95, precipMm: 3 } : {}));
    expect(evaluateTask({ type: "harvest", plannedDate: day }, wet, RULES, now).verdict).toBe("SKIP_TODAY");
  });

  it("'other' tasks have no weather rule", () => {
    expect(evaluateTask({ type: "other", plannedDate: day }, hours(day, 2), RULES, now).reasons[0]?.code).toBe("NO_RULE");
  });

  it("is deterministic and signature is stable", () => {
    const fc = hours(day, 3, (_h, d) => (d === 0 ? { precipProb: 90, precipMm: 1.5 } : {}));
    const a = evaluateTask({ type: "spray", plannedDate: day }, fc, RULES, now);
    const b = evaluateTask({ type: "spray", plannedDate: day }, fc, RULES, now);
    expect(a).toEqual(b);
    expect(evaluationSignature(a)).toBe("2026-11-12:SKIP_TODAY:RAIN_MM+RAIN_PROB");
  });

  it("spray strip marks night hours as not sprayable", () => {
    const s = sprayStrip(hours(day, 3), RULES, now.getTime(), 24);
    expect(s.length).toBe(24);
    expect(s.find((x) => istHour(new Date(x.t)) === 22)?.sev).toBe("skip");
    expect(s.find((x) => istHour(new Date(x.t)) === 9)?.sev).toBe("ok");
  });
});
