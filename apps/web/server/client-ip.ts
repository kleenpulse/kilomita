import { normaliseIp } from "./ip-address";

/*
 * The visitor's IP, from the one request header the host is trusted to set (CLIENT_IP_HEADER).
 *
 * Unset means no header is trusted and no IP is read. Next fills X-Forwarded-For with the socket
 * address only when the header is absent (base-server.js), so on a directly exposed server a
 * client can forge it, and route handlers get no socket address.
 *
 * - Single-value headers set by the platform (x-real-ip, cf-connecting-ip, fly-client-ip, …) are
 *   used only when they hold exactly one value.
 * - For x-forwarded-for the rightmost entry is used: the one the nearest proxy appended. That is
 *   right with exactly one appending proxy. Behind a CDN plus a load balancer the rightmost entry
 *   is the CDN, so use the platform's single-value header instead.
 */
export function clientIp(headers: Headers, trusted: string | undefined): string | null {
  const name = trusted?.trim().toLowerCase();
  if (!name) return null;
  let value: string | null;
  try {
    value = headers.get(name);
  } catch {
    // Not a valid header name (a typo in the env): read nothing rather than fail every request.
    return null;
  }
  if (value === null) return null;
  // Headers.get joins repeated headers with ", ".
  const entries = value.split(",");
  const entry =
    name === "x-forwarded-for" ? entries.at(-1) : entries.length === 1 ? entries[0] : undefined;
  return entry === undefined ? null : normaliseIp(entry);
}
