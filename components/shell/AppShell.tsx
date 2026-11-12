"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api, errorMessage, ttsUrl, type AppState, type Lang } from "@/lib/client/api";
import { useSpeaker } from "@/lib/client/useSpeaker";
import { AppContext, type AppCtx, type BriefingView, type Tab } from "@/components/shell/AppContext";
import { T } from "@/components/shell/i18n";
import { TabBar } from "@/components/shell/TabBar";
import { Header } from "@/components/shell/Header";
import { AlertBanner } from "@/components/shell/AlertBanner";
import { Toast, type ToastMsg } from "@/components/shell/Toast";
import { KhetTab } from "@/components/khet/KhetTab";
import { KaamTab } from "@/components/kaam/KaamTab";
import { BaatTab } from "@/components/baat/BaatTab";

const TAB_ORDER: Tab[] = ["khet", "kaam", "baat"];

export function AppShell() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTabRaw] = useState<Tab>("khet");
  const [dir, setDir] = useState(0);
  const [briefing, setBriefing] = useState<BriefingView>({ status: "loading", text: null, weatherAsOf: null, source: null });
  const [toastMsg, setToastMsg] = useState<ToastMsg | null>(null);
  const speaker = useSpeaker();
  const lang: Lang = state?.profile.language ?? "hi";
  const t = T[lang];
  const booted = useRef(false);

  const toast = useCallback((msg: string, tone: "error" | "info" = "error") => setToastMsg({ id: Date.now(), msg, tone }), []);

  const setTab = useCallback((next: Tab) => {
    setTabRaw((cur) => {
      setDir(TAB_ORDER.indexOf(next) - TAB_ORDER.indexOf(cur));
      return next;
    });
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
  }, []);

  const say = useCallback(async (text: string, key: string) => {
    const ok = await speaker.play(ttsUrl(text, lang), key);
    if (!ok) toast(errorMessage(new Error(state?.services.tts === false ? "NOT_CONFIGURED" : "PLAYBACK"), lang));
    return ok;
  }, [speaker, lang, toast, state?.services.tts]);

  // Boot: state first (fast paint), then the daily briefing (once per tab session).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try { setState(await api.state()); } catch (e) { toast(errorMessage(e, "hi")); }
      const cached = sessionStorage.getItem("ks-briefing");
      if (cached) {
        try { setBriefing(JSON.parse(cached) as BriefingView); return; } catch { /* refetch */ }
      }
      try {
        const r = await api.briefing();
        setState(r.state);
        const b = r.briefing as { text: string; weatherAsOf?: string | null; source?: string | null };
        const view: BriefingView = { status: "ready", text: b.text, weatherAsOf: b.weatherAsOf ?? null, source: b.source ?? null };
        setBriefing(view);
        sessionStorage.setItem("ks-briefing", JSON.stringify(view));
      } catch {
        setBriefing({ status: "error", text: null, weatherAsOf: null, source: null });
      }
    })();
  }, [toast]);

  // Keep day/night theme in sync with IST unless the farmer picked one.
  useEffect(() => {
    const apply = () => {
      const pinned = localStorage.getItem("ks-theme");
      const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
      const theme = pinned === "day" || pinned === "night" ? pinned : h >= 6 && h < 18 ? "day" : "night";
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("night", theme === "night");
      document.documentElement.classList.toggle("day", theme === "day");
    };
    apply();
    const id = setInterval(apply, 5 * 60_000);
    window.addEventListener("ks-theme", apply);
    return () => { clearInterval(id); window.removeEventListener("ks-theme", apply); };
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const ctx = useMemo<AppCtx>(() => ({ state, setState, lang, t, tab, setTab, speaker, say, briefing, toast }), [state, lang, t, tab, setTab, speaker, say, briefing, toast]);

  return (
    <AppContext.Provider value={ctx}>
      <MotionConfig reducedMotion="user">
        <div className="relative mx-auto flex h-dvh max-w-[480px] flex-col overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "var(--halo)" }} />
          <Header />
          <AlertBanner />
          <main className="relative min-h-0 flex-1">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.section
                key={tab}
                custom={dir}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: d * 28, filter: "blur(6px)" }),
                  center: { opacity: 1, x: 0, filter: "blur(0px)" },
                  exit: (d: number) => ({ opacity: 0, x: d * -28, filter: "blur(6px)" }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className="absolute inset-0 flex flex-col"
                aria-label={t.tabs[tab]}
              >
                {tab === "khet" && <KhetTab />}
                {tab === "kaam" && <KaamTab />}
                {tab === "baat" && <BaatTab />}
              </motion.section>
            </AnimatePresence>
          </main>
          <TabBar />
          <Toast msg={toastMsg} onDone={() => setToastMsg(null)} />
        </div>
      </MotionConfig>
    </AppContext.Provider>
  );
}
