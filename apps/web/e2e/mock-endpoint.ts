import type { BrowserContext, Route } from "@playwright/test";

/*
 * A mocked speed test server for e2e. It answers the Cloudflare adapter's URLs from the test
 * process, so no test ever reaches Cloudflare (playwright.config.ts also fences the host's DNS).
 *
 * The "link" is processor-shared: in-flight transfers of one direction split its capacity
 * equally, like TCP flows on one line. route.fulfill delivers each body in one burst, so the
 * engine sees spiky ticks; readings are only roughly the configured rates.
 */

const HOST = "speed.cloudflare.com";
const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export interface MockOptions {
  downMbps?: number;
  upMbps?: number;
  rttMs?: number;
  /** Extra delay for latency probes while any transfer is in flight (bufferbloat). */
  bloatMs?: number;
  /** Answer every request of these kinds with this HTTP status. */
  status?: { code: number; on: readonly ("probe" | "download" | "upload")[] };
  /** Fail every request with a network error. */
  fail?: boolean;
}

export interface MockStats {
  /** Requests to the host that the route handled. */
  routed: number;
  /** Requests to the host that the browser issued (pages and workers). */
  issued: number;
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

export async function mockSpeedEndpoint(
  context: BrowserContext,
  options: MockOptions = {},
): Promise<MockStats> {
  const { downMbps = 8, upMbps = 2, rttMs = 40, bloatMs = 0 } = options;
  let transfersInFlight = 0;
  const down = new SharedLink(downMbps);
  const up = new SharedLink(upMbps);
  const stats: MockStats = { routed: 0, issued: 0, maxDelayMs: 0, lastArrivalAt: 0 };

  context.on("request", (request) => {
    if (new URL(request.url()).hostname === HOST) stats.issued++;
  });

  async function answer(route: Route): Promise<void> {
    const arrived = Date.now();
    stats.routed++;
    stats.lastArrivalAt = arrived;
    const request = route.request();
    const url = new URL(request.url());

    let kind: "probe" | "download" | "upload";
    let bytes = 0;
    if (url.pathname === "/__down" && request.method() === "GET") {
      bytes = Number(url.searchParams.get("bytes") ?? "0");
      kind = bytes === 0 ? "probe" : "download";
    } else if (url.pathname === "/__up" && request.method() === "POST") {
      kind = "upload";
      bytes = request.postDataBuffer()?.length ?? 0;
    } else {
      await route.abort("blockedbyclient");
      return;
    }

    if (options.fail) {
      await sleep(rttMs);
      await route.abort("connectionreset");
      return;
    }
    if (options.status?.on.includes(kind)) {
      await sleep(rttMs);
      await route.fulfill({ status: options.status.code, headers: CORS, body: "" });
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
  }

  await context.route(`https://${HOST}/**`, async (route) => {
    try {
      await answer(route);
    } catch {
      // The run was stopped or the page closed while this answer was pending.
    }
  });
  return stats;
}
