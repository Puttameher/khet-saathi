import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask, setSetting } from "@/lib/repo";
import { TaskTypeSchema } from "@/lib/tasks";
import { isDateKey } from "@/lib/time";
import { runMonitor } from "@/lib/monitor";
import { buildState } from "@/lib/state";
import { errorResponse, rateLimit } from "@/lib/http";

export const dynamic = "force-dynamic";
const Body = z.object({
  type: TaskTypeSchema,
  plannedDate: z.string().refine(isDateKey, "YYYY-MM-DD"),
  partOfDay: z.enum(["morning", "afternoon", "evening", "night"]).nullable().optional(),
  notes: z.string().max(200).nullable().optional(),
});
export async function POST(req: Request) {
  const limited = rateLimit(req, "tasks", 30);
  if (limited) return limited;
  try {
    const b = Body.parse(await req.json());
    const t = createTask(b);
    setSetting("focusTaskId", t.id);
    await runMonitor();
    return NextResponse.json({ task: t, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "tasks.create");
  }
}
