/**
 * Structured JSON logging. Never log transcripts, phone numbers, names,
 * coordinates or keys: callers pass sizes/ids only. `redact` strips anything
 * that looks like a secret or a long free-text field as a second line of defence.
 */
type Level = "debug" | "info" | "warn" | "error";
const SECRET_KEYS = /key|token|secret|authorization|password|transcript|text|utterance|lat|lon|phone|name/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 3) return "[depth]";
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 40)}…[${v.length} chars]` : v;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => redact(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) && typeof val === "string" ? `[redacted ${val.length}]` : redact(val, depth + 1);
  }
  return out;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "debug") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(fields ? (redact(fields) as object) : {}) });
  if (level === "error" || level === "warn") console.error(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
