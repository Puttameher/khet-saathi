/**
 * Asia/Kolkata date handling. IST is a fixed UTC+05:30 offset with no DST,
 * so all arithmetic is done on shifted epoch millis with UTC getters. This is
 * deterministic and independent of the server's own TZ.
 */
export const IST_OFFSET_MIN = 330;
const IST_OFFSET_MS = IST_OFFSET_MIN * 60_000;
const DAY_MS = 86_400_000;

export type DateKey = string; // YYYY-MM-DD in IST

export function istShift(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

export function istDateKey(d: Date): DateKey {
  const s = istShift(d);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

export function istHour(d: Date): number {
  return istShift(d).getUTCHours();
}

export function istMinute(d: Date): number {
  return istShift(d).getUTCMinutes();
}

/** 0 = Sunday … 6 = Saturday, in IST */
export function istWeekday(d: Date): number {
  return istShift(d).getUTCDay();
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isDateKey(s: string): s is DateKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** UTC instant for HH:MM IST on the given IST date. */
export function istToUtc(key: DateKey, hour = 0, minute = 0): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MS);
}

export function addDays(key: DateKey, n: number): DateKey {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function diffDays(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / DAY_MS);
}

function weekdayOfKey(key: DateKey): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";
export const PART_OF_DAY_START_HOUR: Record<PartOfDay, number> = {
  morning: 7,
  afternoon: 12,
  evening: 16,
  night: 19,
};

export interface ResolvedDate {
  dateKey: DateKey;
  /** the phrase that matched */
  matched: string;
  /** exact: unambiguous phrase; assumed: we chose an interpretation (documented) */
  confidence: "exact" | "assumed";
  partOfDay?: PartOfDay;
}

// ---------- lexicon ----------
// Order matters: longer / more specific phrases first.
const L = "(?<![\\p{L}\\p{M}\\p{N}])"; // left boundary that works for Indic scripts
const R = "(?![\\p{L}\\p{M}\\p{N}])";
const rx = (alts: string[]) => new RegExp(`${L}(?:${alts.join("|")})${R}`, "iu");

const OFFSET_PHRASES: { offset: number; re: RegExp; confidence: "exact" | "assumed" }[] = [
  { offset: 2, re: rx(["day after tomorrow", "parson", "parso", "parsoon", "parsun", "parsõ", "परसों", "परसो", "ellundi", "ఎల్లుండి"]), confidence: "exact" },
  { offset: 3, re: rx(["narson", "narso", "नरसों", "नरसो"]), confidence: "exact" },
  // "kal" is ambiguous (yesterday/tomorrow); task planning is future tense, so tomorrow. Documented in ARCHITECTURE.md.
  { offset: 1, re: rx(["tomorrow", "kal", "kaal", "kl", "कल", "repu", "రేపు"]), confidence: "exact" },
  { offset: 0, re: rx(["today", "aaj", "aj", "abhi", "आज", "अभी", "eeroju", "ee roju", "ivvala", "ivala", "ippudu", "ఈరోజు", "ఈ రోజు", "ఇవాళ", "ఇప్పుడు"]), confidence: "exact" },
  { offset: 7, re: rx(["next week", "agle hafte", "agle hafta", "agle saptah", "अगले हफ्ते", "अगले हफ़्ते", "अगले सप्ताह", "vachhe vaaram", "vache varam", "వచ్చే వారం"]), confidence: "assumed" },
];

const WEEKDAYS: { day: number; names: string[] }[] = [
  { day: 1, names: ["monday", "somvar", "somwar", "सोमवार", "somavaram", "సోమవారం"] },
  { day: 2, names: ["tuesday", "mangalvar", "mangalwar", "मंगलवार", "mangalavaram", "మంగళవారం"] },
  { day: 3, names: ["wednesday", "budhvar", "budhwar", "बुधवार", "budhavaram", "బుధవారం"] },
  { day: 4, names: ["thursday", "guruvar", "guruwar", "brihaspativar", "गुरुवार", "बृहस्पतिवार", "guruvaram", "గురువారం"] },
  { day: 5, names: ["friday", "shukravar", "shukrawar", "शुक्रवार", "sukravaram", "shukravaram", "శుక్రవారం"] },
  { day: 6, names: ["saturday", "shanivar", "shaniwar", "शनिवार", "shanivaram", "sanivaram", "శనివారం"] },
  { day: 0, names: ["sunday", "ravivar", "raviwar", "itvaar", "itwar", "रविवार", "इतवार", "aadivaram", "adivaram", "ఆదివారం"] },
];

const NUMBER_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, sat: 7, aath: 8, nau: 9, das: 10,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  okati: 1, rendu: 2, moodu: 3, mudu: 3, naalugu: 4, nalugu: 4, aidu: 5, ఒక: 1, రెండు: 2, మూడు: 3, నాలుగు: 4, ఐదు: 5,
};

const PART_OF_DAY: { part: PartOfDay; re: RegExp }[] = [
  { part: "morning", re: rx(["morning", "subah", "subha", "savere", "sawere", "सुबह", "सवेरे", "poddunna", "udayam", "పొద్దున", "ఉదయం"]) },
  { part: "afternoon", re: rx(["afternoon", "dopahar", "dopehar", "दोपहर", "madhyanam", "మధ్యాహ్నం"]) },
  { part: "evening", re: rx(["evening", "shaam", "sham", "शाम", "sayantram", "saayantram", "సాయంత్రం"]) },
  { part: "night", re: rx(["night", "raat", "rat", "रात", "raatri", "ratri", "రాత్రి"]) },
];

function detectPartOfDay(text: string): PartOfDay | undefined {
  for (const p of PART_OF_DAY) if (p.re.test(text)) return p.part;
  return undefined;
}

/**
 * Resolve a relative/absolute date phrase in Hindi, Hinglish, Telugu or English
 * against `now`, in Asia/Kolkata. Returns null when nothing date-like is found
 * (callers must then ask, never guess).
 */
export function resolveRelativeDate(input: string, now: Date): ResolvedDate | null {
  const text = input.normalize("NFC").toLowerCase().replace(/[.,!?।]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const today = istDateKey(now);
  const partOfDay = detectPartOfDay(text);

  // ISO date
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso && isDateKey(iso[0])) return { dateKey: iso[0], matched: iso[0], confidence: "exact", partOfDay };

  // dd/mm or dd-mm(-yyyy)
  const dmy = text.match(/(?<!\d)(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?!\d)/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = dmy[3] ? Number(dmy[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    let key = `${y}-${pad(m)}-${pad(d)}`;
    if (isDateKey(key)) {
      if (!dmy[3] && diffDays(key, today) < 0) key = `${y + 1}-${pad(m)}-${pad(d)}`;
      return { dateKey: key, matched: dmy[0], confidence: dmy[3] ? "exact" : "assumed", partOfDay };
    }
  }

  // "N din baad / N din mein / in N days / N rojulu"
  const nDays = text.match(
    new RegExp(`${L}(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})\\s*(?:din|dino|दिन|दिनों|days?|rojulu|roju|రోజులు|రోజుల|రోజు)${R}`, "iu"),
  );
  if (nDays && nDays[1]) {
    const raw = nDays[1];
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (n !== undefined && n >= 0 && n <= 60) {
      return { dateKey: addDays(today, n), matched: nDays[0], confidence: "exact", partOfDay };
    }
  }

  for (const p of OFFSET_PHRASES) {
    const m = text.match(p.re);
    if (m) return { dateKey: addDays(today, p.offset), matched: m[0], confidence: p.confidence, partOfDay };
  }

  for (const w of WEEKDAYS) {
    const m = text.match(rx(w.names));
    if (m) {
      const cur = weekdayOfKey(today);
      let delta = (w.day - cur + 7) % 7;
      if (delta === 0) delta = 7; // "somvar" said on a Monday means next Monday
      return { dateKey: addDays(today, delta), matched: m[0], confidence: "assumed", partOfDay };
    }
  }

  // "15 tarikh" / "15 ko" / "15th" / "15 तारीख"
  const dom = text.match(new RegExp(`${L}(\\d{1,2})\\s*(?:tarikh|tareekh|तारीख|तारिख|ko|को|th|st|nd|rd|tedi|తేదీ)${R}`, "iu"));
  if (dom && dom[1]) {
    const d = Number(dom[1]);
    if (d >= 1 && d <= 31) {
      let [y, m] = today.split("-").map(Number) as [number, number];
      for (let i = 0; i < 3; i++) {
        const key = `${y}-${pad(m)}-${pad(d)}`;
        if (isDateKey(key) && diffDays(key, today) >= 0) {
          return { dateKey: key, matched: dom[0], confidence: "assumed", partOfDay };
        }
        m += 1;
        if (m > 12) { m = 1; y += 1; }
      }
    }
  }

  if (partOfDay) return { dateKey: today, matched: "", confidence: "assumed", partOfDay };
  return null;
}

/** Human friendly label for a date key relative to today. */
export function relativeLabel(key: DateKey, now: Date, lang: "hi" | "te"): string {
  const d = diffDays(key, istDateKey(now));
  const hi: Record<number, string> = { [-1]: "कल (बीता)", 0: "आज", 1: "कल", 2: "परसों", 3: "नरसों" };
  const te: Record<number, string> = { [-1]: "నిన్న", 0: "ఈరోజు", 1: "రేపు", 2: "ఎల్లుండి" };
  const table = lang === "te" ? te : hi;
  if (table[d]) return table[d] as string;
  const [, m, day] = key.split("-");
  return `${Number(day)}/${Number(m)}`;
}

export function formatIstTime(d: Date): string {
  const s = istShift(d);
  return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}
