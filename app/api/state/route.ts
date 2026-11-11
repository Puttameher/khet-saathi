import { NextResponse } from "next/server";
import { buildState } from "@/lib/state";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    return NextResponse.json(await buildState(new Date(), { force }));
  } catch (e) {
    return errorResponse(e, "state");
  }
}
