import { NextResponse } from "next/server";
import { resetAll } from "@/lib/repo";
import { demoEnabled } from "@/lib/demo";

export const dynamic = "force-dynamic";
/** Wipes local data. Only allowed in Demo Mode or non-production builds. */
export async function POST() {
  if (process.env.NODE_ENV === "production" && !demoEnabled()) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  resetAll();
  return NextResponse.json({ ok: true });
}
