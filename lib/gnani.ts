/**
 * Gnani Speech API client (server-only). Verified against docs.gnani.ai (Nov 2026):
 *   STT  POST {base}/stt/v3                 multipart: audio_file, model, language_code, format, keyterms, topic
 *   TTS  POST {base}/api/v1/tts/inference   JSON → binary audio
 *   TTS  POST {base}/api/v1/tts/sse         JSON → SSE events start | chunk{audio b64} | complete
 * Auth: X-API-Key-ID. STT and TTS keys are scoped separately (GNANI_STT_API_KEY / GNANI_TTS_API_KEY;
 * GNANI_API_KEY is accepted as a fallback for both). Keys never leave the server and are never logged.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { log } from "@/lib/log";

export interface SttOptions {
  languageCode: string; // e.g. "hi-IN,en-IN" | "te-IN,en-IN" | "indic-auto"
  format?: "verbatim" | "transcribe" | "codemix" | "transliterate";
  keyterms?: string[];
  topic?: string;
  filename?: string; // extension decides the decoder: .wav/.mp3/.ogg/...
}
export interface SttResult { transcript: string; detectedLanguage: string | null; model: string | null; latencyMs: number; requestId: string | null }
export interface TtsOptions { language: string; voice: string; speed?: number }
export interface TtsResult { audio: Buffer; contentType: string; cached: boolean; latencyMs: number }

export interface SpeechToText { available(): boolean; transcribe(audio: Buffer, o: SttOptions): Promise<SttResult> }
export interface TextToSpeech {
  available(): boolean;
  synthesize(text: string, o: TtsOptions): Promise<TtsResult>;
  cached(text: string, o: TtsOptions): TtsResult | null;
}

export class GnaniError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable: boolean) {
    super(message);
  }
}
export class NotConfiguredError extends Error {
  constructor(public service: "stt" | "tts" | "llm") {
    super(`${service.toUpperCase()} is not configured on the server`);
  }
}

const base = () => (process.env.GNANI_BASE_URL || "https://api.vachana.ai").replace(/\/$/, "");
const sttKey = () => process.env.GNANI_STT_API_KEY || process.env.GNANI_API_KEY || "";
const ttsKey = () => process.env.GNANI_TTS_API_KEY || process.env.GNANI_API_KEY || "";
export const STT_MODEL = () => process.env.GNANI_STT_MODEL || "prisma-v3.0";
export const TTS_MODEL = () => process.env.GNANI_TTS_MODEL || "timbre-v3.0";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Accounts can be limited to one active request; serialise calls per service. */
class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
const sttQueue = new Serial();
const ttsQueue = new Serial();

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let wait = 400;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e instanceof GnaniError ? e.retryable : e instanceof TypeError || (e as Error).name === "AbortError";
      if (!retryable || i >= attempts) throw e;
      log.warn("gnani.retry", { label, attempt: i, status: e instanceof GnaniError ? e.status : "network" });
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

async function toError(res: Response): Promise<GnaniError> {
  let code = `HTTP_${res.status}`;
  let msg = res.statusText;
  try {
    const j = (await res.json()) as Record<string, unknown>;
    const detail = j.detail as Record<string, unknown> | undefined;
    const err = j.error as Record<string, unknown> | string | undefined;
    if (detail && typeof detail === "object" && "error_code" in detail) code = String(detail.error_code);
    else if (err && typeof err === "object" && "type" in err) code = String(err.type);
    else if (typeof j.code === "string") code = j.code;
    msg = String((detail as { message?: string })?.message ?? (err as { message?: string })?.message ?? j.message ?? msg);
  } catch {
    /* non-JSON body */
  }
  return new GnaniError(res.status, code, msg.slice(0, 200), RETRYABLE.has(res.status));
}

const SttResponse = z.object({
  success: z.boolean().optional(),
  request_id: z.string().optional(),
  transcript: z.string(),
  model: z.string().optional(),
  detected_language_code: z.string().optional(),
  truncated: z.boolean().optional(),
});

export const gnaniStt: SpeechToText = {
  available: () => sttKey().length > 0,
  async transcribe(audio, o) {
    if (!this.available()) throw new NotConfiguredError("stt");
    const t0 = Date.now();
    const json = await sttQueue.run(() =>
      withRetry("stt", async () => {
        const fd = new FormData();
        const name = o.filename ?? "audio.wav";
        fd.append("audio_file", new Blob([new Uint8Array(audio)], { type: mimeFor(name) }), name);
        fd.append("model", STT_MODEL());
        fd.append("language_code", o.languageCode);
        if (o.format) fd.append("format", o.format);
        if (STT_MODEL() === "prisma-v3.0") {
          if (o.keyterms?.length) fd.append("keyterms", JSON.stringify(o.keyterms.slice(0, 200)));
          if (o.topic) fd.append("topic", o.topic.slice(0, 1600));
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        try {
          const res = await fetch(`${base()}/stt/v3`, { method: "POST", headers: { "X-API-Key-ID": sttKey() }, body: fd, signal: ctrl.signal });
          if (!res.ok) throw await toError(res);
          return SttResponse.parse(await res.json());
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    const latencyMs = Date.now() - t0;
    log.info("gnani.stt.ok", { latencyMs, chars: json.transcript.length, lang: json.detected_language_code ?? null, truncated: !!json.truncated });
    return { transcript: json.transcript.trim(), detectedLanguage: json.detected_language_code ?? null, model: json.model ?? null, latencyMs, requestId: json.request_id ?? null };
  },
};

function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : ext === "flac" ? "audio/flac" : ext === "m4a" ? "audio/mp4" : "audio/wav";
}

// ---------- TTS ----------
const CACHE_DIR = () => path.resolve(process.env.KS_TTS_CACHE_DIR || "./data/tts-cache");
export function ttsCacheKey(text: string, o: TtsOptions) {
  return crypto.createHash("sha256").update(JSON.stringify([TTS_MODEL(), o.voice, o.language, o.speed ?? 1, text.normalize("NFC").trim()])).digest("hex").slice(0, 40);
}
export function ttsBody(text: string, o: TtsOptions) {
  return {
    text,
    voice: o.voice,
    model: TTS_MODEL(),
    language: o.language,
    speed: o.speed ?? 1.0,
    audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, container: "mp3", bitrate: "96k" },
  };
}

export const gnaniTts: TextToSpeech = {
  available: () => ttsKey().length > 0,
  cached(text, o) {
    const f = path.join(CACHE_DIR(), `${ttsCacheKey(text, o)}.mp3`);
    if (!fs.existsSync(f)) return null;
    return { audio: fs.readFileSync(f), contentType: "audio/mpeg", cached: true, latencyMs: 0 };
  },
  async synthesize(text, o) {
    const hit = this.cached(text, o);
    if (hit) return hit;
    if (!this.available()) throw new NotConfiguredError("tts");
    const t0 = Date.now();
    const audio = await ttsQueue.run(() =>
      withRetry("tts", async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        try {
          const res = await fetch(`${base()}/api/v1/tts/inference`, {
            method: "POST",
            headers: { "X-API-Key-ID": ttsKey(), "Content-Type": "application/json" },
            body: JSON.stringify(ttsBody(text, o)),
            signal: ctrl.signal,
          });
          if (!res.ok) throw await toError(res);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 100) throw new GnaniError(502, "EMPTY_AUDIO", "TTS returned no audio", true);
          return buf;
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    try {
      fs.mkdirSync(CACHE_DIR(), { recursive: true });
      fs.writeFileSync(path.join(CACHE_DIR(), `${ttsCacheKey(text, o)}.mp3`), audio);
    } catch (e) {
      log.warn("gnani.tts.cache_write_failed", { error: (e as Error).message });
    }
    const latencyMs = Date.now() - t0;
    log.info("gnani.tts.ok", { latencyMs, bytes: audio.length, chars: text.length });
    return { audio, contentType: "audio/mpeg", cached: false, latencyMs };
  },
};

/** Streaming TTS via SSE: yields mp3 byte chunks as Gnani produces them. */
export async function* gnaniTtsStream(text: string, o: TtsOptions): AsyncGenerator<Buffer> {
  if (!gnaniTts.available()) throw new NotConfiguredError("tts");
  const res = await fetch(`${base()}/api/v1/tts/sse`, {
    method: "POST",
    headers: { "X-API-Key-ID": ttsKey(), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(ttsBody(text, o)),
  });
  if (!res.ok || !res.body) throw await toError(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
      const data = /^data:\s*(.+)$/m.exec(block)?.[1];
      if (!data) continue;
      if (ev === "error") throw new GnaniError(502, "TTS_STREAM_ERROR", data.slice(0, 200), true);
      try {
        const j = JSON.parse(data) as { audio?: string };
        if (j.audio) yield Buffer.from(j.audio, "base64");
      } catch {
        /* ignore malformed */
      }
    }
  }
}
