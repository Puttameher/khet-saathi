/**
 * Smoke test for Gnani Prisma (STT) and Timbre (TTS).
 *
 *   npx tsx scripts/smoke-gnani.ts [--audio path/to/clip.wav] [--lang hi|te] [--only stt|tts]
 *
 * Reads GNANI_STT_API_KEY / GNANI_TTS_API_KEY (or GNANI_API_KEY) from the environment / .env.
 * Never prints keys. Flow: TTS a farmer sentence → save to data/smoke/ → STT that audio
 * (round trip). If TTS is unavailable, STT runs on --audio, else on a generated 1 s tone
 * (proves endpoint + auth; transcript will be empty).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

loadDotEnv();

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const lang = (arg("lang") ?? "hi") as "hi" | "te";
const only = arg("only");
const BASE = (process.env.GNANI_BASE_URL || "https://api.vachana.ai").replace(/\/$/, "");
const sttKey = process.env.GNANI_STT_API_KEY || process.env.GNANI_API_KEY || "";
const ttsKey = process.env.GNANI_TTS_API_KEY || process.env.GNANI_API_KEY || "";
const SENTENCES = { hi: "परसों स्प्रे करना है", te: "ఎల్లుండి మందు కొట్టాలి" };
const LANG_CODES = { hi: { stt: "hi-IN,en-IN", tts: "hi-IN" }, te: { stt: "te-IN,en-IN", tts: "te-IN" } };
const outDir = path.resolve("data/smoke");
fs.mkdirSync(outDir, { recursive: true });

async function tts(): Promise<string | null> {
  if (!ttsKey) {
    console.log("TTS  SKIP  no GNANI_TTS_API_KEY / GNANI_API_KEY in env");
    return null;
  }
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v1/tts/inference`, {
    method: "POST",
    headers: { "X-API-Key-ID": ttsKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: SENTENCES[lang],
      voice: "Shivani",
      model: process.env.GNANI_TTS_MODEL || "timbre-v3.0",
      language: LANG_CODES[lang].tts,
      speed: 1.0,
      audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, container: "mp3", bitrate: "96k" },
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`TTS  FAIL  HTTP ${res.status} in ${ms} ms: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(outDir, `tts-${lang}.mp3`);
  fs.writeFileSync(file, buf);
  console.log(`TTS  OK    ${buf.length} bytes (${res.headers.get("content-type")}) in ${ms} ms → ${path.relative(process.cwd(), file)}`);
  return file;
}

function toWav16k(input: string): string {
  const out = input.replace(/\.[^.]+$/, "") + "-16k.wav";
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", out]);
  return out;
}

async function stt(file: string) {
  if (!sttKey) {
    console.log("STT  SKIP  no GNANI_STT_API_KEY / GNANI_API_KEY in env");
    return;
  }
  const fd = new FormData();
  fd.append("audio_file", new Blob([new Uint8Array(fs.readFileSync(file))], { type: "audio/wav" }), path.basename(file));
  fd.append("model", process.env.GNANI_STT_MODEL || "prisma-v3.0");
  fd.append("language_code", LANG_CODES[lang].stt);
  fd.append("format", "codemix");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/stt/v3`, { method: "POST", headers: { "X-API-Key-ID": sttKey }, body: fd });
  const ms = Date.now() - t0;
  const body = await res.text();
  if (!res.ok) {
    console.log(`STT  FAIL  HTTP ${res.status} in ${ms} ms: ${body.slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  const j = JSON.parse(body) as { transcript: string; detected_language_code?: string; model?: string; end_to_end_latency?: number };
  console.log(`STT  OK    ${ms} ms round trip (server e2e ${j.end_to_end_latency ?? "?"} s), model=${j.model ?? "?"}, lang=${j.detected_language_code ?? "-"}`);
  console.log(`           transcript: ${JSON.stringify(j.transcript)}`);
}

async function main() {
  console.log(`Gnani smoke · base ${BASE} · lang ${lang}`);
  let audio: string | null = null;
  if (only !== "stt") audio = await tts();
  if (only === "tts") return;
  const provided = arg("audio");
  let file: string;
  if (provided) file = provided.endsWith(".wav") ? provided : toWav16k(provided);
  else if (audio) file = toWav16k(audio);
  else {
    file = path.join(outDir, "tone-16k.wav");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", "16000", "-ac", "1", file]);
    console.log("STT  note  no speech audio available; sending a 1 s tone (expect empty transcript)");
  }
  await stt(file);
  console.log("Language overlap (docs, Nov 2026): hi, en, ta, te, kn, ml, mr, pa, bn, gu → Khet Saathi uses hi (+Hinglish) and te.");
}

function loadDotEnv() {
  const f = path.resolve(".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

main().catch((e) => {
  console.error("smoke failed:", (e as Error).message);
  process.exit(1);
});
