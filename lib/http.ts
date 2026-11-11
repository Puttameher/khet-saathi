import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { GnaniError, NotConfiguredError } from "@/lib/gnani";
import { log } from "@/lib/log";

const buckets = new Map<string, { tokens: number; at: number }>();
/** Token bucket per client+route. Returns a 429 response when exhausted. */
export function rateLimit(req: Request, route: string, perMinute = 30): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const k = `${route}:${ip}`;
  const now = Date.now();
  const b = buckets.get(k) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(k, b);
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  b.tokens -= 1;
  buckets.set(k, b);
  return null;
}

export function errorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof NotConfiguredError) return NextResponse.json({ error: "NOT_CONFIGURED", service: e.service }, { status: 503 });
  if (e instanceof GnaniError) {
    log.warn(`${where}.gnani_error`, { status: e.status, code: e.code });
    return NextResponse.json({ error: "UPSTREAM", code: e.code, status: e.status }, { status: e.status === 429 ? 429 : 502 });
  }
  if (e instanceof ZodError) return NextResponse.json({ error: "BAD_REQUEST", issues: e.issues.slice(0, 5) }, { status: 400 });
  log.error(`${where}.failed`, { error: (e as Error)?.message ?? String(e) });
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}
