import type { BrowserContext, Route } from "@playwright/test";

/*
 * Mocked speed test servers for e2e, answered from the test process, so no test ever reaches a
 * real test server (playwright.config.ts also fails every hostname's DNS, and the fence fixture
 * in helpers.ts aborts and records anything else).
 *
 * - speed.cloudflare.com: the Cloudflare adapter's /__down and /__up (the fallback).
 * - lagos-e2e.kilomita.test: our own server's /ping, /down and /up; each needs a run ticket.
 * - 127.0.0.1:3945: the real apps/server that playwright.config.ts starts. Answered with 503
 *   unless a test asks for the real thing, so the paced mock stays the one that's measured.
 *
 * Each "link" is processor-shared: in-flight transfers of one direction split its capacity
 * equally, like TCP flows on one line. route.fulfill delivers each body in one burst, so the
 * engine sees spiky ticks; readings are only roughly the configured rates.
 */

export const CLOUDFLARE_HOST = "speed.cloudflare.com";
export const OUR_HOST = "lagos-e2e.kilomita.test";
export const REAL_SERVER = "127.0.0.1:3945";
const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

type Kind = "probe" | "download" | "upload";

export interface LinkOptions {
  downMbps?: number;
  upMbps?: number;
  rttMs?: number;
  /** Extra delay for latency probes while any transfer is in flight (bufferbloat). */
  bloatMs?: number;
  /** Answer every request of these kinds with this HTTP status. */
  status?: { code: number; on: readonly Kind[] };
  /** Fail every request with a network error. */
  fail?: boolean;
}

export interface MockOptions extends LinkOptions {
  /** Overrides for our mocked server; it otherwise behaves as the options above say. */
  ours?: LinkOptions;
  /** Overrides for the Cloudflare mock; it otherwise behaves as the options above say. */
  cloudflare?: LinkOptions;
  /** Let requests through to the real apps/server instead of answering 503. */
  realServer?: boolean;
}

export interface MockStats {
  /** Requests to the mocked hosts that the routes handled. */
  routed: number;
  /** Requests to the mocked hosts that the browser issued (pages and workers). */
  issued: number;
  /** Per host: requests the routes handled. */
  byHost: Record<string, number>;
  /** Longest wait between a request arriving and its answer, in ms. */
  maxDelayMs: number;
  /** When the latest request arrived (Date.now()). */
  lastArrivalAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SharedLink {
  readonly #bytesPerMs: number;
  readonly #flows = new Set<{ remaining: number; done: () => void }>();
  #last = performance.now();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(mbps: number) {
    this.#bytesPerMs = mbps * 125;
  }

  transfer(bytes: number): Promise<void> {
    if (bytes <= 0) return Promise.resolve();
    this.#advance();
    return new Promise((done) => {
      this.#flows.add({ remaining: bytes, done });
      this.#schedule();
    });
  }

  #advance(): void {
    const now = performance.now();
    const share = (this.#bytesPerMs * (now - this.#last)) / Math.max(1, this.#flows.size);
    this.#last = now;
    for (const flow of this.#flows) flow.remaining -= share;
  }

  #schedule(): void {
    this.#advance();
    for (const flow of this.#flows) {
      if (flow.remaining <= 0.5) {
        this.#flows.delete(flow);
        flow.done();
      }
    }
    clearTimeout(this.#timer);
    if (this.#flows.size === 0) return;
    const smallest = Math.min(...[...this.#flows].map((flow) => flow.remaining));
    const eta = (smallest * this.#flows.size) / this.#bytesPerMs;
    this.#timer = setTimeout(
      () => {
        this.#schedule();
      },
      Math.max(1, eta),
    );
  }
}

/** How a request maps onto a kind for each server's URL scheme, or null if it isn't one. */
function classify(host: string, url: URL, method: string): { kind: Kind; bytes: number } | null {
  if (host === CLOUDFLARE_HOST) {
    if (url.pathname === "/__down" && method === "GET") {
      const bytes = Number(url.searchParams.get("bytes") ?? "0");
      return { kind: bytes === 0 ? "probe" : "download", bytes };
    }
    if (url.pathname === "/__up" && method === "POST") return { kind: "upload", bytes: 0 };
    return null;
  }
  if (url.pathname === "/ping" && method === "GET") return { kind: "probe", bytes: 0 };
  if (url.pathname === "/down" && method === "GET") {
    return { kind: "download", bytes: Number(url.searchParams.get("bytes") ?? "0") };
  }
  if (url.pathname === "/up" && method === "POST") return { kind: "upload", bytes: 0 };
  return null;
}

function mockServer(host: string, options: LinkOptions, stats: MockStats) {
  const { downMbps = 8, upMbps = 2, rttMs = 40, bloatMs = 0 } = options;
  let transfersInFlight = 0;
  const down = new SharedLink(downMbps);
  const up = new SharedLink(upMbps);

  return async (route: Route): Promise<void> => {
    const arrived = Date.now();
    stats.routed++;
    stats.byHost[host] = (stats.byHost[host] ?? 0) + 1;
    stats.lastArrivalAt = arrived;
    const request = route.request();
    const url = new URL(request.url());
    const found = classify(host, url, request.method());
    if (!found) {
      await route.abort("blockedbyclient");
      return;
    }
    const { kind } = found;
    const bytes = kind === "upload" ? (request.postDataBuffer()?.length ?? 0) : found.bytes;

    if (options.fail) {
      await sleep(rttMs);
      await route.abort("connectionreset");
      return;
    }
    // Our servers refuse anything without a run ticket, as the real one does.
    const refused = host === OUR_HOST && !url.searchParams.get("t") ? 403 : undefined;
    const status = refused ?? (options.status?.on.includes(kind) ? options.status.code : undefined);
    if (status !== undefined) {
      await sleep(rttMs);
      await route.fulfill({ status, headers: CORS, body: "" });
      return;
    }

    if (kind === "probe") {
      await sleep(rttMs + (transfersInFlight > 0 ? bloatMs : 0));
    } else {
      transfersInFlight++;
      try {
        if (kind === "upload") await up.transfer(bytes);
        await sleep(rttMs);
        if (kind === "download") await down.transfer(bytes);
      } finally {
        transfersInFlight--;
      }
    }
    stats.maxDelayMs = Math.max(stats.maxDelayMs, Date.now() - arrived);
    await route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/octet-stream" },
      body: kind === "download" ? Buffer.alloc(bytes) : "",
    });
  };
}

export async function mockSpeedEndpoint(
  context: BrowserContext,
  options: MockOptions = {},
): Promise<MockStats> {
  const { ours, cloudflare, realServer, ...shared } = options;
  const stats: MockStats = { routed: 0, issued: 0, byHost: {}, maxDelayMs: 0, lastArrivalAt: 0 };
  const hosts = new Set([CLOUDFLARE_HOST, OUR_HOST, REAL_SERVER]);

  context.on("request", (request) => {
    if (hosts.has(new URL(request.url()).host)) stats.issued++;
  });

  const routes: [string, (route: Route) => Promise<void>][] = [
    [CLOUDFLARE_HOST, mockServer(CLOUDFLARE_HOST, { ...shared, ...cloudflare }, stats)],
    [OUR_HOST, mockServer(OUR_HOST, { ...shared, ...ours }, stats)],
    [
      REAL_SERVER,
      async (route) => {
        stats.routed++;
        stats.byHost[REAL_SERVER] = (stats.byHost[REAL_SERVER] ?? 0) + 1;
        if (realServer) await route.continue();
        else await route.fulfill({ status: 503, headers: CORS, body: "" });
      },
    ],
  ];
  for (const [host, handle] of routes) {
    const scheme = host === REAL_SERVER ? "http" : "https";
    await context.route(`${scheme}://${host}/**`, async (route) => {
      try {
        await handle(route);
      } catch {
        // The run was stopped or the page closed while this answer was pending.
      }
    });
  }
  return stats;
}
