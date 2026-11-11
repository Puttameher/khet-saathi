import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const DDL = `
CREATE TABLE IF NOT EXISTS farmers (
  id TEXT PRIMARY KEY, language TEXT NOT NULL DEFAULT 'hi', crop TEXT, sowing_date TEXT, expected_harvest TEXT,
  land_size REAL, land_unit TEXT, place_query TEXT, place_label TEXT, lat REAL, lon REAL, irrigation TEXT,
  confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, type TEXT NOT NULL, planned_date TEXT NOT NULL, part_of_day TEXT,
  notes TEXT, status TEXT NOT NULL, last_verdict TEXT, last_evaluation TEXT, label TEXT, history TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);
CREATE INDEX IF NOT EXISTS tasks_farmer_status ON tasks(farmer_id, status);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, task_id TEXT, kind TEXT NOT NULL, verdict TEXT, message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE, evaluation TEXT, created_at TEXT NOT NULL, spoken_at TEXT, ack_at TEXT);
CREATE TABLE IF NOT EXISTS weather_cache (key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scheduler_runs (run_key TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, summary TEXT);
CREATE TABLE IF NOT EXISTS timeline (id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, task_id TEXT, payload TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, at TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, meta TEXT);
`;

export type DB = BetterSQLite3Database<typeof schema>;
type Holder = { db: DB; raw: Database.Database };
const g = globalThis as unknown as { __ksdb?: Holder };

export function openDb(file: string): Holder {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new Database(file);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(DDL);
  return { raw, db: drizzle(raw, { schema }) };
}

export function getDb(): DB {
  if (!g.__ksdb) g.__ksdb = openDb(process.env.KS_DB_PATH || "./data/khet-saathi.db");
  return g.__ksdb.db;
}

export function getRaw(): Database.Database {
  getDb();
  return g.__ksdb!.raw;
}

/** test helper: fresh in-memory db */
export function resetDbForTests(): DB {
  g.__ksdb = openDb(":memory:");
  return g.__ksdb.db;
}

export { schema };
