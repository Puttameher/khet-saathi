/**
 * Browser-side audio helpers: downsample Float32 PCM to 16 kHz mono and encode a 16-bit WAV.
 * Pure functions (no DOM), so they are unit-tested in node.
 */
export const TARGET_RATE = 16_000;

/** Average-based decimation (cheap low-pass) from `fromRate` to `toRate`. */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new Error(`cannot upsample ${fromRate} → ${toRate}`);
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const end = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (; pos < end; pos++) { sum += input[pos]!; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** 16-bit PCM mono WAV (RIFF little-endian). */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLen = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i]! * frame[i]!;
  return Math.sqrt(s / Math.max(1, frame.length));
}
