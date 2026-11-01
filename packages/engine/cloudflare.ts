import type { TestEndpoint } from "./endpoint";

/*
 * Cloudflare's public speed test endpoints (speed.cloudflare.com).
 *
 * TEMPORARY, DEV/TEST ONLY. Cloudflare publishes no terms that cover third parties using these
 * endpoints, so this adapter must not serve a public deployment until Cloudflare gives written
 * permission. Production moves to self-hosted servers (Phase 6) and keeps this only as a fallback
 * if permission is granted. Never call it from CI or other automation.
 *
 * Sources, checked 2026-11-01:
 * - Endpoints, latency via `bytes=0`, upload body handling and the Server-Timing parse follow
 *   Cloudflare's MIT-licensed client, https://github.com/cloudflare/speedtest at commit 7183e970:
 *   src/config/defaultConfig.ts, README.md and src/engines/BandwidthEngine/BandwidthEngine.ts.
 * - Observed with live requests, not documented: `Access-Control-Allow-Origin: *`, `server-timing`
 *   exposed to scripts, `Cache-Control: no-store, no-transform` with no compression, and a 403 for
 *   `bytes` >= 100,000,000. CORS on these endpoints broke once before (cloudflare/speedtest#38).
 *
 * Responses also carry the client's IP address, city and coordinates in `cf-meta-*` headers. Never
 * read them. Results are never reported to Cloudflare's `__results` endpoint either.
 */

const ORIGIN = "https://speed.cloudflare.com";

/** Values at or below this aren't real measurements (same floor as Cloudflare's client). */
const MIN_SERVER_TIME_MS = 0.01;

const REQUEST_DURATION = /(?:^|,\s*)cfReq(?:uest)?Dur(?:ation)?;\s*dur=([0-9.]+)/i;
const SPEED_ENTRIES = /(?:^|,\s*)cfSpeed[a-zA-Z]*;\s*dur=([0-9.]+)/gi;

/** `cfRequestDuration` if present, otherwise the sum of the `cfSpeed*` entries. */
export function parseCloudflareServerTime(headers: Headers): number | undefined {
  const header = headers.get("server-timing");
  if (!header) return undefined;

  const requestDuration = Number(REQUEST_DURATION.exec(header)?.[1]);
  if (requestDuration > MIN_SERVER_TIME_MS) return requestDuration;

  let sum = 0;
  for (const match of header.matchAll(SPEED_ENTRIES)) sum += Number(match[1]);
  return sum > MIN_SERVER_TIME_MS ? sum : undefined;
}

export const cloudflareEndpoint: TestEndpoint = {
  id: "cloudflare",
  latencyUrl: () => `${ORIGIN}/__down?bytes=0`,
  downloadUrl: (bytes) => `${ORIGIN}/__down?bytes=${bytes}`,
  uploadUrl: () => `${ORIGIN}/__up`,
  maxDownloadBytes: 99_999_999,
  serverTimeMs: parseCloudflareServerTime,
};
