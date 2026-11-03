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
 * Logs a failure by its code only: driver errors carry hosts and ports. Drizzle wraps driver errors
 * in its own query error, so the SQLSTATE or errno may sit on the cause.
 */
export function logFailure(what: string, error: unknown): void {
  const codeOf = (value: unknown) => (value as { code?: unknown } | null)?.code;
  const code = [codeOf(error), codeOf((error as { cause?: unknown } | null)?.cause)].find(
    (candidate): candidate is string => typeof candidate === "string",
  );
  console.error(`${what} failed (${code ?? "no code"})`);
}

/** Turns an unexpected failure into a plain 500. */
export async function guarded(task: () => Promise<Response>): Promise<Response> {
  try {
    return await task();
  } catch (error) {
    logFailure("Sharing request", error);
    return json(500, { error: "failed" });
  }
}
