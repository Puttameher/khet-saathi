/**
 * Browser-side API client. Mirrors the contracts in app/api/* exactly; no keys here —
 * every Gnani/LLM call happens server-side. All functions throw ApiError with a
 * human-friendly code that the UI maps to a message (see errorMessage).
 */
import type { AppState, TaskView } from "@/lib/state";
import type { TurnResult } from "@/lib/conversation";
import type { Briefing } from "@/lib/conversation";
import type { Lang } from "@/lib/config";

export type { AppState, TaskView, TurnResult, Briefing, Lang };

export class ApiError extends Error {
  constructor(public code: string, public status: number, public service?: string) {
    super(code);
  }
}

async function call<T>(url: string, init?: RequestInit, timeoutMs = 25_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } catch (e) {
    throw new ApiError((e as Error).name === "AbortError" ? "TIMEOUT" : "NETWORK", 0);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; service?: string };
    throw new ApiError(b.error ?? `HTTP_${res.status}`, res.status, b.service);
  }
  return body as T;
}

const json = (b: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

export const api = {
  state: (force = false) => call<AppState>(`/api/state${force ? "?force=1" : ""}`),
  briefing: () => call<{ briefing: Briefing | { text: string; onboarding: string }; state: AppState }>("/api/briefing", { method: "POST" }),
  turn: (text: string, lang?: Lang, mode: "talk" | "checkin" = "talk") =>
    call<{ turn: TurnResult; state: AppState }>("/api/turn", json({ text, lang, mode })),
  voice: (wav: Blob, lang?: Lang, mode: "talk" | "checkin" = "talk") => {
    const fd = new FormData();
    fd.append("audio", wav, "speech.wav");
    if (lang) fd.append("lang", lang);
    fd.append("mode", mode);
    return call<{ transcript: string; turn: TurnResult | null; state?: AppState; stt?: { latencyMs: number } }>("/api/voice", { method: "POST", body: fd }, 40_000);
  },
  taskEvent: (id: string, event: "START" | "COMPLETE" | "POSTPONE" | "CANCEL" | "KEEP") =>
    call<{ task: unknown; state: AppState }>(`/api/tasks/${encodeURIComponent(id)}`, { ...json({ event }), method: "PATCH" }),
  reschedule: (id: string, date: string) =>
    call<{ task: unknown; state: AppState }>(`/api/tasks/${encodeURIComponent(id)}`, { ...json({ event: "RESCHEDULE", date }), method: "PATCH" }),
  ackAlerts: (ids: string[]) => call<{ state: AppState }>("/api/alerts", json({ ids })),
  monitor: () => call<{ state: AppState }>("/api/monitor", { method: "POST" }, 30_000),
};

export const ttsUrl = (text: string, lang: Lang) => `/api/tts?lang=${lang}&text=${encodeURIComponent(text.slice(0, 600))}`;

const MSG: Record<Lang, Record<string, string>> = {
  hi: {
    NETWORK: "इंटरनेट नहीं मिल रहा। थोड़ी देर में फिर कोशिश करें।",
    TIMEOUT: "जवाब आने में देर हो गई। फिर से कोशिश करें।",
    NOT_CONFIGURED: "आवाज़ सेवा अभी चालू नहीं है। लिखकर बात करें।",
    UPSTREAM: "आवाज़ सेवा अभी जवाब नहीं दे रही। लिखकर बात करें।",
    RATE_LIMITED: "बहुत जल्दी-जल्दी अनुरोध। एक पल रुकें।",
    AUDIO_TOO_SHORT: "आवाज़ बहुत छोटी थी। बटन दबाकर बोलिए।",
    AUDIO_TOO_LARGE: "रिकॉर्डिंग बहुत लंबी है। छोटा बोलिए।",
    NO_SPEECH: "कुछ सुनाई नहीं दिया। फिर से बोलिए।",
    MIC_DENIED: "माइक की अनुमति नहीं मिली। सेटिंग में माइक चालू करें, या लिखें।",
    MIC_UNSUPPORTED: "इस फ़ोन/ब्राउज़र में रिकॉर्डिंग नहीं चलती। लिखकर बात करें।",
    PLAYBACK: "आवाज़ चल नहीं पाई। जवाब नीचे लिखा है।",
    INVALID_TRANSITION: "यह काम अभी इस तरह नहीं बदल सकता।",
    TERMINAL: "यह काम पहले ही पूरा या रद्द हो चुका है।",
    default: "कुछ गड़बड़ हुई। फिर से कोशिश करें।",
  },
  te: {
    NETWORK: "ఇంటర్నెట్ అందడం లేదు. కాసేపాగి మళ్ళీ ప్రయత్నించండి.",
    TIMEOUT: "జవాబు ఆలస్యమైంది. మళ్ళీ ప్రయత్నించండి.",
    NOT_CONFIGURED: "వాయిస్ సేవ ఇప్పుడు అందుబాటులో లేదు. టైప్ చేయండి.",
    UPSTREAM: "వాయిస్ సేవ జవాబు ఇవ్వడం లేదు. టైప్ చేయండి.",
    RATE_LIMITED: "చాలా వేగంగా అడుగుతున్నారు. ఒక్క క్షణం ఆగండి.",
    AUDIO_TOO_SHORT: "రికార్డింగ్ చాలా చిన్నది. బటన్ నొక్కి మాట్లాడండి.",
    AUDIO_TOO_LARGE: "రికార్డింగ్ చాలా పొడవు. చిన్నగా చెప్పండి.",
    NO_SPEECH: "ఏమీ వినిపించలేదు. మళ్ళీ చెప్పండి.",
    MIC_DENIED: "మైక్ అనుమతి లేదు. సెట్టింగ్స్‌లో ఆన్ చేయండి, లేదా టైప్ చేయండి.",
    MIC_UNSUPPORTED: "ఈ బ్రౌజర్‌లో రికార్డింగ్ పనిచేయదు. టైప్ చేయండి.",
    PLAYBACK: "ఆడియో ప్లే కాలేదు. జవాబు కింద ఉంది.",
    INVALID_TRANSITION: "ఈ పనిని ఇప్పుడు ఇలా మార్చలేము.",
    TERMINAL: "ఈ పని ఇప్పటికే పూర్తయింది లేదా రద్దయింది.",
    default: "ఏదో పొరపాటు జరిగింది. మళ్ళీ ప్రయత్నించండి.",
  },
};

export function errorMessage(e: unknown, lang: Lang): string {
  const code = e instanceof ApiError ? e.code : e instanceof Error ? e.message : "default";
  const t = MSG[lang];
  return t[code] ?? t.default!;
}
