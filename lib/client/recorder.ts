/**
 * Mic capture → 16 kHz mono WAV. ScriptProcessor keeps it to one file and works in every
 * mobile browser we target; it is deprecated but still universally shipped.
 * Auto-stops after ~1.5 s of silence once speech has been heard.
 */
import { concatFloat32, downsample, encodeWav, rms } from "@/lib/client/wav";

export interface RecorderOpts {
  onLevel?: (level: number) => void; // 0..1, ~10×/s
  onAutoStop?: () => void;
  silenceMs?: number;
  maxMs?: number;
  noSpeechMs?: number;
}
export interface Recording { wav: Blob; durationMs: number; heardSpeech: boolean }
export interface RecorderHandle { stop: () => Promise<Recording>; cancel: () => void }

const SPEECH_RMS = 0.02;

export async function startRecording(o: RecorderOpts = {}): Promise<RecorderHandle> {
  const silenceMs = o.silenceMs ?? 1500;
  const maxMs = o.maxMs ?? 30_000;
  const noSpeechMs = o.noSpeechMs ?? 8000;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === "suspended") await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  const chunks: Float32Array[] = [];
  const t0 = performance.now();
  let lastLoud = t0;
  let heard = false;
  let done = false;
  let autoFired = false;

  proc.onaudioprocess = (e) => {
    if (done) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    const level = rms(data);
    o.onLevel?.(Math.min(1, level * 8));
    const now = performance.now();
    if (level > SPEECH_RMS) { lastLoud = now; heard = true; }
    const elapsed = now - t0;
    const shouldStop = (heard && now - lastLoud > silenceMs) || elapsed > maxMs || (!heard && elapsed > noSpeechMs);
    if (shouldStop && !autoFired) { autoFired = true; o.onAutoStop?.(); }
  };
  src.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);

  const teardown = () => {
    done = true;
    try { proc.disconnect(); src.disconnect(); sink.disconnect(); } catch { /* already gone */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  return {
    async stop() {
      const rate = ctx.sampleRate;
      teardown();
      const pcm = downsample(concatFloat32(chunks), rate);
      return { wav: new Blob([encodeWav(pcm)], { type: "audio/wav" }), durationMs: (pcm.length / 16000) * 1000, heardSpeech: heard };
    },
    cancel: teardown,
  };
}
