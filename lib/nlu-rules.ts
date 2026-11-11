/**
 * Deterministic intent + slot parsing for short farmer utterances (Hinglish,
 * Devanagari Hindi, Telugu, romanised Telugu). This is the fast path: when it
 * is confident we skip the LLM (latency), when it isn't we ask the LLM, and
 * when neither is sure we ask the farmer again. Dates are NEVER resolved here
 * or by the LLM; only the verbatim phrase is passed to lib/time.ts.
 */
import { z } from "zod";
import { TaskTypeSchema } from "@/lib/tasks";
import type { TaskType } from "@/lib/rules";
import { CropId, matchCrop } from "@/lib/config";
import { addDays, istDateKey, resolveRelativeDate, type DateKey, type PartOfDay } from "@/lib/time";

export const IntentKind = z.enum([
  "create_task", "complete_task", "start_task", "reschedule_task", "postpone_task", "cancel_task",
  "keep", "deny", "log_irrigation", "ask", "unknown",
]);
export type IntentKind = z.infer<typeof IntentKind>;
export const AskTopic = z.enum(["can_do_task", "should_irrigate", "weather", "task_status", "other"]);

export const IntentSchema = z.object({
  kind: IntentKind,
  taskType: TaskTypeSchema.nullable().optional(),
  datePhrase: z.string().max(80).nullable().optional(),
  notes: z.string().max(200).nullable().optional(),
  askTopic: AskTopic.nullable().optional(),
});
export type Intent = z.infer<typeof IntentSchema> & { confidence: number; source: "rules" | "llm" };

const L = "(?<![\\p{L}\\p{M}])";
const R = "(?![\\p{L}\\p{M}])";
const words = (alts: string[]) => new RegExp(`${L}(?:${alts.join("|")})${R}`, "iu");
const stems = (alts: string[]) => new RegExp(`${L}(?:${alts.join("|")})`, "iu");

const TYPE_PATTERNS: { type: TaskType; re: RegExp }[] = [
  { type: "spray", re: stems(["spray", "sprey", "spre", "chhidk", "chidk", "chhidkav", "dawa", "dawai", "dava", "davai", "keetnashak", "pesticide", "स्प्रे", "छिड़क", "छिडक", "दवा", "दवाई", "कीटनाशक", "స్ప్రే", "pichikari", "పిచికారీ", "mandu kott", "మందు కొట్", "మందు"]) },
  { type: "irrigate", re: stems(["paani", "pani", "sinchai", "sichai", "irrigat", "water", "पानी", "सिंचाई", "neeru", "neellu", "neelu", "నీరు", "నీళ్ళు", "నీళ్లు", "తడి"]) },
  { type: "fertilize", re: stems(["khad", "khaad", "urea", "uria", "dap", "fertili", "potash", "खाद", "यूरिया", "डीएपी", "eruvu", "ఎరువు", "యూరియా"]) },
  { type: "harvest", re: stems(["katai", "kataai", "katayi", "harvest", "kaatna", "कटाई", "काटना", "कटनी", "kotha", "koyya", "కోత", "కోయ"]) },
];

const COMPLETE = words(["ho gaya", "ho gya", "hogaya", "ho gayi", "ho gai", "ho chuka", "kar diya", "kar liya", "kar di", "kar li", "de diya", "daal diya", "dal diya", "khatam", "pura ho gaya", "done", "finished", "complete", "हो गया", "हो गई", "हो गयी", "हो चुका", "कर दिया", "कर लिया", "कर दी", "कर ली", "दे दिया", "डाल दिया", "खत्म", "ख़त्म", "पूरा हो", "ayipoyindi", "aipoyindi", "ayindi", "chesanu", "chesaanu", "pettanu", "kottanu", "vesanu", "అయిపోయింది", "అయింది", "చేశాను", "చేసాను", "పెట్టాను", "కొట్టాను", "వేశాను", "పూర్తి"]);
const START = words(["kar raha", "kar rahi", "kar rahe", "shuru", "start", "spraying now", "abhi kar", "कर रहा", "कर रही", "कर रहे", "शुरू", "chestunna", "chestunnanu", "kodutunna", "చేస్తున్నా", "చేస్తున్నాను", "కొడుతున్నా", "మొదలు"]);
const CANCEL = words(["cancel", "radd", "nahi karna", "nahin karna", "mat karo", "rehne do", "rahne do", "रद्द", "नहीं करना", "मत करो", "रहने दो", "vaddu", "raddu", "వద్దు", "రద్దు"]);
const POSTPONE = words(["baad mein", "baad me", "bad me", "later", "abhi nahi", "बाद में", "अभी नहीं", "taruvata", "tarvata", "తర్వాత", "తరువాత"]);
const AFFIRM = words(["theek hai", "thik hai", "thik h", "theek", "thik", "ठीक है", "ठीक", "haan", "han", "ha", "haa", "हां", "हाँ", "ok", "okay", "sahi", "सही", "ji", "जी", "yes", "avunu", "అవును", "sare", "sari", "సరే", "సరి"]);
const DENY = words(["nahi", "nahin", "na", "नहीं", "ना", "no", "kaadu", "kadu", "ledu", "కాదు", "లేదు"]);
const QUESTION = words(["kya", "क्या", "sakta", "sakti", "sakte", "सकता", "सकती", "सकते", "chahiye", "चाहिए", "kab", "कब", "kaisa", "kaise", "कैसा", "कैसे", "mausam", "मौसम", "barish", "baarish", "बारिश", "cheyocha", "cheyavacha", "chesukovacha", "చేయొచ్చా", "చేయవచ్చా", "ఎప్పుడు", "ఎలా", "వాతావరణం", "vatavaranam", "varsham", "వర్షం", "pettala", "పెట్టాలా", "kottala", "కొట్టాలా"]);
const CREATE = words(["karna hai", "karni hai", "karna", "dena hai", "dalna hai", "daalna hai", "chhidakna hai", "karenge", "karunga", "karungi", "kar dunga", "kar dungi", "kar denge", "dunga", "करना है", "करनी है", "देना है", "डालना है", "करेंगे", "करूंगा", "करूँगा", "कर दूंगा", "कर दूँगा", "दूंगा", "cheyali", "pettali", "kottali", "veyali", "chestanu", "pedatanu", "kodatanu", "చేయాలి", "పెట్టాలి", "కొట్టాలి", "వేయాలి", "చేస్తాను", "పెడతాను", "కొడతాను"]);
const FUTURE = words(["karunga", "karungi", "kar dunga", "kar dungi", "kar denge", "karenge", "dunga", "dungi", "करूंगा", "करूँगा", "कर दूंगा", "कर दूँगा", "करेंगे", "दूंगा", "chestanu", "chesta", "pedatanu", "kodatanu", "చేస్తాను", "చేస్తా", "పెడతాను", "కొడతాను"]);

export function detectTaskType(text: string): TaskType | null {
  for (const p of TYPE_PATTERNS) if (p.re.test(text)) return p.type;
  return null;
}

export interface RuleContext {
  /** active task types the farmer currently has */
  activeTypes: TaskType[];
  /** the task the last assistant turn was about (briefing / confirmation) */
  focusType?: TaskType | null;
  mode: "talk" | "checkin";
}

export function parseIntentRules(raw: string, ctx: RuleContext, now: Date): Intent {
  const text = raw.normalize("NFC").toLowerCase().replace(/[.,!।]/g, " ").replace(/\s+/g, " ").trim();
  const type = detectTaskType(text);
  const date = resolveRelativeDate(text, now);
  const datePhrase = date ? date.matched || null : null;
  const out = (kind: IntentKind, confidence: number, extra: Partial<Intent> = {}): Intent => ({
    kind, confidence, source: "rules", taskType: type ?? ctx.focusType ?? null, datePhrase, notes: null, askTopic: null, ...extra,
  });
  if (!text) return out("unknown", 0);

  const isQuestion = raw.includes("?") || QUESTION.test(text);
  if (isQuestion && !COMPLETE.test(text)) {
    const askTopic = type === "irrigate" ? "should_irrigate" : type ? "can_do_task" : /mausam|मौसम|barish|baarish|बारिश|వాతావరణం|vatavaranam|varsham|వర్షం/i.test(text) ? "weather" : "other";
    return out("ask", type || askTopic === "weather" ? 0.85 : 0.5, { askTopic, taskType: type ?? null });
  }
  if (COMPLETE.test(text)) {
    if (type === "irrigate" && !ctx.activeTypes.includes("irrigate")) return out("log_irrigation", 0.9);
    return out("complete_task", type || ctx.focusType || ctx.activeTypes.length === 1 ? 0.9 : 0.55);
  }
  if (START.test(text) && !FUTURE.test(text)) return out("start_task", type || ctx.focusType ? 0.85 : 0.5);
  if (CANCEL.test(text)) return out("cancel_task", type || ctx.focusType ? 0.85 : 0.5);

  const t = type ?? ctx.focusType ?? null;
  if (t) {
    const hasActive = ctx.activeTypes.includes(t);
    if (date && hasActive && (FUTURE.test(text) || ctx.mode === "checkin" || !type)) return out("reschedule_task", 0.85, { taskType: t });
    if (POSTPONE.test(text) && !date) return out("postpone_task", hasActive ? 0.8 : 0.5, { taskType: t });
    if (type && (date || CREATE.test(text))) return out("create_task", date ? 0.9 : 0.75, { taskType: type });
    if (type && !date) return out("create_task", 0.6, { taskType: type });
  }
  if (AFFIRM.test(text) && text.split(" ").length <= 4) return out("keep", 0.9);
  if (DENY.test(text) && text.split(" ").length <= 3) return out("deny", 0.85);
  return out("unknown", 0.2);
}

// ---------- onboarding slot parsing ----------
export const Irrigation = z.enum(["canal", "borewell", "well", "rainfed", "drip", "sprinkler", "tank", "other"]);
export type Irrigation = z.infer<typeof Irrigation>;
const IRRIGATION_PATTERNS: { v: Irrigation; re: RegExp }[] = [
  { v: "drip", re: stems(["drip", "ड्रिप", "డ్రిప్"]) },
  { v: "sprinkler", re: stems(["sprinkl", "फव्वारा", "स्प्रिंकलर", "స్ప్రింక్లర్"]) },
  { v: "borewell", re: stems(["bore", "tube", "tubewell", "boring", "motor", "बोर", "ट्यूबवेल", "मोटर", "బోరు", "బోర్", "మోటార్"]) },
  { v: "canal", re: stems(["canal", "nahar", "nehar", "नहर", "kaluva", "kaalva", "కాలువ", "కాల్వ"]) },
  { v: "well", re: stems(["kuan", "kuaan", "kuwa", "कुआं", "कुआँ", "kuva", "bavi", "baavi", "బావి"]) },
  { v: "tank", re: stems(["talab", "taalab", "pond", "tank", "तालाब", "cheruvu", "చెరువు"]) },
  { v: "rainfed", re: stems(["barish", "baarish", "barani", "rain", "बारिश", "बरसात", "वर्षा", "बारानी", "varsham", "వర్షం", "వర్షాధార"]) },
];
export function parseIrrigation(text: string): Irrigation | null {
  for (const p of IRRIGATION_PATTERNS) if (p.re.test(text)) return p.v;
  return null;
}

export const LandUnit = z.enum(["acre", "bigha", "hectare", "guntha", "kanal"]);
export type LandUnit = z.infer<typeof LandUnit>;
const UNIT_PATTERNS: { u: LandUnit; re: RegExp }[] = [
  { u: "acre", re: stems(["acre", "akad", "ekad", "ekar", "एकड़", "एकड", "एकर", "ekaram", "ekaralu", "ఎకరం", "ఎకరా", "ఎకరాలు"]) },
  { u: "bigha", re: stems(["bigha", "beegha", "बीघा", "बीघे"]) },
  { u: "hectare", re: stems(["hectare", "hektare", "हेक्टेयर", "హెక్టార్"]) },
  { u: "guntha", re: stems(["guntha", "gunta", "गुंठा", "గుంట"]) },
  { u: "kanal", re: stems(["kanal", "कनाल"]) },
];
const NUM: Record<string, number> = {
  aadha: 0.5, adha: 0.5, आधा: 0.5, ek: 1, एक: 1, dedh: 1.5, डेढ़: 1.5, do: 2, दो: 2, dhai: 2.5, ढाई: 2.5, teen: 3, तीन: 3, char: 4, chaar: 4, चार: 4, paanch: 5, panch: 5, पांच: 5, पाँच: 5,
  chhe: 6, छह: 6, saat: 7, सात: 7, aath: 8, आठ: 8, nau: 9, नौ: 9, das: 10, दस: 10, barah: 12, बारह: 12, pandrah: 15, पंद्रह: 15, bees: 20, बीस: 20,
  okati: 1, oka: 1, ఒక: 1, ఒకటి: 1, rendu: 2, రెండు: 2, moodu: 3, mudu: 3, మూడు: 3, naalugu: 4, nalugu: 4, నాలుగు: 4, aidu: 5, ఐదు: 5, aaru: 6, ఆరు: 6, padi: 10, పది: 10, padihenu: 15, పదిహేను: 15, iravai: 20, ఇరవై: 20, muppai: 30, ముప్పై: 30, tees: 30, तीस: 30, pachees: 25, पच्चीस: 25,
  one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, half: 0.5,
};
export function parseLand(text: string): { size: number; unit: LandUnit } | null {
  const t = text.normalize("NFC").toLowerCase();
  const unit = UNIT_PATTERNS.find((p) => p.re.test(t))?.u;
  if (!unit) return null;
  const num = t.match(/(\d+(?:\.\d+)?)/);
  let size: number | undefined = num ? Number(num[1]) : undefined;
  if (size === undefined) {
    for (const [w, v] of Object.entries(NUM)) {
      if (new RegExp(`${L}${w}${R}`, "iu").test(t)) {
        size = v;
        break;
      }
    }
  }
  if (size === undefined || !(size > 0) || size > 5000) return null;
  return { size, unit };
}

/** "20 din pehle", "do mahine pehle", "pichhle hafte", "15 roju kritam", or any future/absolute phrase */
export function parsePastOrDate(text: string, now: Date): DateKey | null {
  const t = text.normalize("NFC").toLowerCase();
  const today = istDateKey(now);
  const m = t.match(new RegExp(`${L}(\\d{1,3}|${Object.keys(NUM).join("|")})\\s*(din|dino|दिन|दिनों|days?|hafte|hafta|हफ्ते|हफ़्ते|सप्ताह|weeks?|mahine|mahina|महीने|महीना|months?|roju|rojula|rojulu|రోజుల|రోజులు|varam|vaaralu|వారాల|వారం|nela|nelalu|నెల|నెలల|నెలలు)\\s*(pehle|pahle|पहले|ago|kritam|క్రితం|kindata|కిందట)`, "iu"));
  if (m && m[1] && m[2]) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]] ?? NaN;
    if (!Number.isFinite(n)) return null;
    const u = m[2];
    const days = /hafte|hafta|हफ्ते|हफ़्ते|सप्ताह|week|varam|vaaralu|వారాల|వారం/.test(u) ? n * 7 : /mahine|mahina|महीने|महीना|month|nela|నెల/.test(u) ? Math.round(n * 30.4) : n;
    return addDays(today, -Math.round(days));
  }
  if (/(pichhle|pichle|पिछले)\s*(hafte|हफ्ते|हफ़्ते)|last week|పోయిన వారం|poyina varam/i.test(t)) return addDays(today, -7);
  if (/(pichhle|pichle|पिछले)\s*(mahine|महीने)|last month|పోయిన నెల|poyina nela/i.test(t)) return addDays(today, -30);
  const r = resolveRelativeDate(t, now);
  return r ? r.dateKey : null;
}

export function parseCrop(text: string): z.infer<typeof CropId> | null {
  return matchCrop(text);
}

export type { PartOfDay };
