/**
 * Deterministic spoken-text builders (Hindi + Telugu). Every sentence here is
 * derived from rules-engine output or stored data; nothing is invented.
 */
import type { Lang } from "@/lib/config";
import type { Evaluation, Reason, TaskType, Window } from "@/lib/rules";
import type { Forecast } from "@/lib/weather";
import { conditionOf, type Condition } from "@/lib/weather";
import { istDateKey, istHour, relativeLabel, type DateKey } from "@/lib/time";

export const TASK_NAME: Record<Lang, Record<TaskType, string>> = {
  hi: { spray: "स्प्रे", irrigate: "सिंचाई", fertilize: "खाद", harvest: "कटाई", other: "काम" },
  te: { spray: "మందు పిచికారీ", irrigate: "నీరు పెట్టడం", fertilize: "ఎరువు వేయడం", harvest: "కోత", other: "పని" },
};

export const CONDITION_WORD: Record<Lang, Record<Condition, string>> = {
  hi: { clear: "धूप", partly: "हल्के बादल", cloudy: "बादल", fog: "कोहरा", drizzle: "बूंदाबांदी", rain: "बारिश", heavy_rain: "तेज़ बारिश", thunder: "आंधी-तूफ़ान" },
  te: { clear: "ఎండ", partly: "కొద్దిగా మబ్బులు", cloudy: "మబ్బులు", fog: "పొగమంచు", drizzle: "చినుకులు", rain: "వర్షం", heavy_rain: "భారీ వర్షం", thunder: "ఉరుములతో వర్షం" },
};

export function clockPhrase(ms: number, lang: Lang): string {
  const h = istHour(new Date(ms));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === "te") {
    const part = h < 12 ? "ఉదయం" : h < 16 ? "మధ్యాహ్నం" : h < 19 ? "సాయంత్రం" : "రాత్రి";
    return `${part} ${h12} గంటలకు`;
  }
  const part = h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 19 ? "शाम" : "रात";
  return `${part} ${h12} बजे`;
}

function dayAndClock(w: Window, now: Date, lang: Lang): string {
  const day = relativeLabel(istDateKey(new Date(w.start)), now, lang);
  return `${day} ${clockPhrase(w.start, lang)}`;
}

export function reasonPhrase(r: Reason, lang: Lang): string | null {
  const v = r.value;
  if (lang === "te") {
    switch (r.code) {
      case "RAIN_PROB": return `వర్షం వచ్చే అవకాశం ${v} శాతం`;
      case "RAIN_MM": case "RAIN_24H": return `${v} మిల్లీమీటర్ల వర్షం అంచనా`;
      case "WIND": return `గాలి గంటకు ${v} కిలోమీటర్లు`;
      case "GUST": return `గాలి ఈదురులు ఎక్కువ`;
      case "HEAT": return `ఎండ వేడి ${v} డిగ్రీలు`;
      case "THUNDER": return `ఉరుములు మెరుపులు`;
      case "FUNGAL_RISK": return `తేమ ఎక్కువ, తెగులు ప్రమాదం`;
      case "DAY_OVER": return `ఈరోజు సమయం అయిపోయింది`;
      default: return null;
    }
  }
  switch (r.code) {
    case "RAIN_PROB": return `बारिश की संभावना ${v} प्रतिशत`;
    case "RAIN_MM": case "RAIN_24H": return `${v} मिलीमीटर बारिश का अनुमान`;
    case "WIND": return `हवा ${v} किलोमीटर प्रति घंटा`;
    case "GUST": return `तेज़ झोंके`;
    case "HEAT": return `गर्मी ${v} डिग्री`;
    case "THUNDER": return `आंधी और बिजली`;
    case "FUNGAL_RISK": return `नमी ज़्यादा है, फफूंद का खतरा`;
    case "DAY_OVER": return `आज का समय निकल गया`;
    default: return null;
  }
}

function blockingReasons(e: Evaluation, lang: Lang): string {
  const rs = e.reasons.filter((r) => r.severity === "skip" || r.severity === "wait");
  const sorted = [...rs].sort((a, b) => (a.severity === "skip" ? -1 : 1) - (b.severity === "skip" ? -1 : 1));
  return sorted.slice(0, 2).map((r) => reasonPhrase(r, lang)).filter(Boolean).join(lang === "te" ? ", " : " और ");
}

/** One sentence: "<task> (<day>): <verdict + why + when>" */
export function verdictSentence(type: TaskType, plannedDate: DateKey, e: Evaluation, now: Date, lang: Lang): string {
  const name = TASK_NAME[lang][type];
  const day = relativeLabel(plannedDate, now, lang);
  const why = blockingReasons(e, lang);
  const fungal = e.reasons.find((r) => r.code === "FUNGAL_RISK");
  const fungalTail = fungal ? (lang === "te" ? " తేమ ఎక్కువగా ఉంది, ఆకులు గమనించండి." : " नमी ज़्यादा है, पत्तियों पर नज़र रखें।") : "";
  if (lang === "te") {
    switch (e.verdict) {
      case "GO":
        return `${day} ${name}: వాతావరణం బాగుంది, చేయవచ్చు${e.window ? `, ${clockPhrase(e.window.start, lang)} నుండి` : ""}.${fungalTail}`;
      case "WAIT":
        return `${day} ${name}: కొంచెం ఆగండి — ${why}.${e.suggestedWindow ? ` ${dayAndClock(e.suggestedWindow, now, lang)} బాగుంటుంది.` : ""}`;
      case "SKIP_TODAY":
        return `${day} ${name} వద్దు — ${why}.${e.suggestedWindow ? ` తర్వాత మంచి సమయం: ${dayAndClock(e.suggestedWindow, now, lang)}.` : " తర్వాత మంచి సమయం ఇంకా కనిపించలేదు."}`;
      default:
        return `${day} ${name}: ఆ రోజు వాతావరణ సమాచారం ఇంకా లేదు, దగ్గరకు వచ్చాక చెబుతాను.`;
    }
  }
  switch (e.verdict) {
    case "GO":
      return `${day} ${name}: मौसम ठीक है, कर सकते हैं${e.window ? `, ${clockPhrase(e.window.start, lang)} से` : ""}।${fungalTail}`;
    case "WAIT":
      return `${day} ${name}: अभी रुकिए — ${why}।${e.suggestedWindow ? ` ${dayAndClock(e.suggestedWindow, now, lang)} ठीक रहेगा।` : ""}`;
    case "SKIP_TODAY":
      return `${day} ${name} मत कीजिए — ${why}।${e.suggestedWindow ? ` अगला अच्छा समय: ${dayAndClock(e.suggestedWindow, now, lang)}।` : " अगला अच्छा समय अभी नहीं दिख रहा।"}`;
    default:
      return `${day} ${name}: उस दिन का मौसम अभी पता नहीं, पास आने पर बताऊंगी।`;
  }
}

export function weatherDaySentence(fc: Forecast, day: DateKey, now: Date, lang: Lang): string | null {
  const d = fc.daily.find((x) => x.date === day);
  if (!d) return null;
  const cond = CONDITION_WORD[lang][conditionOf(d.weatherCode, d.precipSum / 6)];
  const label = relativeLabel(day, now, lang);
  const prob = d.precipProbMax ?? 0;
  if (lang === "te") return `${label} ${cond}, గరిష్టం ${Math.round(d.tMax)} డిగ్రీలు, వర్షం అవకాశం ${prob} శాతం.`;
  return `${label} ${cond}, ${Math.round(d.tMax)} डिग्री तक, बारिश की संभावना ${prob} प्रतिशत।`;
}

export const PHRASES = {
  hi: {
    greet: "राम राम!",
    noWeather: "मौसम की जानकारी अभी नहीं मिल पाई।",
    staleWeather: (t: string) => `मौसम की आखिरी जानकारी ${t} की है।`,
    noTasks: "अभी कोई काम तय नहीं है। बोलिए, जैसे — परसों स्प्रे करना है।",
    changed: "मौसम बदला है, ध्यान दीजिए।",
    askReply: "ठीक है बोलें, या नई तारीख बताएं।",
    didntUnderstand: "माफ़ कीजिए, मैं समझ नहीं पाई। फिर से बोलिए, जैसे — कल पानी देना है।",
    needDate: (task: string) => `${task} कब करना है? जैसे — कल, परसों, या सोमवार।`,
    created: (task: string, day: string) => `ठीक है, ${day} ${task} लिख लिया।`,
    rescheduled: (task: string, day: string) => `ठीक है, ${task} अब ${day} कर दिया।`,
    done: (task: string) => `बहुत बढ़िया! ${task} पूरा हो गया, दर्ज कर लिया।`,
    started: (task: string) => `ठीक है, ${task} शुरू। खत्म होने पर बताइए — हो गया।`,
    cancelled: (task: string) => `${task} रद्द कर दिया।`,
    postponed: (task: string) => `${task} बाद के लिए रख दिया। तारीख बताएं तो तय कर दूं।`,
    kept: "ठीक है, जैसा तय था वैसा ही रखा।",
    noSuchTask: (task: string) => `${task} का कोई काम तय नहीं मिला।`,
    irrigationLogged: "सिंचाई दर्ज कर ली।",
    noProfile: "पहले अपनी फ़सल के बारे में बताइए।",
    noAnswer: "इस सवाल का पक्का जवाब मेरे पास अभी नहीं है। अपने नज़दीकी कृषि विज्ञान केंद्र से पूछें।",
  },
  te: {
    greet: "నమస్కారం!",
    noWeather: "వాతావరణ సమాచారం ఇప్పుడు అందలేదు.",
    staleWeather: (t: string) => `చివరి వాతావరణ సమాచారం ${t} నాటిది.`,
    noTasks: "ఇంకా ఏ పనీ నమోదు కాలేదు. ఉదాహరణకు చెప్పండి — ఎల్లుండి మందు కొట్టాలి.",
    changed: "వాతావరణం మారింది, గమనించండి.",
    askReply: "సరే అనండి, లేదా కొత్త తేదీ చెప్పండి.",
    didntUnderstand: "క్షమించండి, అర్థం కాలేదు. మళ్ళీ చెప్పండి — ఉదాహరణకు, రేపు నీరు పెట్టాలి.",
    needDate: (task: string) => `${task} ఎప్పుడు చేయాలి? రేపు, ఎల్లుండి, లేదా సోమవారం?`,
    created: (task: string, day: string) => `సరే, ${day} ${task} నమోదు చేశాను.`,
    rescheduled: (task: string, day: string) => `సరే, ${task} ఇప్పుడు ${day}కి మార్చాను.`,
    done: (task: string) => `చాలా బాగుంది! ${task} పూర్తయింది, నమోదు చేశాను.`,
    started: (task: string) => `సరే, ${task} మొదలైంది. అయిపోయాక చెప్పండి.`,
    cancelled: (task: string) => `${task} రద్దు చేశాను.`,
    postponed: (task: string) => `${task} తర్వాతకి ఉంచాను. తేదీ చెబితే నమోదు చేస్తాను.`,
    kept: "సరే, అనుకున్నట్టే ఉంచాను.",
    noSuchTask: (task: string) => `${task} పని ఏదీ నమోదు కాలేదు.`,
    irrigationLogged: "నీరు పెట్టినట్టు నమోదు చేశాను.",
    noProfile: "ముందు మీ పంట గురించి చెప్పండి.",
    noAnswer: "ఈ ప్రశ్నకు ఖచ్చితమైన సమాధానం ఇప్పుడు నా దగ్గర లేదు. దగ్గరలోని కృషి విజ్ఞాన కేంద్రాన్ని అడగండి.",
  },
} as const;
