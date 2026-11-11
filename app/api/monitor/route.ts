import { NextResponse } from "next/server";
import { runMonitor } from "@/lib/monitor";
import { buildState } from "@/lib/state";
import { errorResponse, rateLimit } from "@/lib/http";

export const dynamic = "force-dynamic";
/** On-demand refresh: re-fetch forecast and re-run the rules engine over all planned tasks. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "monitor", 10);
  if (limited) return limited;
  try {
    const summary = await runMonitor({ force: true });
    return NextResponse.json({ summary, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "monitor");
  }
}
