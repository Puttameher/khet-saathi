import { NextResponse } from "next/server";
import { z } from "zod";
import { ackAlerts } from "@/lib/repo";
import { buildState } from "@/lib/state";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
const Body = z.object({ ids: z.array(z.string().uuid()).max(50) });
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    ackAlerts(b.ids);
    return NextResponse.json({ state: await buildState() });
  } catch (e) {
    return errorResponse(e, "alerts.ack");
  }
}
