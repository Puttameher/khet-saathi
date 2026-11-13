/**
 * Pesticide / fertilizer packet label reading (SPEC P1 #10).
 *
 * HARD SAFETY RULES (enforced here, not just in the prompt):
 *  - Only text PRINTED on the packet is returned. The model is told to transcribe, never
 *    compute, convert or recommend. `guardLabel` then drops any dose / PHI line whose numbers
 *    do not appear in the model's own verbatim transcription (`rawText`), or that contains
 *    arithmetic / conversion / advice language. Dropped lines are reported, never silently fixed.
 *  - Unreadable or partial reads are surfaced as such, with advice to check the packet or the
 *    local Krishi Vigyan Kendra (KVK). We never fill a gap.
 *  - We never recommend a product; the speech text only says "पैकेट पर लिखा है…".
 */
import crypto from "node:crypto";
import { z } from "zod";
import { llm, LLM_VISION_MODEL, type LlmClient } from "@/lib/llm";

/** Server-side upload cap (client downsizes to ≤1600px JPEG, typically 200–600 KB). */
export const LABEL_MAX_BYTES = 4_000_000;

const str = (max: number) => z.string().trim().max(max);
const nullableStr = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? "").trim();
      return s && !/^(null|n\/a|na|none|unknown|not (printed|visible|readable)|-)$/i.test(s) ? s.slice(0, max) : null;
    });

/** What the vision model must return. Lenient on shape, strict on types. */
export const LabelLlmSchema = z.object({
  readable: z.boolean(),
  rawText: z.string().max(6000).optional().default(""),
  productName: nullableStr(120),
  activeIngredient: nullableStr(200),
  cropDoses: z
    .array(z.object({ crop: nullableStr(80), doseText: str(300) }))
    .max(20)
    .optional()
    .default([]),
  preHarvestInterval: nullableStr(160),
  safetyWarnings: z.array(str(240)).max(20).optional().default([]),
  unclearFields: z.array(str(80)).max(20).optional().default([]),
  confidenceNotes: nullableStr(400),
});
export type LabelLlm = z.infer<typeof LabelLlmSchema>;

export { LabelStatus, LabelReadSchema, StoredLabelSchema, labelSpeech, type LabelRead, type StoredLabel } from "@/lib/label-view";
import { LabelReadSchema, StoredLabelSchema, type LabelRead, type StoredLabel } from "@/lib/label-view";

export const LABEL_SYSTEM = `You transcribe agricultural chemical / fertilizer packet labels from a photo for an Indian farmer.
Extract ONLY text that is literally printed and legible on the packet. You are a transcriber, not an advisor.
Rules:
- Copy dose text VERBATIM, exactly as printed (same numbers, same units, same language/script). One entry per crop as printed.
- NEVER compute, convert, scale, round, translate units, or recommend a dose. Never add per-bigha/per-tank/per-litre figures that are not printed.
- NEVER recommend or name any product that is not printed on this packet.
- If a field is not printed, cut off, blurry or you are unsure, set it to null and add its name to unclearFields. Do not guess.
- If the image is not a product label or the text cannot be read, set readable=false and leave other fields null/empty.
- rawText: a verbatim transcription of all legible text on the label (line breaks as \\n).
- safetyWarnings: each printed caution/warning/first-aid line verbatim.
Return JSON exactly in this shape:
{"readable":boolean,"rawText":string,"productName":string|null,"activeIngredient":string|null,
"cropDoses":[{"crop":string|null,"doseText":string}],"preHarvestInterval":string|null,
"safetyWarnings":[string],"unclearFields":[string],"confidenceNotes":string|null}`;

// ---------- safety guard ----------

/** Language that signals the model did maths, converted units or gave advice. */
const COMPUTED_OR_ADVICE =
  /(=|≈|×|\bequals?\b|\bapprox(imately)?\b|\bconvert(ed|s)?\b|\bwhich is\b|\bi\.e\.|\bthat means\b|\btherefore\b|\bso you\b|\byou (should|need|can)\b|\brecommend(ed|s)?\b|\bsuggest(ed|s)?\b|\bbest\b|\bcalculated?\b|सलाह|उपयोग करें\s*$)/i;

/** Numbers (with decimals) appearing in a string, normalised (1,000 → 1000; Devanagari digits → ASCII). */
export function numbersIn(s: string): string[] {
  const ascii = s
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[౦-౯]/g, (d) => String(d.charCodeAt(0) - 0x0c66))
    .replace(/(\d),(\d{3})/g, "$1$2");
  return (ascii.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/** Every number in `line` must also be printed somewhere in the transcription. */
function numbersGrounded(line: string, raw: string): boolean {
  if (!raw.trim()) return true; // no transcription to compare against → cannot check; other guards still apply
  const rawNums = new Set(numbersIn(raw));
  return numbersIn(line).every((n) => rawNums.has(n));
}

export function guardLabel(x: LabelLlm, meta: { model: string; now?: Date }): LabelRead {
  const readAt = (meta.now ?? new Date()).toISOString();
  const issues = new Set<string>(x.unclearFields.map((f) => `unclear:${f.toLowerCase().replace(/\s+/g, "_")}`));
  const base = { model: meta.model, readAt, confidenceNotes: x.confidenceNotes };

  const unreadable = (): LabelRead => ({
    ...base,
    status: "unreadable",
    productName: null,
    activeIngredient: null,
    cropDoses: [],
    preHarvestInterval: null,
    safetyWarnings: [],
    issues: [...issues, "unreadable"],
  });
  if (!x.readable) return unreadable();

  const raw = x.rawText;
  const cropDoses: LabelRead["cropDoses"] = [];
  x.cropDoses.forEach((d, i) => {
    const line = `${d.crop ?? ""} ${d.doseText}`;
    if (!d.doseText) return;
    if (COMPUTED_OR_ADVICE.test(d.doseText)) { issues.add(`dropped:dose_${i}_computed_or_advice`); return; }
    if (!numbersGrounded(line, raw)) { issues.add(`dropped:dose_${i}_not_in_printed_text`); return; }
    cropDoses.push({ crop: d.crop, doseText: d.doseText });
  });

  let phi = x.preHarvestInterval;
  if (phi && (COMPUTED_OR_ADVICE.test(phi) || !numbersGrounded(phi, raw))) {
    issues.add("dropped:phi_not_as_printed");
    phi = null;
  }
  const safetyWarnings = x.safetyWarnings.filter((w) => w && !/\brecommend|\bsuggest|सलाह/i.test(w));
  if (safetyWarnings.length < x.safetyWarnings.length) issues.add("dropped:warning_advice");

  if (!x.productName && !x.activeIngredient && cropDoses.length === 0 && !phi) return unreadable();

  if (!phi) issues.add("missing:phi");
  if (safetyWarnings.length === 0) issues.add("missing:warnings");
  if (cropDoses.length === 0) issues.add("missing:dose");
  if (!x.productName) issues.add("missing:product");
  if (!x.activeIngredient) issues.add("missing:active_ingredient");

  return {
    ...base,
    status: issues.size ? "partial" : "ok",
    productName: x.productName,
    activeIngredient: x.activeIngredient,
    cropDoses,
    preHarvestInterval: phi,
    safetyWarnings,
    issues: [...issues],
  };
}

// ---------- image handling ----------

export type ImageKind = "jpeg" | "png" | "webp";
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

/**
 * Remove APP1 (EXIF/XMP, may carry GPS) and COM segments from a JPEG. The browser already
 * re-encodes through a canvas (which drops EXIF); this covers direct API uploads.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  if (sniffImage(b) !== "jpeg") return b;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // malformed: leave untouched
    const marker = b[i + 1]!;
    if (marker === 0xda) { // start of scan: rest is image data
      for (let j = i; j < b.length; j++) out.push(b[j]!);
      return Uint8Array.from(out);
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return b;
    if (marker !== 0xe1 && marker !== 0xfe) for (let j = i; j < i + 2 + len; j++) out.push(b[j]!);
    i += 2 + len;
  }
  return b;
}

// ---------- read (LLM) ----------

export async function readLabel(image: Uint8Array, deps: { client?: LlmClient; now?: Date } = {}): Promise<LabelRead> {
  const kind = sniffImage(image);
  if (!kind) throw new Error("BAD_IMAGE");
  const clean = kind === "jpeg" ? stripJpegMetadata(image) : image;
  const dataUrl = `data:image/${kind};base64,${Buffer.from(clean).toString("base64")}`;
  const client = deps.client ?? llm;
  const out = await client.json({
    name: "label_read",
    system: LABEL_SYSTEM,
    user: "Transcribe this packet label as JSON. Printed text only; null for anything not clearly printed.",
    schema: LabelLlmSchema,
    image: { dataUrl },
    maxTokens: 1400,
  });
  return guardLabel(out, { model: LLM_VISION_MODEL(), now: deps.now });
}

// ---------- pending reads (so the stored label is exactly what the model read) ----------

const g = globalThis as unknown as { __ksLabelReads?: Map<string, { label: LabelRead; at: number }> };
const reads = (g.__ksLabelReads ??= new Map());
const READ_TTL_MS = 30 * 60_000;

export function rememberRead(label: LabelRead, now = Date.now()): string {
  for (const [k, v] of reads) if (now - v.at > READ_TTL_MS) reads.delete(k);
  const id = crypto.randomUUID();
  reads.set(id, { label, at: now });
  return id;
}
export function takeRead(id: string, now = Date.now()): LabelRead | null {
  const r = reads.get(id);
  if (!r || now - r.at > READ_TTL_MS) return null;
  reads.delete(id);
  return r.label;
}

export function confirmLabel(label: LabelRead, now = new Date()): StoredLabel {
  if (label.status === "unreadable") throw new Error("UNREADABLE");
  return StoredLabelSchema.parse({ ...label, confirmedAt: now.toISOString() });
}

