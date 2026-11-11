import { describe, expect, it } from "vitest";
import { addDays, diffDays, istDateKey, istHour, istToUtc, resolveRelativeDate } from "@/lib/time";

// 2026-11-12 00:30 IST == 2026-11-11 19:00 UTC — the classic off-by-one trap
const nearMidnight = new Date("2026-11-11T19:00:00Z");
const noon = new Date("2026-11-12T06:30:00Z"); // 12:00 IST, Thursday

describe("IST date basics", () => {
  it("uses IST, not UTC, for the calendar day", () => {
    expect(istDateKey(nearMidnight)).toBe("2026-11-12");
    expect(istHour(nearMidnight)).toBe(0);
  });
  it("istToUtc round-trips", () => {
    expect(istToUtc("2026-11-12", 6).toISOString()).toBe("2026-11-12T00:30:00.000Z");
    expect(istDateKey(istToUtc("2026-11-12", 23, 59))).toBe("2026-11-12");
  });
  it("addDays crosses month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2027-01-02", "2026-12-31")).toBe(2);
  });
});

describe("resolveRelativeDate", () => {
  const cases: [string, string][] = [
    ["parson spray karna hai", "2026-11-14"],
    ["परसों स्प्रे करना है", "2026-11-14"],
    ["kal paani dena hai", "2026-11-13"],
    ["कल पानी देना है", "2026-11-13"],
    ["aaj khad dalna hai", "2026-11-12"],
    ["narson katai", "2026-11-15"],
    ["day after tomorrow", "2026-11-14"],
    ["repu mandu kottali", "2026-11-13"],
    ["ఎల్లుండి మందు కొట్టాలి", "2026-11-14"],
    ["ఈరోజు నీరు పెట్టాలి", "2026-11-12"],
    ["3 din baad", "2026-11-15"],
    ["teen din mein", "2026-11-15"],
    ["somvar ko spray", "2026-11-16"],
    ["guruvar", "2026-11-19"], // said on a Thursday → next Thursday
    ["సోమవారం", "2026-11-16"],
    ["20 tarikh ko", "2026-11-20"],
    ["5 tarikh", "2026-12-05"],
    ["2026-11-30", "2026-11-30"],
    ["agle hafte", "2026-11-19"],
  ];
  for (const [input, want] of cases) {
    it(`${input} → ${want}`, () => expect(resolveRelativeDate(input, noon)?.dateKey).toBe(want));
  }
  it("is correct just after IST midnight (UTC still previous day)", () => {
    expect(resolveRelativeDate("kal", nearMidnight)?.dateKey).toBe("2026-11-13");
    expect(resolveRelativeDate("parson", nearMidnight)?.dateKey).toBe("2026-11-14");
  });
  it("does not match 'kal' inside other words", () => {
    expect(resolveRelativeDate("kalpana se baat", noon)).toBeNull();
  });
  it("detects part of day", () => {
    const r = resolveRelativeDate("kal subah spray", noon);
    expect(r?.dateKey).toBe("2026-11-13");
    expect(r?.partOfDay).toBe("morning");
    expect(resolveRelativeDate("parson shaam ko", noon)?.partOfDay).toBe("evening");
  });
  it("returns null when there is no date (never guesses)", () => {
    expect(resolveRelativeDate("spray karna hai", noon)).toBeNull();
    expect(resolveRelativeDate("", noon)).toBeNull();
  });
});
