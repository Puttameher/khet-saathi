import { describe, expect, it } from "vitest";
import { concatFloat32, downsample, encodeWav, rms } from "@/lib/client/wav";

describe("client wav encoder", () => {
  it("writes a valid 16 kHz mono 16-bit header", () => {
    const buf = encodeWav(new Float32Array(1600));
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(36)).toBe("data");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(buf.byteLength).toBe(44 + 3200);
  });
  it("clips and scales samples", () => {
    const v = new DataView(encodeWav(new Float32Array([1, -1, 2, 0])));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(32767);
    expect(v.getInt16(50, true)).toBe(0);
  });
  it("downsamples 48k → 16k by length and keeps DC level", () => {
    const out = downsample(new Float32Array(48000).fill(0.5), 48000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.5);
    expect(downsample(new Float32Array(44100), 44100).length).toBe(16000);
  });
  it("concats and measures rms", () => {
    expect(concatFloat32([new Float32Array([1]), new Float32Array([2, 3])])).toEqual(new Float32Array([1, 2, 3]));
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});
