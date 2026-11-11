import { NextResponse } from "next/server";
import { buildBriefing } from "@/lib/conversation";
import { buildState } from "@/lib/state";
import { isOnboarded, firstQuestion } from "@/lib/onboarding";
import { getProfile } from "@/lib/repo";
import { errorResponse, rateLimit } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const limited = rateLimit(req, "briefing", 12);
  if (limited) return limited;
  try {
    if (!isOnboarded()) {
      const q = firstQuestion(getProfile().language);
      return NextResponse.json({ briefing: { text: q.text, onboarding: q.state.step }, state: await buildState() });
    }
    const briefing = await buildBriefing();
    return NextResponse.json({ briefing, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "briefing");
  }
}
