import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { addMessage, listMessages } from "@/lib/repo";

describe("listMessages", () => {
  beforeEach(() => resetDbForTests());
  it("keeps farmer-then-reply order when both share a timestamp", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      addMessage("farmer", `q${i}`, null, now);
      addMessage("saathi", `a${i}`, null, now);
    }
    expect(listMessages(10).map((m) => m.text)).toEqual(["q0", "a0", "q1", "a1", "q2", "a2", "q3", "a3", "q4", "a4"]);
  });
});
