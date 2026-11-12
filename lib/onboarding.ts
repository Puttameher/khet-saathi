/**
 * Voice onboarding: short questions → validated CropProfile → spoken read-back → confirm or correct.
 */
import { z } from "zod";
import { CROPS, CropId, type Lang } from "@/lib/config";
import { extractProfileLLM, type ProfileDraft } from "@/lib/nlu";
import { Irrigation, LandUnit, parseCrop, parseIntentRules, parseIrrigation, parseLand, parsePastOrDate } from "@/lib/nlu-rules";
import { geocode } from "@/lib/weather";
import { getProfile, getSetting, saveProfile, setSetting, delSetting, addTimeline } from "@/lib/repo";
import { addDays, diffDays, istDateKey, isDateKey } from "@/lib/time";
import { log } from "@/lib/log";

export const Step = z.enum(["crop", "sowing", "harvest", "land", "place", "irrigation", "confirm", "done"]);
export type Step = z.infer<typeof Step>;
const StateSchema = z.object({
  step: Step,
  draft: z.object({
    crop: CropId.nullable(),
    sowingDate: z.string().nullable(),
    expectedHarvest: z.string().nullable(),
    landSize: z.number().nullable(),
    landUnit: LandUnit.nullable(),
    placeQuery: z.string().nullable(),
    placeLabel: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    irrigation: Irrigation.nullable(),
  }),
  attempts: z.number().int().default(0),
});
export type OnboardingState = z.infer<typeof StateSchema>;

const EMPTY: OnboardingState = {
  step: "crop",
  draft: { crop: null, sowingDate: null, expectedHarvest: null, landSize: null, landUnit: null, placeQuery: null, placeLabel: null, lat: null, lon: null, irrigation: null },
  attempts: 0,
};

export function getOnboarding(): OnboardingState {
  const s = getSetting<unknown>("onboarding");
  const p = StateSchema.safeParse(s);
  return p.success ? p.data : structuredClone(EMPTY);
}

const Q: Record<Lang, Record<Exclude<Step, "done">, string>> = {
  hi: {
    crop: "राम राम! मैं खेत साथी हूं। आपके खेत में कौन सी फ़सल है — गेहूं, धान या प्याज?",
    sowing: "बुवाई कब की थी? जैसे — बीस दिन पहले, या पंद्रह तारीख।",
    harvest: "कोई बात नहीं। कटाई लगभग कब होगी? जैसे — दो महीने में।",
    land: "कितनी ज़मीन है? जैसे — दो एकड़ या पांच बीघा।",
    place: "आपका गांव और ज़िला कौन सा है?",
    irrigation: "सिंचाई कैसे करते हैं — नहर, बोरवेल, कुआं या बारिश?",
    confirm: "",
  },
  te: {
    crop: "నమస్కారం! నేను ఖేత్ సాథీ. మీ పొలంలో ఏ పంట ఉంది — గోధుమ, వరి లేదా ఉల్లి?",
    sowing: "విత్తనం ఎప్పుడు వేశారు? ఉదాహరణకు — ఇరవై రోజుల క్రితం.",
    harvest: "పర్వాలేదు. కోత సుమారు ఎప్పుడు? ఉదాహరణకు — రెండు నెలల్లో.",
    land: "ఎంత భూమి ఉంది? ఉదాహరణకు — రెండు ఎకరాలు.",
    place: "మీ ఊరు, జిల్లా ఏది?",
    irrigation: "నీరు ఎలా పెడతారు — కాలువ, బోరు, బావి లేదా వర్షం?",
    confirm: "",
  },
};
const RETRY: Record<Lang, string> = { hi: "माफ़ कीजिए, समझ नहीं आया। ", te: "క్షమించండి, అర్థం కాలేదు. " };
const UNKNOWN_WORDS = /pata nahi|nahi pata|पता नहीं|नहीं पता|maloom nahi|yaad nahi|याद नहीं|teliyadu|తెలియదు|gurthu ledu|గుర్తు లేదు|don.?t know/i;

const UNIT_WORD: Record<Lang, Record<string, string>> = {
  hi: { acre: "एकड़", bigha: "बीघा", hectare: "हेक्टेयर", guntha: "गुंठा", kanal: "कनाल" },
  te: { acre: "ఎకరాలు", bigha: "బిఘా", hectare: "హెక్టార్లు", guntha: "గుంటలు", kanal: "కనాల్" },
};
const IRR_WORD: Record<Lang, Record<string, string>> = {
  hi: { canal: "नहर", borewell: "बोरवेल", well: "कुआं", rainfed: "बारिश पर", drip: "ड्रिप", sprinkler: "फव्वारा", tank: "तालाब", other: "अन्य" },
  te: { canal: "కాలువ", borewell: "బోరు", well: "బావి", rainfed: "వర్షాధారం", drip: "డ్రిప్", sprinkler: "స్ప్రింక్లర్", tank: "చెరువు", other: "ఇతర" },
};

function fmtDate(key: string, lang: Lang) {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const months = lang === "te"
    ? ["జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జూలై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్"]
    : ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
  return `${d} ${months[m - 1]}${y !== new Date().getUTCFullYear() ? ` ${y}` : ""}`;
}

export function readBack(s: OnboardingState, lang: Lang): string {
  const d = s.draft;
  const crop = d.crop ? CROPS.crops[d.crop].names[lang === "te" ? "te" : "hi"] : "?";
  if (lang === "te") {
    return `సరిచూద్దాం: పంట ${crop}, విత్తనం ${d.sowingDate ? fmtDate(d.sowingDate, lang) : "?"}, భూమి ${d.landSize ?? "?"} ${d.landUnit ? UNIT_WORD.te[d.landUnit] : ""}, ఊరు ${d.placeLabel ?? "?"}, నీరు ${d.irrigation ? IRR_WORD.te[d.irrigation] : "?"}. ఇది సరైనదేనా?`;
  }
  return `एक बार मिला लें: फ़सल ${crop}, बुवाई ${d.sowingDate ? fmtDate(d.sowingDate, lang) : "?"}, ज़मीन ${d.landSize ?? "?"} ${d.landUnit ? UNIT_WORD.hi[d.landUnit] : ""}, जगह ${d.placeLabel ?? "?"}, सिंचाई ${d.irrigation ? IRR_WORD.hi[d.irrigation] : "?"}। क्या यह सही है?`;
}

function nextStep(s: OnboardingState): Step {
  const d = s.draft;
  if (!d.crop) return "crop";
  if (!d.sowingDate) return s.step === "harvest" ? "harvest" : "sowing";
  if (d.landSize === null) return "land";
  if (d.lat === null) return "place";
  if (!d.irrigation) return "irrigation";
  return "confirm";
}

/** Read-only: the question the farmer should hear next (no state write). */
export function onboardingPrompt(lang: Lang): string {
  const s = getOnboarding();
  const step = nextStep(s);
  return step === "confirm" ? readBack(s, lang) : Q[lang][step as Exclude<Step, "done" | "confirm">];
}

export function firstQuestion(lang: Lang): { text: string; state: OnboardingState } {
  const s = getOnboarding();
  const step = nextStep(s);
  s.step = step;
  setSetting("onboarding", s);
  return { text: step === "confirm" ? readBack(s, lang) : Q[lang][step as Exclude<Step, "done" | "confirm">], state: s };
}

async function applyPlace(s: OnboardingState, place: string): Promise<boolean> {
  try {
    // try full phrase, then each comma/space separated chunk (village names are often missing in gazetteers)
    const tries = [place, ...place.split(/[,\s]+/).filter((x) => x.length > 2).reverse()];
    for (const q of tries) {
      const res = await geocode(q);
      const hit = res[0];
      if (hit) {
        s.draft.placeQuery = place;
        s.draft.placeLabel = hit.label;
        s.draft.lat = hit.lat;
        s.draft.lon = hit.lon;
        return true;
      }
    }
  } catch (e) {
    log.warn("onboarding.geocode_failed", { error: (e as Error).message });
  }
  return false;
}

function mergeDraft(s: OnboardingState, d: ProfileDraft, now: Date) {
  if (d.crop) s.draft.crop = d.crop;
  if (d.sowingPhrase) {
    const k = parsePastOrDate(d.sowingPhrase, now);
    if (k && k <= istDateKey(now)) s.draft.sowingDate = k;
  }
  if (d.harvestPhrase && !s.draft.sowingDate && s.draft.crop) {
    const k = harvestIn(d.harvestPhrase, now) ?? parsePastOrDate(d.harvestPhrase, now);
    if (k && k > istDateKey(now)) setHarvest(s, k);
  }
  if (d.landSize && d.landUnit) {
    s.draft.landSize = d.landSize;
    s.draft.landUnit = d.landUnit;
  }
  if (d.irrigation) s.draft.irrigation = d.irrigation;
}

function harvestIn(text: string, now: Date): string | null {
  const m = text.match(/(\d+|ek|do|teen|char|ఒక|రెండు|మూడు)\s*(mahine|महीने|mahina|months?|nelal|నెల|hafte|हफ्ते|weeks?|din|दिन|days?)/i);
  if (!m || !m[1] || !m[2]) return null;
  const nmap: Record<string, number> = { ek: 1, do: 2, teen: 3, char: 4, ఒక: 1, రెండు: 2, మూడు: 3 };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : nmap[m[1]] ?? 0;
  const days = /mahin|महीने|month|nela|నెల/.test(m[2]) ? n * 30 : /hafte|हफ्ते|week/.test(m[2]) ? n * 7 : n;
  return days > 0 ? addDays(istDateKey(now), days) : null;
}

function setHarvest(s: OnboardingState, key: string) {
  if (!s.draft.crop || !isDateKey(key)) return;
  s.draft.expectedHarvest = key;
  s.draft.sowingDate = addDays(key, -CROPS.crops[s.draft.crop].totalDays);
}

export interface OnboardingTurn { reply: string; step: Step; done: boolean; state: OnboardingState }

export async function onboardingTurn(text: string, lang: Lang, now = new Date()): Promise<OnboardingTurn> {
  const s = getOnboarding();
  const step = s.step;
  const t = text.normalize("NFC").trim();
  let understood = false;

  if (step === "confirm") {
    const intent = parseIntentRules(t, { activeTypes: [], mode: "talk" }, now);
    if (intent.kind === "keep" && !/nahi|नहीं|kaadu|కాదు|ledu|లేదు/i.test(t)) {
      const d = s.draft;
      saveProfile({ language: lang, crop: d.crop, sowingDate: d.sowingDate, expectedHarvest: d.expectedHarvest, landSize: d.landSize, landUnit: d.landUnit, placeQuery: d.placeQuery, placeLabel: d.placeLabel, lat: d.lat, lon: d.lon, irrigation: d.irrigation, confirmedAt: now.toISOString() }, now);
      addTimeline("profile_confirmed", { crop: d.crop, sowingDate: d.sowingDate }, null, now);
      delSetting("onboarding");
      const reply = lang === "te"
        ? "ధన్యవాదాలు! మీ పొలం సిద్ధం. ఇక పనులు చెప్పండి — ఉదాహరణకు, ఎల్లుండి మందు కొట్టాలి."
        : "धन्यवाद! आपका खेत तैयार है। अब काम बताइए — जैसे, परसों स्प्रे करना है।";
      return { reply, step: "done", done: true, state: { ...s, step: "done" } };
    }
    // correction: try to extract any field from it
  }

  // deterministic slot parsing for the asked step (+ opportunistic extras)
  if (step === "crop" || step === "confirm") {
    const c = parseCrop(t);
    if (c) { s.draft.crop = c; understood = true; }
  }
  if (step === "sowing") {
    if (UNKNOWN_WORDS.test(t)) { s.step = "harvest"; understood = true; }
    else {
      const k = parsePastOrDate(t, now);
      if (k && k <= istDateKey(now) && diffDays(istDateKey(now), k) < 400) { s.draft.sowingDate = k; understood = true; }
    }
  }
  if (step === "harvest") {
    const k = harvestIn(t, now) ?? (() => { const r = parsePastOrDate(t, now); return r && r > istDateKey(now) ? r : null; })();
    if (k) { setHarvest(s, k); understood = true; }
  }
  const land = parseLand(t);
  if (land) { s.draft.landSize = land.size; s.draft.landUnit = land.unit; understood = true; }
  const irr = parseIrrigation(t);
  if (irr && (step === "irrigation" || step === "confirm")) { s.draft.irrigation = irr; understood = true; }

  // LLM extraction for messy answers / multi-field answers
  if (!understood || step === "confirm") {
    const d = await extractProfileLLM(t, step, lang);
    if (d) {
      const before = JSON.stringify(s.draft);
      mergeDraft(s, d, now);
      if (d.place && (step === "place" || step === "confirm")) understood = (await applyPlace(s, d.place)) || understood;
      if (JSON.stringify(s.draft) !== before) understood = true;
    }
  }
  if (step === "place" && !understood) {
    understood = await applyPlace(s, t.replace(/(gaon|गांव|गाँव|zila|ज़िला|जिला|district|mera|मेरा|hai|है|ooru|ఊరు|jilla|జిల్లా)/gi, " ").trim());
  }

  if (step === "confirm" && !understood) {
    setSetting("onboarding", s);
    const ask = lang === "te" ? "ఏది మార్చాలి? ఉదాహరణకు — భూమి మూడు ఎకరాలు." : "क्या बदलना है? जैसे — ज़मीन तीन एकड़ है।";
    return { reply: ask, step: "confirm", done: false, state: s };
  }
  s.attempts = understood ? 0 : s.attempts + 1;
  const nx = step === "confirm" && !understood ? "confirm" : nextStep(s);
  s.step = nx;
  setSetting("onboarding", s);
  const q = nx === "confirm" ? readBack(s, lang) : Q[lang][nx as Exclude<Step, "done" | "confirm">];
  const reply = understood || nx === "confirm" ? q : RETRY[lang] + q;
  return { reply, step: nx, done: false, state: s };
}

export function isOnboarded(): boolean {
  return !!getProfile().confirmedAt;
}
