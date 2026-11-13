/**
 * Client-safe label types + speech text (no node/LLM imports). See lib/label.ts for the
 * server-side read and safety guard.
 */
import { z } from "zod";
import type { Lang } from "@/lib/config";

export const LabelStatus = z.enum(["ok", "partial", "unreadable"]);
export type LabelStatus = z.infer<typeof LabelStatus>;

/** What the UI shows and what is stored on a task (after confirmation). */
export const LabelReadSchema = z.object({
  status: LabelStatus,
  productName: z.string().nullable(),
  activeIngredient: z.string().nullable(),
  cropDoses: z.array(z.object({ crop: z.string().nullable(), doseText: z.string() })),
  preHarvestInterval: z.string().nullable(),
  safetyWarnings: z.array(z.string()),
  /** fields the model said were unclear + lines the guard removed (machine codes) */
  issues: z.array(z.string()),
  confidenceNotes: z.string().nullable(),
  model: z.string(),
  readAt: z.string(),
});
export type LabelRead = z.infer<typeof LabelReadSchema>;

export const StoredLabelSchema = LabelReadSchema.extend({ confirmedAt: z.string() });
export type StoredLabel = z.infer<typeof StoredLabelSchema>;

// ---------- speech: what the LABEL says ----------

const SPEECH = {
  hi: {
    intro: "पैकेट पर लिखा है:",
    product: (s: string) => `दवा का नाम ${s}.`,
    ai: (s: string) => `सक्रिय तत्व ${s}.`,
    dose: (crop: string | null, s: string) => (crop ? `${crop} के लिए: ${s}.` : `मात्रा: ${s}.`),
    phi: (s: string) => `कटाई से पहले का अंतर: ${s}.`,
    noPhi: "कटाई से पहले का अंतर पढ़ा नहीं जा सका, पैकेट पर ज़रूर देखें.",
    warn: "सावधानी:",
    partial: "कुछ बातें साफ़ नहीं पढ़ी गईं. पैकेट देखें या कृषि विज्ञान केंद्र से पूछें.",
    unreadable: "पैकेट की लिखावट साफ़ नहीं पढ़ी जा सकी. पैकेट ध्यान से पढ़ें या अपने कृषि विज्ञान केंद्र से पूछें. फ़ोटो फिर से साफ़ रोशनी में लें.",
    outro: "मात्रा वही रखें जो पैकेट पर लिखी है.",
  },
  te: {
    intro: "ప్యాకెట్ మీద ఇలా రాసి ఉంది:",
    product: (s: string) => `మందు పేరు ${s}.`,
    ai: (s: string) => `క్రియాశీల పదార్థం ${s}.`,
    dose: (crop: string | null, s: string) => (crop ? `${crop} కోసం: ${s}.` : `మోతాదు: ${s}.`),
    phi: (s: string) => `కోతకు ముందు విరామం: ${s}.`,
    noPhi: "కోతకు ముందు విరామం చదవలేకపోయాం, ప్యాకెట్ మీద తప్పక చూడండి.",
    warn: "జాగ్రత్తలు:",
    partial: "కొన్ని విషయాలు స్పష్టంగా చదవలేదు. ప్యాకెట్ చూడండి లేదా కృషి విజ్ఞాన కేంద్రాన్ని అడగండి.",
    unreadable: "ప్యాకెట్ మీద రాత స్పష్టంగా చదవలేకపోయాం. ప్యాకెట్ జాగ్రత్తగా చదవండి లేదా కృషి విజ్ఞాన కేంద్రాన్ని అడగండి.",
    outro: "ప్యాకెట్ మీద ఉన్న మోతాదే వాడండి.",
  },
} as const;

/**
 * Text for /api/tts. Fits `maxChars` by dropping trailing warnings first, never the PHI line.
 * Pure function: also used by the client.
 */
export function labelSpeech(l: Pick<LabelRead, "status" | "productName" | "activeIngredient" | "cropDoses" | "preHarvestInterval" | "safetyWarnings">, lang: Lang, maxChars = 600): string {
  const S = SPEECH[lang] ?? SPEECH.hi;
  if (l.status === "unreadable") return S.unreadable;
  const head = [S.intro, l.productName && S.product(l.productName), l.activeIngredient && S.ai(l.activeIngredient)].filter(Boolean) as string[];
  const phi = l.preHarvestInterval ? S.phi(l.preHarvestInterval) : S.noPhi;
  const tail = [l.status === "partial" ? S.partial : "", S.outro].filter(Boolean);
  const doses = l.cropDoses.slice(0, 3).map((d) => S.dose(d.crop, d.doseText));
  const warnings = [...l.safetyWarnings];
  const build = (ds: string[], ws: string[]) => [...head, ...ds, phi, ...(ws.length ? [S.warn, ...ws] : []), ...tail].join(" ");
  let ds = doses;
  let ws = warnings;
  let s = build(ds, ws);
  while (s.length > maxChars && ws.length) { ws = ws.slice(0, -1); s = build(ds, ws); }
  while (s.length > maxChars && ds.length > 1) { ds = ds.slice(0, -1); s = build(ds, ws); }
  return s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s;
}
