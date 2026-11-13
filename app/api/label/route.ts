/**
 * POST /api/label   multipart { image: File (jpeg|png|webp, ≤4 MB), taskId?: string }
 *   → { readId, label: LabelRead }   (nothing stored yet; the photo is never persisted)
 * PUT  /api/label   JSON { taskId, readId }   (farmer pressed "यह सही है")
 *   → { label: StoredLabel, state }  stores exactly what the model read, on the task
 * DELETE /api/label?taskId=…  removes the stored label from a task
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, rateLimit } from "@/lib/http";
import { LABEL_MAX_BYTES, confirmLabel, readLabel, rememberRead, takeRead } from "@/lib/label";
import { LlmHttpError, llm } from "@/lib/llm";
import { addTimeline, getTask, saveTask } from "@/lib/repo";
import { buildState } from "@/lib/state";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
const LABEL_TASK_TYPES = new Set(["spray", "fertilize"]);

export async function POST(req: Request) {
  const limited = rateLimit(req, "label", 4); // vision calls are token-heavy (Groq ITPM)
  if (limited) return limited;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LABEL_MAX_BYTES + 64_000) return NextResponse.json({ error: "IMAGE_TOO_LARGE" }, { status: 413 });
  try {
    if (!llm.available()) return NextResponse.json({ error: "NOT_CONFIGURED", service: "llm" }, { status: 503 });
    const fd = await req.formData();
    const file = fd.get("image");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "NO_IMAGE" }, { status: 400 });
    if (file.size > LABEL_MAX_BYTES) return NextResponse.json({ error: "IMAGE_TOO_LARGE" }, { status: 413 });
    if (file.size < 1024) return NextResponse.json({ error: "BAD_IMAGE" }, { status: 400 });
    const taskId = fd.get("taskId");
    if (typeof taskId === "string" && taskId && !getTask(taskId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const t0 = Date.now();
    const label = await readLabel(bytes);
    log.info("label.read", { status: label.status, issues: label.issues.length, ms: Date.now() - t0, bytes: bytes.length });
    const readId = label.status === "unreadable" ? null : rememberRead(label);
    return NextResponse.json({ readId, label });
  } catch (e) {
    if ((e as Error)?.message === "BAD_IMAGE") return NextResponse.json({ error: "BAD_IMAGE" }, { status: 400 });
    if (e instanceof LlmHttpError) {
      log.warn("label.llm_http", { status: e.status });
      return NextResponse.json({ error: e.status === 429 ? "RATE_LIMITED" : "UPSTREAM" }, { status: e.status === 429 ? 429 : 502 });
    }
    if ((e as Error)?.name === "AbortError") return NextResponse.json({ error: "TIMEOUT" }, { status: 504 });
    if (/failed validation/.test((e as Error)?.message ?? "")) return NextResponse.json({ error: "LABEL_UNPARSEABLE" }, { status: 502 });
    return errorResponse(e, "label.read");
  }
}

const ConfirmBody = z.object({ taskId: z.string().min(1).max(64), readId: z.string().uuid() });

export async function PUT(req: Request) {
  const limited = rateLimit(req, "label.confirm", 20);
  if (limited) return limited;
  try {
    const b = ConfirmBody.parse(await req.json());
    const task = getTask(b.taskId);
    if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (!LABEL_TASK_TYPES.has(task.type)) return NextResponse.json({ error: "INVALID_TRANSITION" }, { status: 409 });
    const read = takeRead(b.readId);
    if (!read) return NextResponse.json({ error: "READ_EXPIRED" }, { status: 410 });
    const now = new Date();
    const stored = confirmLabel(read, now);
    saveTask(task, { label: stored }, now);
    addTimeline("label_confirmed", { productName: stored.productName, status: stored.status }, task.id, now);
    return NextResponse.json({ label: stored, state: await buildState() });
  } catch (e) {
    if ((e as Error)?.message === "UNREADABLE") return NextResponse.json({ error: "UNREADABLE" }, { status: 422 });
    return errorResponse(e, "label.confirm");
  }
}

export async function DELETE(req: Request) {
  const limited = rateLimit(req, "label.confirm", 20);
  if (limited) return limited;
  try {
    const taskId = z.string().min(1).max(64).parse(new URL(req.url).searchParams.get("taskId"));
    const task = getTask(taskId);
    if (!task) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    saveTask(task, { label: null });
    return NextResponse.json({ state: await buildState() });
  } catch (e) {
    return errorResponse(e, "label.delete");
  }
}
