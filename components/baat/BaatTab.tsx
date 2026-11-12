"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage, ApiError } from "@/lib/client/api";
import { blobToWav16k } from "@/lib/client/decode";
import { useRecorder } from "@/lib/client/useRecorder";
import { useApp } from "@/components/shell/AppContext";
import { BriefingCard } from "@/components/shell/BriefingCard";
import { Celebrate } from "@/components/shell/Celebrate";
import { IconKeyboard, IconMic, IconPause, IconRefresh, IconSend, IconSpeaker } from "@/components/shell/Icons";
import { istClock } from "@/components/shell/time";
import { MicButton } from "@/components/baat/MicButton";
import { Waveform, type WaveMode } from "@/components/baat/Waveform";

type Pending =
  | { id: string; kind: "voice"; wav: Blob; status: "sending" | "failed"; error?: string }
  | { id: string; kind: "text"; text: string; status: "sending" | "failed"; error?: string };

export function BaatTab() {
  const { state, setState, lang, t, say, speaker, toast } = useApp();
  const [pending, setPending] = useState<Pending[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [burst, setBurst] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = pending.some((p) => p.status === "sending");

  const afterTurn = useCallback(async (reply: string | undefined, celebrate: boolean, id: string) => {
    if (celebrate) setBurst((b) => b + 1);
    if (reply) await say(reply, `reply-${id}`);
  }, [say]);

  const sendVoice = useCallback(async (p: Extract<Pending, { kind: "voice" }>) => {
    setPending((xs) => [...xs.filter((x) => x.id !== p.id), { ...p, status: "sending", error: undefined }]);
    try {
      const r = await api.voice(p.wav, lang);
      setPending((xs) => xs.filter((x) => x.id !== p.id));
      if (r.state) setState(r.state);
      if (!r.transcript || !r.turn) { toast(errorMessage(new Error("NO_SPEECH"), lang), "info"); return; }
      await afterTurn(r.turn.reply, r.turn.celebrate, p.id);
    } catch (e) {
      const msg = errorMessage(e, lang);
      setPending((xs) => xs.map((x) => (x.id === p.id ? { ...x, status: "failed", error: msg } : x)));
      if (e instanceof ApiError && (e.code === "NOT_CONFIGURED" || e.code === "UPSTREAM")) setTyping(true);
    }
  }, [lang, setState, toast, afterTurn]);

  const sendText = useCallback(async (p: Extract<Pending, { kind: "text" }>) => {
    setPending((xs) => [...xs.filter((x) => x.id !== p.id), { ...p, status: "sending", error: undefined }]);
    try {
      const r = await api.turn(p.text, lang);
      setPending((xs) => xs.filter((x) => x.id !== p.id));
      setState(r.state);
      await afterTurn(r.turn.reply, r.turn.celebrate, p.id);
    } catch (e) {
      const msg = errorMessage(e, lang);
      setPending((xs) => xs.map((x) => (x.id === p.id ? { ...x, status: "failed", error: msg } : x)));
    }
  }, [lang, setState, afterTurn]);

  const rec = useRecorder(async (blob, ms) => {
    if (ms < 600) { toast(errorMessage(new Error("AUDIO_TOO_SHORT"), lang), "info"); return; }
    const id = `v${Date.now()}`;
    try {
      const { wav, peak } = await blobToWav16k(blob);
      if (peak < 0.01) { toast(errorMessage(new Error("NO_SPEECH"), lang), "info"); return; }
      void sendVoice({ id, kind: "voice", wav, status: "sending" });
    } catch {
      toast(errorMessage(new Error("MIC_UNSUPPORTED"), lang));
    }
  });

  useEffect(() => {
    if (rec.error) {
      toast(errorMessage(new Error(rec.error), lang));
      setTyping(true);
      rec.setError(null);
    }
  }, [rec, rec.error, lang, toast]);

  const replying = speaker.state !== "idle" && (speaker.currentKey?.startsWith("reply-") ?? false);
  const mode: WaveMode = rec.state === "recording" ? "recording" : busy ? "thinking" : replying ? "speaking" : "idle";

  const onMic = () => {
    speaker.unlock();
    try { navigator.vibrate?.(12); } catch { /* noop */ }
    if (rec.state === "recording") return rec.stop(false);
    if (speaker.state !== "idle") speaker.stop();
    void rec.start();
  };

  const submitText = (text: string) => {
    const v = text.trim();
    if (!v || v.length > 600) return;
    speaker.unlock();
    setDraft("");
    void sendText({ id: `t${Date.now()}`, kind: "text", text: v, status: "sending" });
  };

  const messages = state?.messages ?? [];
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending.length]);
  useEffect(() => { if (typing) inputRef.current?.focus(); }, [typing]);

  const status = mode === "recording" ? t.listening : mode === "thinking" ? t.thinking : mode === "speaking" ? t.speaking : t.tapToSpeak;

  return (
    <div id="panel-baat" className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-3" aria-live="polite">
        <div className="mb-3"><BriefingCard compact /></div>
        {messages.length === 0 && pending.length === 0 && (
          <div className="mt-6 text-center">
            <p className="font-display text-[26px] leading-tight">{state?.onboardingPrompt ?? t.emptyChat}</p>
          </div>
        )}
        <ul className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <Bubble key={m.id} role={m.role} text={m.text} at={m.at} playing={speaker.currentKey === `msg-${m.id}` && speaker.state !== "idle"} onPlay={m.role === "saathi" ? () => (speaker.currentKey === `msg-${m.id}` ? speaker.stop() : void say(m.text, `msg-${m.id}`)) : undefined} labels={t} />
            ))}
            {pending.map((p) => (
              <motion.li key={p.id} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-end gap-1">
                <div className="max-w-[82%] rounded-[22px] rounded-br-[8px] px-4 py-3 text-[16px] leading-snug" style={{ background: "color-mix(in oklab, var(--ks-haldi) 22%, var(--card))", opacity: p.status === "failed" ? 0.7 : 1 }}>
                  {p.kind === "text" ? p.text : (
                    <span className="flex items-center gap-2 text-[var(--muted)]"><IconMic size={18} /><span className={p.status === "sending" ? "shine rounded px-6" : ""}>{p.status === "sending" ? "\u00a0" : "🎙"}</span></span>
                  )}
                </div>
                {p.status === "failed" && (
                  <button className="tap flex items-center gap-1.5 rounded-full px-3 text-[13px] font-medium" style={{ color: "var(--ks-clay)" }} onClick={() => (p.kind === "voice" ? void sendVoice(p) : void sendText(p))}>
                    <IconRefresh size={16} /> {p.error} · {t.retry}
                  </button>
                )}
              </motion.li>
            ))}
            {busy && (
              <motion.li key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex">
                <div className="glass flex h-11 items-center gap-1.5 rounded-[22px] rounded-bl-[8px] px-4">
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} className="h-2 w-2 rounded-full" style={{ background: "var(--ks-haldi-deep)" }} animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />
                  ))}
                </div>
              </motion.li>
            )}
          </AnimatePresence>
        </ul>
        {messages.length < 3 && !busy && (
          <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
            {t.examples.map((ex) => (
              <button key={ex} onClick={() => submitText(ex)} className="tap glass shrink-0 rounded-full px-4 text-[14.5px]">{ex}</button>
            ))}
          </div>
        )}
      </div>

      {/* dock */}
      <div className="relative px-4 pb-1 pt-1">
        <AnimatePresence mode="wait" initial={false}>
          {typing ? (
            <motion.form
              key="type"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              onSubmit={(e) => { e.preventDefault(); submitText(draft); }}
              className="glass-strong flex items-center gap-2 rounded-[28px] p-1.5"
            >
              <button type="button" onClick={() => setTyping(false)} className="tap grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ color: "var(--ks-clay)" }} aria-label={t.tapToSpeak}>
                <IconMic size={24} />
              </button>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={600}
                enterKeyHint="send"
                placeholder={t.typeHere}
                className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--subtle)]"
                aria-label={t.typeHere}
              />
              <button type="submit" disabled={!draft.trim() || busy} className="tap grid h-14 w-14 shrink-0 place-items-center rounded-full disabled:opacity-40" style={{ background: "var(--ks-haldi)", color: "var(--ks-loam-900)" }} aria-label={t.send}>
                <IconSend size={22} />
              </button>
            </motion.form>
          ) : (
            <motion.div key="talk" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex flex-col items-center">
              <div className="h-10 w-full max-w-[320px]">
                <Waveform analyserRef={rec.analyserRef} mode={mode} />
              </div>
              <div className="relative flex w-full items-center justify-center">
                <button onClick={() => setTyping(true)} className="tap glass absolute left-2 grid h-14 w-14 place-items-center rounded-full" aria-label={t.typeInstead} style={{ color: "var(--ks-monsoon)" }}>
                  <IconKeyboard size={24} />
                </button>
                <div className="relative">
                  <MicButton mode={mode} onPress={onMic} label={status} disabled={busy && rec.state !== "recording"} />
                  {burst > 0 && <Celebrate key={burst} count={16} radius={90} />}
                </div>
                {replying && (
                  <button onClick={speaker.stop} className="tap glass absolute right-2 grid h-14 w-14 place-items-center rounded-full" aria-label="Stop" style={{ color: "var(--ks-haldi-deep)" }}>
                    <IconPause size={22} />
                  </button>
                )}
              </div>
              <motion.p key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="h-6 text-[14px] font-medium text-[var(--muted)]">{status}</motion.p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Bubble({ role, text, at, onPlay, playing, labels }: { role: "farmer" | "saathi"; text: string; at: string; onPlay?: () => void; playing: boolean; labels: { listen: string } }) {
  const me = role === "farmer";
  return (
    <motion.li layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 30 }} className={`flex items-end gap-2 ${me ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] rounded-[22px] px-4 py-3 text-[16px] leading-snug ${me ? "rounded-br-[8px]" : "glass rounded-bl-[8px]"}`}
        style={me ? { background: "color-mix(in oklab, var(--ks-haldi) 22%, var(--card))" } : undefined}
      >
        {text}
        <div className="num mt-1 text-[11px] text-[var(--subtle)]">{istClock(at)}</div>
      </div>
      {onPlay && (
        <button onClick={onPlay} className="tap grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ color: "var(--ks-haldi-deep)" }} aria-label={labels.listen}>
          {playing ? <IconPause size={20} /> : <IconSpeaker size={22} />}
        </button>
      )}
    </motion.li>
  );
}
