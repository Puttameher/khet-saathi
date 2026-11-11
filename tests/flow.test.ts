/**
 * Definition-of-done flow, end to end through the real conversation, rules,
 * monitor, state machine, DB and health code. Only the network is mocked
 * (Open-Meteo forecast + geocoding). LLM and Gnani are disabled in test env,
 * so this proves the deterministic fast path works on its own.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { handleTurn, buildBriefing } from "@/lib/conversation";
import { runMonitor, runMonitorSlot } from "@/lib/monitor";
import { listTasks, pendingAlerts, getProfile } from "@/lib/repo";
import { buildState } from "@/lib/state";
import { latestDueSlot } from "@/lib/scheduler";
import { istToUtc } from "@/lib/time";
import { hours, openMeteoJson } from "./helpers";

let rainyDays: number[] = [];
const T0 = "2026-11-12";
const fetchMock = vi.fn(async (url: string | URL) => {
  const u = String(url);
  if (u.includes("geocoding-api")) {
    return new Response(JSON.stringify({ results: [{ name: "Kakinada", latitude: 16.99, longitude: 82.25, admin1: "Andhra Pradesh", admin2: "Kakinada", country_code: "IN" }] }));
  }
  if (u.includes("api.open-meteo.com")) {
    const h = hours("2026-11-05", 12, (hr, d) => (rainyDays.includes(d - 7) && hr >= 5 && hr <= 20 ? { precipProb: 90, precipMm: 2.5, weatherCode: 63, cloudCover: 100 } : {}));
    return new Response(JSON.stringify(openMeteoJson(h)));
  }
  return new Response("not mocked", { status: 500 });
});

beforeAll(() => {
  resetDbForTests();
  vi.stubGlobal("fetch", fetchMock);
});

describe("voice-to-task flow (text transcripts)", () => {
  const day0 = istToUtc(T0, 8);

  it("onboards by voice answers and confirms the read-back", async () => {
    const steps = ["gehun hai", "20 din pehle", "do ekad", "Peddada, Kakinada", "borewell se"];
    let last = "";
    for (const s of steps) last = (await handleTurn(s, { now: day0, lang: "hi" })).reply;
    expect(last).toContain("क्या यह सही है");
    expect(last).toContain("गेहूं");
    const done = await handleTurn("haan sahi hai", { now: day0, lang: "hi" });
    expect(done.onboarding?.done).toBe(true);
    const p = getProfile();
    expect(p.crop).toBe("wheat");
    expect(p.sowingDate).toBe("2026-10-23");
    expect(p.landSize).toBe(2);
    expect(p.irrigation).toBe("borewell");
    expect(p.lat).toBeCloseTo(16.99);
  });

  it("'parson spray karna hai' creates a task and confirms with a verdict", async () => {
    const r = await handleTurn("parson spray karna hai", { now: day0 });
    expect(r.actions[0]?.kind).toBe("task_created");
    expect(r.reply).toContain("परसों स्प्रे लिख लिया");
    const t = listTasks()[0]!;
    expect(t.plannedDate).toBe("2026-11-14");
    expect(t.status).toBe("go_ahead");
  });

  it("the monitor later flags rain → skip_suggested + exactly one alert", async () => {
    rainyDays = [2]; // 2026-11-14
    const later = istToUtc(T0, 18);
    const s1 = await runMonitor({ now: later, force: true });
    expect(s1.alertsCreated).toBe(1);
    const s2 = await runMonitor({ now: later, force: true });
    expect(s2.alertsCreated).toBe(0); // dedupe
    expect(listTasks()[0]!.status).toBe("skip_suggested");
    expect(pendingAlerts()[0]!.message).toContain("मत कीजिए");
  });

  it("scheduler slots are idempotent", async () => {
    const at = istToUtc(T0, 12, 5);
    const key = latestDueSlot(at, ["06:00", "12:00", "18:00"])!;
    expect(key).toBe("2026-11-12@12:00");
    const a = await runMonitorSlot(key, at);
    const b = await runMonitorSlot(key, at);
    expect(a.skipped).toBeUndefined();
    expect(b.skipped).toBe("already_ran");
  });

  it("next morning's briefing says to skip and names a better time", async () => {
    const morning = istToUtc("2026-11-13", 7);
    const b = await buildBriefing(morning);
    expect(b.text).toContain("कल स्प्रे मत कीजिए");
    expect(b.text).toMatch(/अगला अच्छा समय/);
    expect(b.alertIds.length).toBe(1);
  });

  it("farmer reschedules by voice in the check-in", async () => {
    const morning = istToUtc("2026-11-13", 7, 1);
    const r = await handleTurn("parson kar dunga", { now: morning, mode: "checkin" });
    expect(r.actions[0]?.kind).toBe("task_rescheduled");
    const t = listTasks()[0]!;
    expect(t.plannedDate).toBe("2026-11-15");
    expect(t.status).toBe("go_ahead");
    expect(pendingAlerts().length).toBe(0);
  });

  it("'spray kar raha hoon' then 'spray ho gaya' → done, celebration, health up", async () => {
    const d = istToUtc("2026-11-15", 8);
    const before = (await buildState(d)).health.score;
    expect((await handleTurn("spray kar raha hoon", { now: d })).actions[0]?.kind).toBe("task_started");
    expect(listTasks()[0]!.status).toBe("in_progress");
    const done = await handleTurn("spray ho gaya", { now: istToUtc("2026-11-15", 10) });
    expect(done.celebrate).toBe(true);
    expect(listTasks()[0]!.status).toBe("done");
    const after = (await buildState(istToUtc("2026-11-15", 10))).health;
    expect(after.score).toBeGreaterThan(before);
    expect(after.factors.find((f) => f.id === "sprayRecent")).toBeTruthy();
  });

  it("asks are answered from the rules engine, not guessed", async () => {
    rainyDays = [4]; // 2026-11-16
    const r = await handleTurn("kal spray kar sakta hoon?", { now: istToUtc("2026-11-15", 11) });
    expect(r.intent?.kind).toBe("ask");
    expect(r.reply).toContain("मत कीजिए");
  });

  it("weather outage → never fabricates, keeps cached data", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("down", { status: 503 }));
    const s = await buildState(istToUtc("2026-11-15", 12), { force: true });
    expect(s.weather?.stale).toBe(true);
    expect(s.weather?.fetchedAt).toBeTruthy();
  });
});
