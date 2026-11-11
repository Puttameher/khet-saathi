import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const farmers = sqliteTable("farmers", {
  id: text("id").primaryKey(),
  language: text("language").notNull().default("hi"),
  crop: text("crop"),
  sowingDate: text("sowing_date"),
  expectedHarvest: text("expected_harvest"),
  landSize: real("land_size"),
  landUnit: text("land_unit"),
  placeQuery: text("place_query"),
  placeLabel: text("place_label"),
  lat: real("lat"),
  lon: real("lon"),
  irrigation: text("irrigation"),
  confirmedAt: text("confirmed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  farmerId: text("farmer_id").notNull(),
  type: text("type").notNull(),
  plannedDate: text("planned_date").notNull(),
  partOfDay: text("part_of_day"),
  notes: text("notes"),
  status: text("status").notNull(),
  lastVerdict: text("last_verdict"),
  lastEvaluation: text("last_evaluation"),
  label: text("label"),
  history: text("history").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  farmerId: text("farmer_id").notNull(),
  taskId: text("task_id"),
  kind: text("kind").notNull(),
  verdict: text("verdict"),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  evaluation: text("evaluation"),
  createdAt: text("created_at").notNull(),
  spokenAt: text("spoken_at"),
  ackAt: text("ack_at"),
});

export const weatherCache = sqliteTable("weather_cache", {
  key: text("key").primaryKey(),
  fetchedAt: text("fetched_at").notNull(),
  payload: text("payload").notNull(),
});

export const schedulerRuns = sqliteTable("scheduler_runs", {
  runKey: text("run_key").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  summary: text("summary"),
});

export const timeline = sqliteTable("timeline", {
  id: text("id").primaryKey(),
  farmerId: text("farmer_id").notNull(),
  kind: text("kind").notNull(),
  at: text("at").notNull(),
  taskId: text("task_id"),
  payload: text("payload"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  farmerId: text("farmer_id").notNull(),
  at: text("at").notNull(),
  role: text("role").notNull(),
  text: text("text").notNull(),
  meta: text("meta"),
});

export const _numeric = integer; // keep import used for future columns
