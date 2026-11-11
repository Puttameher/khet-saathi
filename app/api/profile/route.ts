import { NextResponse } from "next/server";
import { z } from "zod";
import { Lang } from "@/lib/config";
import { delSetting, saveProfile } from "@/lib/repo";
import { buildState } from "@/lib/state";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
const Body = z.object({ language: Lang.optional(), restartOnboarding: z.boolean().optional() });
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    if (b.language) saveProfile({ language: b.language });
    if (b.restartOnboarding) {
      saveProfile({ confirmedAt: null });
      delSetting("onboarding");
    }
    return NextResponse.json({ state: await buildState() });
  } catch (e) {
    return errorResponse(e, "profile");
  }
}
