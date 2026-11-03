import type { TestEndpoint } from "./endpoint";

/*
 * KiloMita's own measurement servers (apps/server). Every request carries the run's ticket, which
 * the web app signs and the server checks, so the server can't be used as a free download sink.
 * The ticket travels in the query string to keep requests CORS-simple (no preflight).
 */

/** The largest download a server answers; the engine never asks for more in one request. */
export const SELF_HOSTED_MAX_DOWNLOAD_BYTES = 25_000_000;

const APP_DURATION = /(?:^|,\s*)app;\s*dur=([0-9.]+)/i;

/** The server's own processing time, from `Server-Timing: app;dur=<ms>`. */
export function parseAppServerTime(headers: Headers): number | undefined {
  const value = Number(APP_DURATION.exec(headers.get("server-timing") ?? "")?.[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export interface SelfHostedServer {
  /** Reported as `serverId`. */
  id: string;
  /** e.g. `https://lagos-1.example.ng`, no trailing slash. */
  origin: string;
  ticket: string;
}

export function selfHostedEndpoint({ id, origin, ticket }: SelfHostedServer): TestEndpoint {
  const t = encodeURIComponent(ticket);
  return {
    id,
    latencyUrl: () => `${origin}/ping?t=${t}`,
    downloadUrl: (bytes) => `${origin}/down?bytes=${bytes}&t=${t}`,
    uploadUrl: () => `${origin}/up?t=${t}`,
    maxDownloadBytes: SELF_HOSTED_MAX_DOWNLOAD_BYTES,
    serverTimeMs: parseAppServerTime,
  };
}
