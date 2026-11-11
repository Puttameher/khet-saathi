import { NextResponse } from "next/server";
import { z } from "zod";
import { ackAlertsForTask, addTimeline, getTask, saveTask } from "@/lib/repo";
import { transition, type TaskEvent } from "@/lib/tasks";
import { isDateKey } from "@/lib/time";
import { runMonitor } from "@/lib/monitor";
import { buildState } from "@/lib/state";
import { errorResponse, rateLimit } from "@/lib/http";

export const dynamic = "force-dynamic";
const Body = z.discriminatedUnion("event", [
  z.object({ event: z.literal("START") }),
  z.object({ event: z.literal("COMPLETE") }),
  z.object({ event: z.literal("POSTPONE") }),
  z.object({ event: z.literal("CANCEL") }),
  z.object({ event: z.literal("KEEP") }),
  z.object({ event: z.literal("RESCHEDULE"), date: z.string().refine(isDateKey) }),
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "tasks.patch", 40);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    const b = Body.parse(await req.json());
    const t = getTask(id);
    if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const ev: TaskEvent = b.event === "RESCHEDULE" ? { type: "RESCHEDULE", date: b.date } : { type: b.event };
    const now = new Date();
    const r = transition(t, ev, now);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    saveTask(r.task, ev.type === "RESCHEDULE" ? { lastVerdict: null, lastEvaluation: null } : {}, now);
    if (ev.type === "COMPLETE") {
      addTimeline("task_done", { type: t.type, plannedDate: t.plannedDate }, t.id, now);
      if (t.type === "irrigate") addTimeline("irrigation", {}, t.id, now);
    }
    if (ev.type !== "START") ackAlertsForTask(t.id, now);
    if (ev.type === "RESCHEDULE") await runMonitor({ now });
    return NextResponse.json({ task: r.task, state: await buildState() });
  } catch (e) {
    return errorResponse(e, "tasks.patch");
  }
}
