import { describe, expect, it } from "vitest";
import { computeHealth, bandOf, HEALTH_BASE } from "@/lib/health";
import { istToUtc } from "@/lib/time";
import { hours } from "./helpers";

const now = istToUtc("2026-11-12", 9);
const iso = (d: string, h = 10) => istToUtc(d, h).toISOString();

describe("crop care score", () => {
  it("baseline with a fresh check-in and nothing else", () => {
    const r = computeHealth({ now, tasks: [], irrigationLogs: [], lastCheckIn: now.toISOString(), hourly: null });
    expect(r.score).toBe(HEALTH_BASE + 5);
    expect(r.band).toBe("healthy");
    expect(r.label).toMatch(/care score/);
  });
  it("on-time tasks and a recent spray raise the score; factors explain every point", () => {
    const tasks = [
      { type: "spray" as const, status: "done" as const, plannedDate: "2026-11-11", completedAt: iso("2026-11-11") },
      { type: "irrigate" as const, status: "done" as const, plannedDate: "2026-11-10", completedAt: iso("2026-11-10") },
    ];
    const r = computeHealth({ now, tasks, irrigationLogs: [], lastCheckIn: now.toISOString(), hourly: null });
    const sum = r.base + r.factors.reduce((a, f) => a + f.delta, 0);
    expect(r.score).toBe(Math.min(100, sum));
    expect(r.factors.map((f) => f.id)).toEqual(expect.arrayContaining(["onTime", "sprayRecent", "irrigation", "checkIn"]));
    expect(r.factors.find((f) => f.id === "onTime")?.delta).toBe(6);
  });
  it("overdue tasks lower the score (capped)", () => {
    const od = Array.from({ length: 5 }, () => ({ type: "spray" as const, status: "planned" as const, plannedDate: "2026-11-01", completedAt: null }));
    const r = computeHealth({ now, tasks: od, irrigationLogs: [], lastCheckIn: now.toISOString(), hourly: null });
    expect(r.factors.find((f) => f.id === "overdue")?.delta).toBe(-24);
  });
  it("dry stress + heat stress from weather", () => {
    const hourly = hours("2026-11-08", 5, () => ({ tempC: 39, precipMm: 0 }));
    const r = computeHealth({ now, tasks: [], irrigationLogs: [], lastCheckIn: null, hourly });
    expect(r.factors.find((f) => f.id === "dryStress")?.delta).toBe(-8);
    expect(r.factors.find((f) => f.id === "heatStress")?.delta).toBe(-6);
    expect(r.band).not.toBe("healthy");
  });
  it("waterlogging after very heavy rain", () => {
    const hourly = hours("2026-11-10", 3, (_h, d) => (d === 1 ? { precipMm: 3 } : {}));
    const r = computeHealth({ now, tasks: [], irrigationLogs: [iso("2026-11-11")], lastCheckIn: now.toISOString(), hourly });
    expect(r.factors.find((f) => f.id === "waterlog")?.delta).toBe(-5);
  });
  it("stale check-in decays", () => {
    const r = computeHealth({ now, tasks: [], irrigationLogs: [], lastCheckIn: iso("2026-11-02"), hourly: null });
    expect(r.factors.find((f) => f.id === "checkIn")?.delta).toBe(-10);
  });
  it("completing a spray ticks the score up", () => {
    const pending = [{ type: "spray" as const, status: "go_ahead" as const, plannedDate: "2026-11-12", completedAt: null }];
    const before = computeHealth({ now, tasks: pending, irrigationLogs: [], lastCheckIn: now.toISOString(), hourly: null }).score;
    const after = computeHealth({ now, tasks: [{ ...pending[0]!, status: "done" as const, completedAt: now.toISOString() }], irrigationLogs: [], lastCheckIn: now.toISOString(), hourly: null }).score;
    expect(after).toBeGreaterThan(before);
  });
  it("clamps to 0..100 and bands correctly", () => {
    expect(bandOf(70)).toBe("healthy");
    expect(bandOf(69)).toBe("attention");
    expect(bandOf(44)).toBe("risk");
  });
});
