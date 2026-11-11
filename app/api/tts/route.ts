/**
 * GET /api/tts?text=…&lang=hi  → audio/mpeg
 * Cache hit: served from disk. Miss: Gnani Timbre SSE is piped to the client as it arrives
 * (progressive MP3 playback starts on the first chunk) and written to the cache when complete.
 * Falls back to the REST endpoint if streaming fails before any audio was sent.
 */
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { APP, Lang } from "@/lib/config";
import { gnaniTts, gnaniTtsStream, ttsCacheKey, type TtsOptions } from "@/lib/gnani";
import { errorResponse, rateLimit } from "@/lib/http";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = rateLimit(req, "tts", 40);
  if (limited) return limited;
  const u = new URL(req.url);
  const text = (u.searchParams.get("text") ?? "").trim().slice(0, APP.limits.textMaxChars);
  if (!text) return NextResponse.json({ error: "NO_TEXT" }, { status: 400 });
  const lang = Lang.catch("hi").parse(u.searchParams.get("lang"));
  const o: TtsOptions = { language: APP.languages[lang].ttsLanguage, voice: APP.languages[lang].ttsVoice };
  const hit = gnaniTts.cached(text, o);
  if (hit) return new Response(new Uint8Array(hit.audio), { headers: { "Content-Type": "audio/mpeg", "X-TTS-Cache": "hit", "Cache-Control": "private, max-age=86400" } });
  if (!gnaniTts.available()) return NextResponse.json({ error: "NOT_CONFIGURED", service: "tts" }, { status: 503 });

  // Probe the stream first so upstream errors become proper HTTP errors.
  try {
    const it = gnaniTtsStream(text, o);
    const first = await it.next();
    const chunks: Buffer[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!first.done && first.value) { chunks.push(first.value); controller.enqueue(new Uint8Array(first.value)); }
      },
      async pull(controller) {
        try {
          const n = await it.next();
          if (n.done) {
            controller.close();
            try {
              const dir = path.resolve(process.env.KS_TTS_CACHE_DIR || "./data/tts-cache");
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, `${ttsCacheKey(text, o)}.mp3`), Buffer.concat(chunks));
            } catch { /* cache is best-effort */ }
            return;
          }
          chunks.push(n.value);
          controller.enqueue(new Uint8Array(n.value));
        } catch (e) {
          log.warn("tts.stream_broke", { error: (e as Error).message });
          controller.error(e);
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "audio/mpeg", "X-TTS-Cache": "miss-stream", "Cache-Control": "no-store" } });
  } catch (e) {
    log.warn("tts.stream_failed_fallback_rest", { error: (e as Error).message });
    try {
      const r = await gnaniTts.synthesize(text, o);
      return new Response(new Uint8Array(r.audio), { headers: { "Content-Type": r.contentType, "X-TTS-Cache": "miss-rest" } });
    } catch (e2) {
      return errorResponse(e2, "tts");
    }
  }
}
