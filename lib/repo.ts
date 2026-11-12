import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Task, TaskStatus, HistoryEntry } from "@/lib/tasks";
import type { Evaluation, TaskType, Verdict } from "@/lib/rules";
import type { CropId, Lang } from "@/lib/config";
import type { DateKey, PartOfDay } from "@/lib/time";

export const FARMER_ID = "default";
export const uid = () => crypto.randomUUID();

export interface Profile {
  language: Lang;
  crop: CropId | null;
  sowingDate: DateKey | null;
  expectedHarvest: DateKey | null;
  landSize: number | null;
  landUnit: string | null;
  placeQuery: string | null;
  placeLabel: string | null;
  lat: number | null;
  lon: number | null;
  irrigation: string | null;
  confirmedAt: string | null;
}

export function getProfile(): Profile {
  const r = getDb().select().from(schema.farmers).where(eq(schema.farmers.id, FARMER_ID)).get();
  return {
    language: (r?.language as Lang) ?? "hi",
    crop: (r?.crop as CropId) ?? null,
    sowingDate: r?.sowingDate ?? null,
    expectedHarvest: r?.expectedHarvest ?? null,
    landSize: r?.landSize ?? null,
    landUnit: r?.landUnit ?? null,
    placeQuery: r?.placeQuery ?? null,
    placeLabel: r?.placeLabel ?? null,
    lat: r?.lat ?? null,
    lon: r?.lon ?? null,
    irrigation: r?.irrigation ?? null,
    confirmedAt: r?.confirmedAt ?? null,
  };
}

export function saveProfile(p: Partial<Profile>, now = new Date()): Profile {
  const cur = getProfile();
  const next = { ...cur, ...p };
  const at = now.toISOString();
  getDb()
    .insert(schema.farmers)
    .values({ id: FARMER_ID, ...next, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: schema.farmers.id, set: { ...next, updatedAt: at } })
    .run();
  return next;
}

export function resetAll() {
  const db = getDb();
  for (const t of [schema.farmers, schema.tasks, schema.alerts, schema.timeline, schema.settings, schema.messages, schema.schedulerRuns]) db.delete(t).run();
}

// ---------- tasks ----------
export interface TaskRow extends Task {
  lastVerdict: Verdict | null;
  lastEvaluation: Evaluation | null;
  label: unknown | null;
  createdAt: string;
  updatedAt: string;
}

function rowToTask(r: typeof schema.tasks.$inferSelect): TaskRow {
  return {
    id: r.id,
    type: r.type as TaskType,
    plannedDate: r.plannedDate,
    partOfDay: (r.partOfDay as PartOfDay) ?? null,
    notes: r.notes,
    status: r.status as TaskStatus,
    history: JSON.parse(r.history) as HistoryEntry[],
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    lastVerdict: (r.lastVerdict as Verdict) ?? null,
    lastEvaluation: r.lastEvaluation ? (JSON.parse(r.lastEvaluation) as Evaluation) : null,
    label: r.label ? JSON.parse(r.label) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function listTasks(statuses?: TaskStatus[]): TaskRow[] {
  const db = getDb();
  const q = statuses
    ? db.select().from(schema.tasks).where(and(eq(schema.tasks.farmerId, FARMER_ID), inArray(schema.tasks.status, statuses)))
    : db.select().from(schema.tasks).where(eq(schema.tasks.farmerId, FARMER_ID));
  return q.orderBy(schema.tasks.plannedDate).all().map(rowToTask);
}

export function getTask(id: string): TaskRow | null {
  const r = getDb().select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  return r ? rowToTask(r) : null;
}

export function createTask(t: { type: TaskType; plannedDate: DateKey; partOfDay?: PartOfDay | null; notes?: string | null }, now = new Date()): TaskRow {
  const at = now.toISOString();
  const id = uid();
  getDb()
    .insert(schema.tasks)
    .values({ id, farmerId: FARMER_ID, type: t.type, plannedDate: t.plannedDate, partOfDay: t.partOfDay ?? null, notes: t.notes ?? null, status: "planned", history: "[]", createdAt: at, updatedAt: at })
    .run();
  addTimeline("task_created", { type: t.type, plannedDate: t.plannedDate }, id, now);
  return getTask(id)!;
}

export function saveTask(t: TaskRow | Task, extra: { lastVerdict?: Verdict | null; lastEvaluation?: Evaluation | null; label?: unknown } = {}, now = new Date()) {
  const set: Partial<typeof schema.tasks.$inferInsert> = {
    plannedDate: t.plannedDate,
    partOfDay: t.partOfDay,
    notes: t.notes,
    status: t.status,
    history: JSON.stringify(t.history),
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    updatedAt: now.toISOString(),
  };
  if (extra.lastVerdict !== undefined) set.lastVerdict = extra.lastVerdict;
  if (extra.lastEvaluation !== undefined) set.lastEvaluation = extra.lastEvaluation ? JSON.stringify(extra.lastEvaluation) : null;
  if (extra.label !== undefined) set.label = extra.label ? JSON.stringify(extra.label) : null;
  getDb().update(schema.tasks).set(set).where(eq(schema.tasks.id, t.id)).run();
}

// ---------- alerts ----------
export interface AlertRow {
  id: string;
  taskId: string | null;
  kind: string;
  verdict: Verdict | null;
  message: string;
  evaluation: Evaluation | null;
  createdAt: string;
  spokenAt: string | null;
  ackAt: string | null;
}

/** Insert unless the dedupe key already exists. Returns true if created. */
export function createAlertOnce(a: { taskId: string | null; kind: string; verdict: Verdict | null; message: string; dedupeKey: string; evaluation?: Evaluation }, now = new Date()): boolean {
  const res = getDb()
    .insert(schema.alerts)
    .values({ id: uid(), farmerId: FARMER_ID, taskId: a.taskId, kind: a.kind, verdict: a.verdict, message: a.message, dedupeKey: a.dedupeKey, evaluation: a.evaluation ? JSON.stringify(a.evaluation) : null, createdAt: now.toISOString() })
    .onConflictDoNothing({ target: schema.alerts.dedupeKey })
    .run();
  return res.changes > 0;
}

export function pendingAlerts(): AlertRow[] {
  return getDb()
    .select()
    .from(schema.alerts)
    .where(and(eq(schema.alerts.farmerId, FARMER_ID), isNull(schema.alerts.ackAt)))
    .orderBy(desc(schema.alerts.createdAt))
    .all()
    .map((r) => ({ ...r, verdict: (r.verdict as Verdict) ?? null, evaluation: r.evaluation ? (JSON.parse(r.evaluation) as Evaluation) : null }));
}

export function markAlertsSpoken(ids: string[], now = new Date()) {
  if (!ids.length) return;
  getDb().update(schema.alerts).set({ spokenAt: now.toISOString() }).where(inArray(schema.alerts.id, ids)).run();
}
export function ackAlerts(ids: string[], now = new Date()) {
  if (!ids.length) return;
  getDb().update(schema.alerts).set({ ackAt: now.toISOString() }).where(inArray(schema.alerts.id, ids)).run();
}
export function ackAlertsForTask(taskId: string, now = new Date()) {
  getDb().update(schema.alerts).set({ ackAt: now.toISOString() }).where(and(eq(schema.alerts.taskId, taskId), isNull(schema.alerts.ackAt))).run();
}

// ---------- timeline / settings / messages ----------
export function addTimeline(kind: string, payload: unknown, taskId: string | null = null, now = new Date()) {
  getDb().insert(schema.timeline).values({ id: uid(), farmerId: FARMER_ID, kind, at: now.toISOString(), taskId, payload: JSON.stringify(payload ?? null) }).run();
}
export function listTimeline(limit = 50) {
  return getDb()
    .select()
    .from(schema.timeline)
    .where(eq(schema.timeline.farmerId, FARMER_ID))
    .orderBy(desc(schema.timeline.at))
    .limit(limit)
    .all()
    .map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null }));
}

export function getSetting<T>(key: string): T | null {
  const r = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return r ? (JSON.parse(r.value) as T) : null;
}
export function setSetting(key: string, value: unknown) {
  const v = JSON.stringify(value);
  getDb().insert(schema.settings).values({ key, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();
}
export function delSetting(key: string) {
  getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run();
}

export function addMessage(role: "farmer" | "saathi", text: string, meta: unknown = null, now = new Date()) {
  getDb().insert(schema.messages).values({ id: uid(), farmerId: FARMER_ID, at: now.toISOString(), role, text: text.slice(0, 2000), meta: meta ? JSON.stringify(meta) : null }).run();
}
export function listMessages(limit = 40) {
  return getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.farmerId, FARMER_ID))
    // a turn writes farmer + reply with the same timestamp; rowid keeps insertion order
    .orderBy(desc(schema.messages.at), desc(sql`rowid`))
    .limit(limit)
    .all()
    .reverse()
    .map((r) => ({ id: r.id, at: r.at, role: r.role as "farmer" | "saathi", text: r.text, meta: r.meta ? JSON.parse(r.meta) : null }));
}
