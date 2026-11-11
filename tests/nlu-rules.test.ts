import { describe, expect, it } from "vitest";
import { parseIntentRules, parseLand, parseIrrigation, parsePastOrDate, detectTaskType } from "@/lib/nlu-rules";
import { matchCrop } from "@/lib/config";

const now = new Date("2026-11-12T06:30:00Z");
const ctx = (activeTypes: ("spray" | "irrigate")[] = [], focusType: "spray" | null = null, mode: "talk" | "checkin" = "talk") => ({ activeTypes, focusType, mode });

describe("intent rules", () => {
  it.each([
    ["parson spray karna hai", "create_task", "spray"],
    ["परसों स्प्रे करना है", "create_task", "spray"],
    ["kal paani dena hai", "create_task", "irrigate"],
    ["ఎల్లుండి మందు కొట్టాలి", "create_task", "spray"],
    ["urea dalna hai somvar ko", "create_task", "fertilize"],
  ])("%s → %s/%s", (text, kind, type) => {
    const r = parseIntentRules(text, ctx(), now);
    expect(r.kind).toBe(kind);
    expect(r.taskType).toBe(type);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("spray ho gaya → complete", () => {
    expect(parseIntentRules("spray ho gaya", ctx(["spray"]), now).kind).toBe("complete_task");
    expect(parseIntentRules("స్ప్రే అయిపోయింది", ctx(["spray"]), now).kind).toBe("complete_task");
  });
  it("paani de diya without an irrigation task → log irrigation", () => {
    expect(parseIntentRules("paani de diya", ctx(["spray"]), now).kind).toBe("log_irrigation");
  });
  it("check-in reschedule: 'kal kar dunga' uses the task being discussed", () => {
    const r = parseIntentRules("kal kar dunga", ctx(["spray"], "spray", "checkin"), now);
    expect(r.kind).toBe("reschedule_task");
    expect(r.taskType).toBe("spray");
    expect(r.datePhrase).toBe("kal");
  });
  it("theek hai → keep", () => expect(parseIntentRules("theek hai", ctx(["spray"], "spray"), now).kind).toBe("keep"));
  it("spray kar raha hoon → start", () => expect(parseIntentRules("spray kar raha hoon", ctx(["spray"]), now).kind).toBe("start_task"));
  it("questions route to ask with a topic", () => {
    const r = parseIntentRules("kal spray kar sakta hoon?", ctx(), now);
    expect(r.kind).toBe("ask");
    expect(r.askTopic).toBe("can_do_task");
    expect(parseIntentRules("paani dena chahiye?", ctx(), now).askTopic).toBe("should_irrigate");
    expect(parseIntentRules("kal mausam kaisa hai", ctx(), now).askTopic).toBe("weather");
  });
  it("cancel", () => expect(parseIntentRules("spray nahi karna", ctx(["spray"]), now).kind).toBe("cancel_task"));
  it("gibberish is unknown with low confidence", () => {
    const r = parseIntentRules("haan bhai kaisa chal raha sab", ctx(), now);
    expect(r.confidence).toBeLessThan(0.8);
  });
  it("task type lexicon", () => {
    expect(detectTaskType("dawai chhidakni hai")).toBe("spray");
    expect(detectTaskType("కోత మొదలు")).toBe("harvest");
  });
});

describe("onboarding slot parsers", () => {
  it("crop aliases", () => {
    expect(matchCrop("mere khet mein gehun hai")).toBe("wheat");
    expect(matchCrop("धान")).toBe("rice");
    expect(matchCrop("ఉల్లి పంట")).toBe("onion");
    expect(matchCrop("ganna")).toBeNull();
  });
  it("land", () => {
    expect(parseLand("do ekad")).toEqual({ size: 2, unit: "acre" });
    expect(parseLand("5 बीघा")).toEqual({ size: 5, unit: "bigha" });
    expect(parseLand("రెండు ఎకరాలు")).toEqual({ size: 2, unit: "acre" });
    expect(parseLand("dhai acre")).toEqual({ size: 2.5, unit: "acre" });
    expect(parseLand("bahut zameen")).toBeNull();
  });
  it("irrigation", () => {
    expect(parseIrrigation("borewell se")).toBe("borewell");
    expect(parseIrrigation("नहर")).toBe("canal");
    expect(parseIrrigation("barish pe")).toBe("rainfed");
    expect(parseIrrigation("బోరు")).toBe("borewell");
  });
  it("sowing in the past", () => {
    expect(parsePastOrDate("20 din pehle", now)).toBe("2026-10-23");
    expect(parsePastOrDate("do mahine pehle", now)).toBe("2026-09-12");
    expect(parsePastOrDate("ఇరవై రోజుల క్రితం", now)).toBe("2026-10-23");
    expect(parsePastOrDate("kuch samay pehle", now)).toBeNull(); // vague → refuse, LLM/farmer clarifies
    expect(parsePastOrDate("15 roju kritam", now)).toBe("2026-10-28");
  });
});
