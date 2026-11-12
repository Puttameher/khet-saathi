import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { tokensToCss } from "@/design/tokens";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Khet Saathi",
  description: "Voice-first crop companion: plan field work by voice, get weather-aware go / wait advice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5EFE3" },
    { media: "(prefers-color-scheme: dark)", color: "#110E0B" },
  ],
};

/** Day 06:00–17:59 IST, night otherwise. The client re-checks every few minutes. */
function istTheme(now = new Date()): "day" | "night" {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
  return h >= 6 && h < 18 ? "day" : "night";
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = istTheme();
  return (
    <html lang="hi" data-theme={theme} className={`${theme} ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <style id="ks-tokens" dangerouslySetInnerHTML={{ __html: tokensToCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
