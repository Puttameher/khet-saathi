"use client";
/**
 * One shared <audio> element for Timbre replies. /api/tts streams MP3, so playback
 * starts on the first chunk. `unlock()` must be called inside a user gesture (mic tap,
 * send tap) so iOS/Android allow the later async play().
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "@/lib/client/wav";

export type SpeakState = "idle" | "loading" | "playing";

export function useSpeaker() {
  const el = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<SpeakState>("idle");
  const [currentKey, setCurrentKey] = useState<string | null>(null);

  const get = useCallback(() => {
    if (!el.current && typeof Audio !== "undefined") {
      const a = new Audio();
      a.preload = "auto";
      a.addEventListener("playing", () => setState("playing"));
      a.addEventListener("ended", () => { setState("idle"); setCurrentKey(null); });
      a.addEventListener("pause", () => { if (a.ended || a.currentTime === 0) return; setState("idle"); setCurrentKey(null); });
      el.current = a;
    }
    return el.current;
  }, []);

  useEffect(() => () => { el.current?.pause(); }, []);

  const unlock = useCallback(() => {
    const a = get();
    if (!a || a.dataset.unlocked) return;
    a.dataset.unlocked = "1";
    a.src = URL.createObjectURL(new Blob([encodeWav(new Float32Array(800), 16_000)], { type: "audio/wav" })); // 50 ms of silence
    a.play().then(() => a.pause()).catch(() => {});
  }, [get]);

  const stop = useCallback(() => {
    const a = el.current;
    if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
    setState("idle");
    setCurrentKey(null);
  }, []);

  /** Resolves when playback starts (true) or fails (false). Never rejects. */
  const play = useCallback(async (url: string, key: string): Promise<boolean> => {
    const a = get();
    if (!a) return false;
    a.pause();
    setCurrentKey(key);
    setState("loading");
    a.src = url;
    try {
      await a.play();
      return true;
    } catch {
      setState("idle");
      setCurrentKey(null);
      return false;
    }
  }, [get]);

  return { state, currentKey, play, stop, unlock };
}
