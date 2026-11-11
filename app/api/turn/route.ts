import { NextResponse } from "next/server";
import { z } from "zod";
import { handleTurn } from "@/lib/conversation";
import { buildState } from "@/lib/state";
import { errorResponse, rateLimit } from "@/lib/http";
import { Lang } from "@/lib/config";

export const dynamic = "force-dynamic";
const Body = z.object({ text: z.string().min(1).max(600), lang: Lang.optional(), mode: z.enum(["talk", "checkin"]).optional() });

export async function POST(req: Request) {
  const limited = rateLimit(req, "turn", 30);
  if (limited) return limited;
  try {
    const b = Body.parse(await req.json());
    const turn = await handleTurn(b.text, { lang: b.lang, mode: b.mode });
    return NextResponse.json({ turn, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "turn");
  }
}
