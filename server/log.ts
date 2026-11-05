// Structured JSON logs. Query text is never logged unless AETHERDECK_LOG_QUERIES=1.
type Level = "debug" | "info" | "warn" | "error";
const logQueries = process.env.AETHERDECK_LOG_QUERIES === "1";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.AETHERDECK_DEBUG !== "1") return;
  const safe = { ...fields };
  if (!logQueries && "query" in safe) safe.query = `[${String(safe.query).length} chars]`;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...safe });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}
