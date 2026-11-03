/*
 * CORS by exact origin. It decides which web pages may read our responses; it is not an abuse
 * control (curl and no-cors requests ignore it). Tickets and the budget are.
 */

export function corsHeaders(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const headers: Record<string, string> = { vary: "Origin" };
  if (origin === undefined || !allowed.has(origin)) return headers;
  return {
    ...headers,
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "Server-Timing",
    "timing-allow-origin": origin,
  };
}

export const PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-methods": "GET, POST",
  "access-control-max-age": "7200",
};
