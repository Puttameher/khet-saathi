"use client";
/**
 * Packet label reader sheet (SPEC P1 #10). Photo → /api/label → printed text beside the photo →
 * farmer confirms → stored on the task. Listen reads what the LABEL says via /api/tts.
 * Never recommends a product or a dose: everything shown is framed as "पैकेट पर लिखा है".
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { AppState, Lang, TaskView } from "@/lib/client/api";
import { useApp } from "@/components/shell/AppContext";
import { IconAlert, IconCheck, IconClose, IconRefresh, IconSpeaker } from "@/components/shell/Icons";
import { LabelReadSchema, StoredLabelSchema, labelSpeech, type LabelRead, type StoredLabel } from "@/lib/label-view";

const MAX_EDGE = 1600;

const C = {
  hi: {
    title: "दवा / खाद का पैकेट",
    sub: "Packet label",
    take: "पैकेट की फ़ोटो लें",
    takeHint: "पीछे की तरफ़ जहाँ मात्रा और सावधानी लिखी हो, साफ़ रोशनी में",
    reading: "पैकेट पढ़ रहे हैं…",
    printed: "पैकेट पर लिखा है",
    product: "नाम",
    ai: "सक्रिय तत्व",
    dose: "मात्रा (जैसी छपी है)",
    phi: "कटाई से पहले का अंतर",
    phiMissing: "पढ़ा नहीं जा सका — पैकेट पर ज़रूर देखें",
    warnings: "सावधानी",
    warnMissing: "सावधानी की लाइनें नहीं पढ़ी गईं — पैकेट पर देखें",
    noDose: "मात्रा साफ़ नहीं पढ़ी गई",
    partial: "कुछ बातें साफ़ नहीं पढ़ी गईं। पैकेट ध्यान से देखें या अपने कृषि विज्ञान केंद्र (KVK) से पूछें।",
    unreadable: "पैकेट की लिखावट पढ़ी नहीं जा सकी। पैकेट ध्यान से पढ़ें या अपने कृषि विज्ञान केंद्र (KVK) से पूछें।",
    unreadableHint: "फ़ोटो फिर से लें: पैकेट सीधा रखें, चमक और परछाईं से बचें।",
    listen: "सुनें",
    confirm: "यह सही है",
    confirmSub: "Confirm this is correct",
    retake: "फिर से फ़ोटो",
    confirmed: "पुष्टि की गई",
    remove: "हटाएँ",
    disclaimer: "यह सिर्फ़ पैकेट पर छपी जानकारी है। हम कोई दवा या मात्रा नहीं सुझाते — मात्रा वही रखें जो पैकेट पर लिखी है।",
    model: "पढ़ा गया",
    errors: {
      IMAGE_TOO_LARGE: "फ़ोटो बहुत बड़ी है। फिर से लें।",
      BAD_IMAGE: "यह फ़ोटो खुल नहीं पाई। फिर से लें।",
      READ_EXPIRED: "पढ़ाई पुरानी हो गई। फ़ोटो फिर से लें।",
      RATE_LIMITED: "थोड़ा रुकें, फिर कोशिश करें।",
      NOT_CONFIGURED: "पैकेट पढ़ने की सेवा अभी चालू नहीं है।",
      LABEL_UNPARSEABLE: "पैकेट ठीक से पढ़ा नहीं गया। फिर से फ़ोटो लें।",
      default: "पैकेट पढ़ा नहीं जा सका। फिर से कोशिश करें।",
    } as Record<string, string>,
  },
  te: {
    title: "మందు / ఎరువు ప్యాకెట్",
    sub: "Packet label",
    take: "ప్యాకెట్ ఫోటో తీయండి",
    takeHint: "మోతాదు, జాగ్రత్తలు రాసిన వైపు, మంచి వెలుతురులో",
    reading: "ప్యాకెట్ చదువుతున్నాం…",
    printed: "ప్యాకెట్ మీద రాసి ఉంది",
    product: "పేరు",
    ai: "క్రియాశీల పదార్థం",
    dose: "మోతాదు (ముద్రించినట్లే)",
    phi: "కోతకు ముందు విరామం",
    phiMissing: "చదవలేకపోయాం — ప్యాకెట్ మీద తప్పక చూడండి",
    warnings: "జాగ్రత్తలు",
    warnMissing: "జాగ్రత్తలు చదవలేదు — ప్యాకెట్ మీద చూడండి",
    noDose: "మోతాదు స్పష్టంగా చదవలేదు",
    partial: "కొన్ని విషయాలు స్పష్టంగా చదవలేదు. ప్యాకెట్ చూడండి లేదా కృషి విజ్ఞాన కేంద్రం (KVK) ని అడగండి.",
    unreadable: "ప్యాకెట్ మీద రాత చదవలేకపోయాం. ప్యాకెట్ జాగ్రత్తగా చదవండి లేదా KVK ని అడగండి.",
    unreadableHint: "మళ్ళీ ఫోటో తీయండి: ప్యాకెట్ నిటారుగా, మెరుపు లేకుండా.",
    listen: "వినండి",
    confirm: "ఇది సరైనది",
    confirmSub: "Confirm this is correct",
    retake: "మళ్ళీ ఫోటో",
    confirmed: "నిర్ధారించారు",
    remove: "తీసివేయి",
    disclaimer: "ఇది ప్యాకెట్ మీద ముద్రించిన సమాచారం మాత్రమే. మేము ఏ మందు గానీ మోతాదు గానీ సూచించము.",
    model: "చదివింది",
    errors: {
      IMAGE_TOO_LARGE: "ఫోటో చాలా పెద్దది. మళ్ళీ తీయండి.",
      BAD_IMAGE: "ఫోటో తెరవలేకపోయాం. మళ్ళీ తీయండి.",
      READ_EXPIRED: "మళ్ళీ ఫోటో తీయండి.",
      RATE_LIMITED: "కాసేపు ఆగి ప్రయత్నించండి.",
      NOT_CONFIGURED: "ప్యాకెట్ చదివే సేవ ఇప్పుడు అందుబాటులో లేదు.",
      LABEL_UNPARSEABLE: "ప్యాకెట్ సరిగ్గా చదవలేదు. మళ్ళీ ఫోటో తీయండి.",
      default: "ప్యాకెట్ చదవలేకపోయాం. మళ్ళీ ప్రయత్నించండి.",
    } as Record<string, string>,
  },
} as const;

export function storedLabelOf(task: TaskView): StoredLabel | null {
  const r = StoredLabelSchema.safeParse(task.label);
  return r.success ? r.data : null;
}

/** Downscale to ≤1600px JPEG. Re-encoding through a canvas also drops EXIF (GPS etc.). */
async function downscale(file: File): Promise<Blob> {
  let src: CanvasImageSource & { width: number; height: number };
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  }
  const s = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("BAD_IMAGE");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if ("close" in src && typeof src.close === "function") src.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("BAD_IMAGE"))), "image/jpeg", 0.85));
}

async function req<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { ...init, cache: "no-store" }); } catch { throw new Error("NETWORK"); }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `HTTP_${res.status}`);
  return body as T;
}

type Phase = { k: "idle" } | { k: "reading" } | { k: "result"; label: LabelRead; readId: string | null } | { k: "stored"; label: StoredLabel };

export function LabelCapture({ task, lang, open, onClose }: { task: TaskView; lang: Lang; open: boolean; onClose: () => void }) {
  const { say, setState, toast, speaker } = useApp();
  const T = C[lang] ?? C.hi;
  const stored = storedLabelOf(task);
  const [phase, setPhase] = useState<Phase>(stored ? { k: "stored", label: stored } : { k: "idle" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  useEffect(() => {
    if (open) setPhase(stored ? { k: "stored", label: stored } : { k: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const err = (code: string) => toast(T.errors[code] ?? T.errors.default!);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setPhase({ k: "reading" });
    try {
      const jpeg = await downscale(f);
      setPhoto(URL.createObjectURL(jpeg));
      const fd = new FormData();
      fd.append("image", jpeg, "label.jpg");
      fd.append("taskId", task.id);
      const r = await req<{ readId: string | null; label: unknown }>("/api/label", { method: "POST", body: fd });
      const label = LabelReadSchema.parse(r.label);
      setPhase({ k: "result", label, readId: r.readId });
    } catch (e) {
      err((e as Error).message);
      setPhase(stored ? { k: "stored", label: stored } : { k: "idle" });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const confirm = async (readId: string) => {
    setBusy(true);
    try {
      const r = await req<{ label: unknown; state: AppState }>("/api/label", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, readId }) });
      setState(r.state);
      setPhase({ k: "stored", label: StoredLabelSchema.parse(r.label) });
      try { navigator.vibrate?.([10, 40, 18]); } catch { /* noop */ }
    } catch (e) {
      err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await req<{ state: AppState }>(`/api/label?taskId=${encodeURIComponent(task.id)}`, { method: "DELETE" });
      setState(r.state);
      setPhase({ k: "idle" });
    } catch (e) { err((e as Error).message); } finally { setBusy(false); }
  };

  const listen = (l: LabelRead) => {
    speaker.unlock();
    void say(labelSpeech(l, lang), `label:${task.id}:${l.readAt}`);
  };

  const pick = () => { speaker.unlock(); input.current?.click(); };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={T.title}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="relative max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-t-[28px] bg-[var(--bg,#fbf7ee)] p-4 pb-6 text-[var(--fg)] shadow-2xl sm:rounded-[28px]"
          >
            <header className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="eyebrow">{T.sub}</div>
                <h2 className="font-display text-[22px] leading-tight">{T.title}</h2>
              </div>
              <button onClick={onClose} className="tap grid h-12 w-12 place-items-center rounded-full" style={{ background: "var(--card)" }} aria-label="close">
                <IconClose size={22} />
              </button>
            </header>

            <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

            {phase.k === "idle" && (
              <button onClick={pick} className="tap flex w-full flex-col items-center gap-2 rounded-[24px] border-2 border-dashed p-8 text-center" style={{ borderColor: "color-mix(in oklab, var(--ks-haldi-deep) 45%, transparent)" }}>
                <CameraIcon />
                <span className="text-[18px] font-semibold">{T.take}</span>
                <span className="text-[13.5px] text-[var(--muted)]">{T.takeHint}</span>
              </button>
            )}

            {phase.k === "reading" && (
              <div className="flex flex-col items-center gap-3 py-6">
                {photo && <img src={photo} alt="" className="max-h-56 rounded-[18px] object-contain opacity-80" />}
                <div className="flex items-center gap-2 text-[15px] font-medium">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> {T.reading}
                </div>
              </div>
            )}

            {(phase.k === "result" || phase.k === "stored") && (
              <LabelBody label={phase.label} photo={phase.k === "result" ? photo : null} T={T} lang={lang} />
            )}

            {phase.k === "result" && (
              <div className="mt-4 flex flex-wrap gap-2">
                {phase.label.status !== "unreadable" && (
                  <Btn onClick={() => listen(phase.label)} color="var(--ks-monsoon)" icon={<IconSpeaker size={20} />} label={T.listen} />
                )}
                <Btn onClick={pick} color="var(--ks-stone-500)" icon={<IconRefresh size={18} />} label={T.retake} />
                {phase.label.status !== "unreadable" && phase.readId && (
                  <Btn primary busy={busy} onClick={() => void confirm(phase.readId!)} color="var(--ks-leaf)" icon={<IconCheck size={20} strokeWidth={2.2} />} label={T.confirm} sub={T.confirmSub} />
                )}
              </div>
            )}

            {phase.k === "stored" && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Btn onClick={() => listen(phase.label)} color="var(--ks-monsoon)" icon={<IconSpeaker size={20} />} label={T.listen} />
                <Btn onClick={pick} color="var(--ks-stone-500)" icon={<IconRefresh size={18} />} label={T.retake} />
                <Btn busy={busy} onClick={() => void remove()} color="var(--ks-clay)" icon={<IconClose size={18} />} label={T.remove} />
              </div>
            )}

            <p className="mt-4 text-[12.5px] leading-snug text-[var(--muted)]">{T.disclaimer}</p>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

type Copy = (typeof C)["hi"] | (typeof C)["te"];

function LabelBody({ label, photo, T, lang }: { label: LabelRead | StoredLabel; photo: string | null; T: Copy; lang: Lang }) {
  if (label.status === "unreadable") {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        {photo && <img src={photo} alt="" className="max-h-60 rounded-[18px] object-contain sm:w-[42%]" />}
        <div className="flex-1 rounded-[20px] p-4" style={{ background: "color-mix(in oklab, var(--ks-amber) 14%, transparent)" }}>
          <div className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ks-amber)" }}><IconAlert size={20} /> {T.unreadable}</div>
          <p className="mt-2 text-[14px] text-[var(--muted)]">{T.unreadableHint}</p>
        </div>
      </div>
    );
  }
  const confirmedAt = "confirmedAt" in label ? label.confirmedAt : null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      {photo && (
        <img src={photo} alt="" className="max-h-[46dvh] w-full rounded-[18px] object-contain sm:sticky sm:top-0 sm:w-[42%]" style={{ background: "var(--card)" }} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {/* Safety first: PHI + warnings, always shown prominently (even when missing). */}
        <div className="rounded-[20px] p-3.5" style={{ background: "color-mix(in oklab, var(--ks-clay) 13%, transparent)", boxShadow: "inset 0 0 0 1.5px color-mix(in oklab, var(--ks-clay) 45%, transparent)" }}>
          <div className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ks-clay)" }}>{T.phi}</div>
          <div className="mt-0.5 text-[20px] font-bold leading-tight">{label.preHarvestInterval ?? <span className="text-[15px] font-semibold" style={{ color: "var(--ks-clay)" }}>{T.phiMissing}</span>}</div>
          <div className="mt-2.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ks-clay)" }}><IconAlert size={15} /> {T.warnings}</div>
          {label.safetyWarnings.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[14.5px] font-medium leading-snug">
              {label.safetyWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-[14px] font-semibold" style={{ color: "var(--ks-clay)" }}>{T.warnMissing}</p>
          )}
        </div>

        <div className="rounded-[20px] p-3.5" style={{ background: "var(--card)" }}>
          <div className="eyebrow mb-1.5">{T.printed}</div>
          {label.productName && <Field k={T.product} v={label.productName} big />}
          {label.activeIngredient && <Field k={T.ai} v={label.activeIngredient} />}
          <div className="mt-2 text-[12px] font-semibold text-[var(--muted)]">{T.dose}</div>
          {label.cropDoses.length ? (
            <ul className="mt-1 space-y-1">
              {label.cropDoses.map((d, i) => (
                <li key={i} className="text-[14.5px] leading-snug">
                  {d.crop && <b>{d.crop}: </b>}
                  <span className="rounded-md px-1" style={{ background: "color-mix(in oklab, var(--ks-haldi) 16%, transparent)" }}>“{d.doseText}”</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] font-medium" style={{ color: "var(--ks-amber)" }}>{T.noDose}</p>
          )}
        </div>

        {label.status === "partial" && (
          <div className="flex gap-2 rounded-[16px] p-3 text-[13.5px] font-medium" style={{ background: "color-mix(in oklab, var(--ks-amber) 14%, transparent)", color: "var(--fg)" }}>
            <span style={{ color: "var(--ks-amber)" }}><IconAlert size={18} /></span> {T.partial}
          </div>
        )}
        <div className="num text-[11px] text-[var(--subtle)]">
          {confirmedAt ? <span style={{ color: "var(--ks-leaf)" }}>✓ {T.confirmed} · {new Date(confirmedAt).toLocaleString(lang === "te" ? "te-IN" : "hi-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · </span> : null}
          {T.model}: {label.model}
        </div>
      </div>
    </div>
  );
}

function Field({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div className="mb-1">
      <span className="text-[12px] font-semibold text-[var(--muted)]">{k}: </span>
      <span className={big ? "text-[17px] font-semibold" : "text-[14.5px]"}>{v}</span>
    </div>
  );
}

function Btn({ onClick, color, icon, label, sub, primary, busy }: { onClick: () => void; color: string; icon: React.ReactNode; label: string; sub?: string; primary?: boolean; busy?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={busy}
      className={`tap flex min-h-14 items-center justify-center gap-2 rounded-[18px] px-4 text-[15px] font-semibold ${primary ? "w-full sm:w-auto sm:flex-[1.4]" : "flex-1"}`}
      style={primary ? { background: color, color: "#fff", boxShadow: `0 10px 22px -12px ${color}` } : { background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
    >
      {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      <span className="flex flex-col items-start leading-tight">
        {label}
        {sub && <span className="text-[11px] font-medium opacity-80">{sub}</span>}
      </span>
    </motion.button>
  );
}

function CameraIcon() {
  return (
    <span className="grid h-16 w-16 place-items-center rounded-full" style={{ background: "color-mix(in oklab, var(--ks-haldi) 20%, transparent)", color: "var(--ks-haldi-deep)" }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.3-2h5.2l1.3 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
        <circle cx="12" cy="12.5" r="3.5" />
      </svg>
    </span>
  );
}
