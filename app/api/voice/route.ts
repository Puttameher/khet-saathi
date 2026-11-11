/**
 * Voice turn: audio (16 kHz mono WAV from the browser) → Gnani Prisma STT → conversation → reply text.
 * The client then streams the reply through /api/tts (Gnani Timbre).
 */
import { NextResponse } from "next/server";
import { gnaniStt } from "@/lib/gnani";
import { handleTurn } from "@/lib/conversation";
import { buildState } from "@/lib/state";
import { APP, Lang } from "@/lib/config";
import { getProfile } from "@/lib/repo";
import { errorResponse, rateLimit } from "@/lib/http";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const KEYTERMS = ["स्प्रे", "छिड़काव", "दवाई", "सिंचाई", "पानी", "खाद", "यूरिया", "कटाई", "गेहूं", "धान", "प्याज", "परसों", "नरसों", "हो गया", "spray", "DAP", "మందు", "పిచికారీ", "నీరు", "ఎరువు", "కోత", "వరి", "ఉల్లి", "గోధుమ", "ఎల్లుండి", "రేపు"];

export async function POST(req: Request) {
  const limited = rateLimit(req, "voice", 20);
  if (limited) return limited;
  try {
    const len = Number(req.headers.get("content-length") || "0");
    if (len > APP.limits.audioMaxBytes + 4096) return NextResponse.json({ error: "AUDIO_TOO_LARGE" }, { status: 413 });
    const fd = await req.formData();
    const audio = fd.get("audio");
    if (!(audio instanceof Blob)) return NextResponse.json({ error: "NO_AUDIO" }, { status: 400 });
    if (audio.size > APP.limits.audioMaxBytes) return NextResponse.json({ error: "AUDIO_TOO_LARGE" }, { status: 413 });
    if (audio.size < 1000) return NextResponse.json({ error: "AUDIO_TOO_SHORT" }, { status: 400 });
    const lang = Lang.catch(getProfile().language).parse(fd.get("lang"));
    const mode = fd.get("mode") === "checkin" ? "checkin" : "talk";
    const cfg = APP.languages[lang];
    const t0 = Date.now();
    const stt = await gnaniStt.transcribe(Buffer.from(await audio.arrayBuffer()), {
      languageCode: cfg.sttLanguageCode,
      format: cfg.sttFormat,
      keyterms: KEYTERMS,
      topic: "Farmer talking about crop field tasks: spraying, irrigation, fertilizer, harvest, weather, dates",
      filename: "speech.wav",
    });
    if (!stt.transcript) return NextResponse.json({ transcript: "", stt: { latencyMs: stt.latencyMs }, turn: null });
    const turn = await handleTurn(stt.transcript, { lang, mode });
    log.info("voice.turn", { sttMs: stt.latencyMs, totalMs: Date.now() - t0, intent: turn.intent?.kind ?? "onboarding" });
    return NextResponse.json({ transcript: stt.transcript, stt: { latencyMs: stt.latencyMs, detectedLanguage: stt.detectedLanguage }, turn, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "voice");
  }
}
