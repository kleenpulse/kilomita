/**
 * One JSON object per line for `docker compose logs`. Every value is a fixed string from this
 * codebase: never a client address, a ticket or a secret (the privacy test in app.test.ts captures
 * all output to check).
 */
export function log(level: "error" | "warn" | "info", event: string, note?: string): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    event,
    ...(note ? { note } : {}),
  });
  if (level === "info") console.log(line);
  else console.error(line);
}
