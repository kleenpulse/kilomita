/** Request bodies above this are refused unread: the largest legitimate one is about 5 KB. */
export const MAX_BODY_BYTES = 8 * 1024;

export function json(
  status: number,
  body: unknown,
  { memory = false, cache = "no-store" }: { memory?: boolean; cache?: string } = {},
): Response {
  const headers: Record<string, string> = { "cache-control": cache };
  // Shared results in memory vanish on restart; say so on every answer, loudly.
  if (memory) headers["x-kilomita-stores"] = "memory";
  return Response.json(body, { status, headers });
}

export const unavailable = () => json(503, { error: "unavailable" });

export type BodyRead = { ok: true; value: unknown } | { ok: false; response: Response };

/** The JSON body, read up to MAX_BODY_BYTES whatever Content-Length claims. */
export async function readJson(request: Request, memory: boolean): Promise<BodyRead> {
  const tooLarge = { ok: false, response: json(413, { error: "too-large" }, { memory }) } as const;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge;
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: json(400, { error: "invalid" }, { memory }) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return tooLarge;
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { ok: false, response: json(400, { error: "invalid" }, { memory }) };
  }
}

/**
 * One JSON object per line, so the host's log view can filter it. Every value is a fixed string
 * from this codebase or an error code: never a message, an address, a body or a secret.
 */
export function log(
  level: "error" | "warn" | "info",
  event: string,
  fields: { code?: string; note?: string; count?: number } = {},
): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/**
 * An error's code, never its message: driver errors carry hosts and ports. Drizzle wraps driver
 * errors in its own query error, so the SQLSTATE or errno may sit on the cause.
 */
export function errorCode(error: unknown): string {
  const codeOf = (value: unknown) => (value as { code?: unknown } | null)?.code;
  const code = [codeOf(error), codeOf((error as { cause?: unknown } | null)?.cause)].find(
    (candidate): candidate is string => typeof candidate === "string",
  );
  return code ?? "none";
}

/** Logs a failure by its code only. `event` is a fixed slug, such as "tokens". */
export function logFailure(event: string, error: unknown): string {
  const code = errorCode(error);
  log("error", event, { code });
  return code;
}

/**
 * Turns an unexpected failure into a plain 500, logged by code. `onFailure` also counts it (the
 * metrics write, which must never throw back into the request).
 */
export async function guarded(
  event: string,
  task: () => Promise<Response>,
  onFailure?: (event: string, code: string) => void,
): Promise<Response> {
  try {
    return await task();
  } catch (error) {
    const code = logFailure(event, error);
    onFailure?.(event, code);
    return json(500, { error: "failed" });
  }
}
