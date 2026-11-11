import { describe, expect, it } from "vitest";
import { canTransition, transition, type Task } from "@/lib/tasks";

const now = new Date("2026-11-12T03:00:00Z");
const base: Task = { id: "t1", type: "spray", plannedDate: "2026-11-14", partOfDay: null, notes: null, status: "planned", history: [], startedAt: null, completedAt: null };
const run = (t: Task, ...evs: Parameters<typeof transition>[1][]) => evs.reduce((acc, e) => { const r = transition(acc, e, now); if (!r.ok) throw new Error(r.error); return r.task; }, t);

describe("task state machine", () => {
  it("planned → go_ahead → in_progress → done (timestamps + history)", () => {
    const t = run(base, { type: "VERDICT", verdict: "GO" }, { type: "START" }, { type: "COMPLETE" });
    expect(t.status).toBe("done");
    expect(t.startedAt).toBe(now.toISOString());
    expect(t.completedAt).toBe(now.toISOString());
    expect(t.history.map((h) => h.to)).toEqual(["go_ahead", "in_progress", "done"]);
  });
  it("verdict WAIT and SKIP both map to skip_suggested; GO flips back", () => {
    expect(run(base, { type: "VERDICT", verdict: "WAIT" }).status).toBe("skip_suggested");
    expect(run(base, { type: "VERDICT", verdict: "SKIP_TODAY" }).status).toBe("skip_suggested");
    expect(run(base, { type: "VERDICT", verdict: "SKIP_TODAY" }, { type: "VERDICT", verdict: "GO" }).status).toBe("go_ahead");
  });
  it("UNKNOWN verdict returns to neutral planned", () => {
    expect(run(base, { type: "VERDICT", verdict: "GO" }, { type: "VERDICT", verdict: "UNKNOWN" }).status).toBe("planned");
  });
  it("repeated identical verdicts are no-ops (no history spam)", () => {
    const t = run(base, { type: "VERDICT", verdict: "GO" }, { type: "VERDICT", verdict: "GO" });
    expect(t.history.length).toBe(1);
    const r = transition(t, { type: "VERDICT", verdict: "GO" }, now);
    expect(r.ok && r.changed).toBe(false);
  });
  it("verdicts don't move in_progress or postponed tasks", () => {
    const ip = run(base, { type: "START" });
    expect(run(ip, { type: "VERDICT", verdict: "SKIP_TODAY" }).status).toBe("in_progress");
    const pp = run(base, { type: "POSTPONE" });
    expect(run(pp, { type: "VERDICT", verdict: "GO" }).status).toBe("postponed");
  });
  it("'spray ho gaya' completes directly from skip_suggested", () => {
    expect(run(base, { type: "VERDICT", verdict: "SKIP_TODAY" }, { type: "COMPLETE" }).status).toBe("done");
  });
  it("reschedule moves the date and resets to planned", () => {
    const t = run(base, { type: "VERDICT", verdict: "SKIP_TODAY" }, { type: "RESCHEDULE", date: "2026-11-15" });
    expect(t.status).toBe("planned");
    expect(t.plannedDate).toBe("2026-11-15");
    expect(t.history.at(-1)?.detail).toBe("2026-11-14→2026-11-15");
  });
  it("postponed can be rescheduled", () => {
    expect(run(base, { type: "POSTPONE" }, { type: "RESCHEDULE", date: "2026-11-20" }).status).toBe("planned");
  });
  it("terminal states reject everything", () => {
    const done = run(base, { type: "COMPLETE" });
    for (const ev of [{ type: "START" }, { type: "COMPLETE" }, { type: "CANCEL" }, { type: "RESCHEDULE", date: "2026-11-20" }] as const) {
      const r = transition(done, ev, now);
      expect(r.ok).toBe(false);
    }
    const cancelled = run(base, { type: "CANCEL" });
    expect(canTransition(cancelled.status, { type: "START" })).toBe(false);
  });
  it("cannot START a postponed task without rescheduling", () => {
    expect(transition(run(base, { type: "POSTPONE" }), { type: "START" }, now).ok).toBe(false);
  });
  it("is pure (does not mutate input)", () => {
    const copy = structuredClone(base);
    transition(base, { type: "START" }, now);
    expect(base).toEqual(copy);
  });
});
