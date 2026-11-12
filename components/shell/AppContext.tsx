"use client";
import { createContext, useContext } from "react";
import type { AppState, Lang } from "@/lib/client/api";
import type { useSpeaker } from "@/lib/client/useSpeaker";
import type { Copy } from "@/components/shell/i18n";

export type Tab = "khet" | "kaam" | "baat";
export interface BriefingView { status: "loading" | "ready" | "error"; text: string | null; weatherAsOf: string | null; source: string | null }

export interface AppCtx {
  state: AppState | null;
  setState: (s: AppState) => void;
  lang: Lang;
  t: Copy;
  tab: Tab;
  setTab: (t: Tab) => void;
  speaker: ReturnType<typeof useSpeaker>;
  /** Speak text via Timbre. Returns false (and toasts) if playback failed. */
  say: (text: string, key: string) => Promise<boolean>;
  briefing: BriefingView;
  toast: (msg: string, tone?: "error" | "info") => void;
}

export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error("useApp outside AppShell");
  return c;
}
