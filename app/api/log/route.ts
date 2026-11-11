import { NextResponse } from "next/server";
import { z } from "zod";
import { addTimeline } from "@/lib/repo";
import { buildState } from "@/lib/state";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
const Body = z.object({ kind: z.enum(["irrigation"]) });
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    addTimeline(b.kind, {});
    return NextResponse.json({ state: await buildState() });
  } catch (e) {
    return errorResponse(e, "log");
  }
}
