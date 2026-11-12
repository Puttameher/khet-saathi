/**
 * MediaRecorder output (webm/opus, mp4/aac, …) → 16 kHz mono 16-bit WAV, the format
 * /api/voice forwards to Gnani Prisma. Uses the pure helpers in wav.ts.
 */
import { downsample, encodeWav, TARGET_RATE } from "@/lib/client/wav";

export async function blobToWav16k(blob: Blob): Promise<{ wav: Blob; seconds: number; peak: number }> {
  const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close().catch(() => {});
  }
  // down-mix to mono
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i]! += ch[i]! / decoded.numberOfChannels;
  }
  const pcm = decoded.sampleRate >= TARGET_RATE ? downsample(mono, decoded.sampleRate, TARGET_RATE) : mono;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]!));
  const rate = decoded.sampleRate >= TARGET_RATE ? TARGET_RATE : decoded.sampleRate;
  return { wav: new Blob([encodeWav(pcm, rate)], { type: "audio/wav" }), seconds: decoded.duration, peak };
}
