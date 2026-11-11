import { NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_SCENARIOS, demoEnabled } from "@/lib/demo";
import { setSetting } from "@/lib/repo";
import { runMonitor } from "@/lib/monitor";
import { buildState } from "@/lib/state";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
const Body = z.object({ scenario: z.enum(DEMO_SCENARIOS) });
export async function POST(req: Request) {
  if (!demoEnabled()) return NextResponse.json({ error: "DEMO_MODE_OFF" }, { status: 403 });
  try {
    const b = Body.parse(await req.json());
    setSetting("demoScenario", b.scenario);
    const summary = await runMonitor({});
    return NextResponse.json({ summary, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "demo");
  }
}
