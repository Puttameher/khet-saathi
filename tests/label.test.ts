import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import {
  LabelLlmSchema, confirmLabel, guardLabel, labelSpeech, numbersIn, readLabel, rememberRead, sniffImage, stripJpegMetadata, takeRead,
  type LabelLlm,
} from "@/lib/label";
import type { LlmClient, LlmJsonRequest } from "@/lib/llm";
import { resetDbForTests } from "@/lib/db";
import { createTask, getTask, saveTask } from "@/lib/repo";
import { StoredLabelSchema } from "@/lib/label-view";

const now = new Date("2026-11-13T05:30:00Z");
const RAW = `KRISHIGUARD 50 EC\nInsecticide\nActive ingredient: Chlorpyrifos 50% EC\nCrop: Wheat - Pest: Aphid\nDose: 400 ml per acre in 200 L water\nCrop: Rice - Pest: Stem borer\nDose: 500 ml per acre in 200 L water\nPre-harvest interval: 21 days\nCAUTION - POISON\nKeep away from children and food.\nWear gloves and mask while spraying.`;

const good = (over: Partial<Record<keyof LabelLlm, unknown>> = {}) =>
  LabelLlmSchema.parse({
    readable: true,
    rawText: RAW,
    productName: "KRISHIGUARD 50 EC",
    activeIngredient: "Chlorpyrifos 50% EC",
    cropDoses: [
      { crop: "Wheat", doseText: "400 ml per acre in 200 L water" },
      { crop: "Rice", doseText: "500 ml per acre in 200 L water" },
    ],
    preHarvestInterval: "21 days",
    safetyWarnings: ["Keep away from children and food.", "Wear gloves and mask while spraying."],
    unclearFields: [],
    confidenceNotes: null,
    ...over,
  });

/** LLM double: returns whatever JSON we hand it, validated through the caller's schema like the real client. */
const mockLlm = (out: unknown): LlmClient & { last?: LlmJsonRequest<unknown> } => {
  const c: LlmClient & { last?: LlmJsonRequest<unknown> } = {
    available: () => true,
    async json<T>(req: LlmJsonRequest<T>): Promise<T> {
      c.last = req as LlmJsonRequest<unknown>;
      return req.schema.parse(out);
    },
  };
  return c;
};

// a tiny JPEG-shaped buffer: SOI, APP0(JFIF), APP1(Exif with "GPS"), COM, DQT, SOS + data, EOI
function fakeJpeg(): Uint8Array {
  const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, ascii("JFIF\0\x01\x01")),
    ...seg(0xe1, ascii("Exif\0\0GPS-LAT-17.0-LON-82.2")),
    ...seg(0xfe, ascii("phone model xyz")),
    ...seg(0xdb, [0, 1, 2, 3]),
    ...seg(0xda, [1, 2, 3]), 9, 9, 9, 9,
    0xff, 0xd9,
    ...new Array(1100).fill(0),
  ]);
}

describe("label guard (safety)", () => {
  it("passes a faithful, complete read through as ok", () => {
    const l = guardLabel(good(), { model: "m", now });
    expect(l.status).toBe("ok");
    expect(l.cropDoses).toHaveLength(2);
    expect(l.cropDoses[0]!.doseText).toBe("400 ml per acre in 200 L water");
    expect(l.preHarvestInterval).toBe("21 days");
    expect(l.issues).toEqual([]);
  });

  it("rejects fabricated dose math (numbers not printed on the label)", () => {
    const l = guardLabel(good({ cropDoses: [
      { crop: "Wheat", doseText: "160 ml per bigha in 80 L water" }, // converted from per-acre: not printed
      { crop: "Rice", doseText: "500 ml per acre in 200 L water" },
    ] }), { model: "m", now });
    expect(l.cropDoses.map((d) => d.crop)).toEqual(["Rice"]);
    expect(l.issues).toContain("dropped:dose_0_not_in_printed_text");
    expect(l.status).toBe("partial");
  });

  it("rejects computed / advisory dose text even when numbers are printed", () => {
    for (const doseText of ["400 ml per acre = 2 ml per litre", "400 ml per acre, approximately 1 bottle", "We recommend 400 ml per acre", "you should use 400 ml per acre"]) {
      const l = guardLabel(good({ cropDoses: [{ crop: "Wheat", doseText }] }), { model: "m", now });
      expect(l.cropDoses, doseText).toHaveLength(0);
      expect(l.issues.some((i) => i.startsWith("dropped:dose_0_computed"))).toBe(true);
    }
  });

  it("drops a pre-harvest interval that is not as printed and flags it missing", () => {
    const l = guardLabel(good({ preHarvestInterval: "about 3 weeks (21 days ≈ 3 weeks)" }), { model: "m", now });
    expect(l.preHarvestInterval).toBeNull();
    expect(l.issues).toEqual(expect.arrayContaining(["dropped:phi_not_as_printed", "missing:phi"]));
    const l2 = guardLabel(good({ preHarvestInterval: "30 days" }), { model: "m", now });
    expect(l2.preHarvestInterval).toBeNull();
  });

  it("handles unreadable: model says so → everything blank, status unreadable", () => {
    const l = guardLabel(good({ readable: false }), { model: "m", now });
    expect(l).toMatchObject({ status: "unreadable", productName: null, activeIngredient: null, cropDoses: [], preHarvestInterval: null, safetyWarnings: [] });
    expect(() => confirmLabel(l, now)).toThrow("UNREADABLE");
  });

  it("treats 'readable' with nothing extracted as unreadable (never a blank ok)", () => {
    const l = guardLabel(LabelLlmSchema.parse({ readable: true, productName: "null", activeIngredient: "N/A", cropDoses: [], preHarvestInterval: "unknown" }), { model: "m", now });
    expect(l.status).toBe("unreadable");
  });

  it("missing warnings / unclear fields make the read partial, not ok", () => {
    const l = guardLabel(good({ safetyWarnings: [], unclearFields: ["activeIngredient"] }), { model: "m", now });
    expect(l.status).toBe("partial");
    expect(l.issues).toEqual(expect.arrayContaining(["missing:warnings", "unclear:activeingredient"]));
  });

  it("schema rejects wrong types from the model", () => {
    expect(() => LabelLlmSchema.parse({ readable: "yes" })).toThrow(z.ZodError);
    expect(() => LabelLlmSchema.parse({ readable: true, cropDoses: [{ crop: "Wheat", doseText: 400 }] })).toThrow(z.ZodError);
  });

  it("numbersIn normalises Devanagari digits and thousands separators", () => {
    expect(numbersIn("१,००० मि.ली. / 2.50 L")).toEqual(["1000", "2.5"]);
  });
});

describe("readLabel (LLM mocked)", () => {
  it("sends the image to the vision call with a transcribe-only prompt and guards the output", async () => {
    const c = mockLlm({ ...good(), cropDoses: [{ crop: "Wheat", doseText: "2 ml per litre" }] });
    const l = await readLabel(fakeJpeg(), { client: c, now });
    expect(c.last?.image?.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(c.last?.system).toMatch(/NEVER compute, convert/);
    expect(c.last?.system).toMatch(/NEVER recommend/);
    expect(l.cropDoses).toHaveLength(0); // "2 ml per litre" is not printed → dropped
    expect(l.status).toBe("partial");
  });

  it("strips EXIF/COM before the image leaves the server", async () => {
    const c = mockLlm(good());
    await readLabel(fakeJpeg(), { client: c, now });
    const sent = Buffer.from(c.last!.image!.dataUrl.split(",")[1]!, "base64").toString("latin1");
    expect(sent).not.toContain("GPS-LAT");
    expect(sent).not.toContain("phone model");
    expect(sent).toContain("JFIF");
  });

  it("rejects non-images", async () => {
    await expect(readLabel(new Uint8Array(2000).fill(65), { client: mockLlm(good()) })).rejects.toThrow("BAD_IMAGE");
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(stripJpegMetadata(Uint8Array.from([1, 2, 3]))).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it("propagates an unreadable verdict from the model", async () => {
    const l = await readLabel(fakeJpeg(), { client: mockLlm({ readable: false, confidenceNotes: "blurry" }), now });
    expect(l.status).toBe("unreadable");
  });
});

describe("speech + storage", () => {
  beforeEach(() => { resetDbForTests(); });

  it("speech is framed as what the packet says, keeps PHI, fits the TTS limit", () => {
    const l = guardLabel(good({ safetyWarnings: Array.from({ length: 12 }, (_, i) => `Warning line number ${i} printed on the packet.`) }), { model: "m", now });
    const s = labelSpeech(l, "hi", 600);
    expect(s.startsWith("पैकेट पर लिखा है:")).toBe(true);
    expect(s).toContain("21 days");
    expect(s).toContain("400 ml per acre in 200 L water");
    expect(s.length).toBeLessThanOrEqual(600);
    expect(labelSpeech({ ...l, preHarvestInterval: null, status: "partial" }, "hi")).toMatch(/कटाई से पहले का अंतर पढ़ा नहीं जा सका.*कृषि विज्ञान केंद्र/);
    expect(labelSpeech({ ...l, status: "unreadable" }, "hi")).toMatch(/कृषि विज्ञान केंद्र/);
  });

  it("confirmed label is stored on the task exactly as read (read id is single-use)", () => {
    const task = createTask({ type: "spray", plannedDate: "2026-11-14" }, now);
    const read = guardLabel(good(), { model: "qwen/qwen3.8-27b", now });
    const id = rememberRead(read);
    const taken = takeRead(id)!;
    expect(takeRead(id)).toBeNull();
    saveTask(task, { label: confirmLabel(taken, now) }, now);
    const stored = StoredLabelSchema.parse(getTask(task.id)!.label);
    expect(stored.productName).toBe("KRISHIGUARD 50 EC");
    expect(stored.preHarvestInterval).toBe("21 days");
    expect(stored.confirmedAt).toBe(now.toISOString());
  });
});
