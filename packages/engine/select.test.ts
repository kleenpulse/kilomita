import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudflareEndpoint, createSpeedTest, selfHostedEndpoint } from "./index";
import { STANDARD_PROFILE } from "./profiles";
import { selectEndpoint } from "./select";
import { parseAppServerTime } from "./self-hosted";
import {
  type NetworkConditions,
  type SimulatedNetwork,
  blockRealNetwork,
  createSimulatedNetwork,
  routeByOrigin,
  testContext,
} from "./simulated-network";
import type { FetchFn, ProgressEvent, SpeedTestOptions, SpeedTestOutcome } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  blockRealNetwork();
});

afterEach(() => {
  vi.useRealTimers();
});

const A = selfHostedEndpoint({ id: "lagos-a", origin: "https://a.test", ticket: "tick/et+1" });
const B = selfHostedEndpoint({ id: "lagos-b", origin: "https://b.test", ticket: "tick/et+1" });
const CF_ORIGIN = "https://speed.cloudflare.com";
const LINK = { downMbps: 20, upMbps: 5 };

type Hosts = Record<string, NetworkConditions>;

interface Run {
  outcome: SpeedTestOutcome;
  progress: ProgressEvent[];
  networks: Record<string, SimulatedNetwork>;
  urls: string[];
  elapsedMs: number;
}

async function run(hosts: Hosts, options: Omit<SpeedTestOptions, "fetch">): Promise<Run> {
  const networks = Object.fromEntries(
    Object.entries(hosts).map(([origin, conditions]) => [
      origin,
      createSimulatedNetwork(conditions),
    ]),
  );
  const urls: string[] = [];
  const routed = routeByOrigin(
    Object.fromEntries(Object.entries(networks).map(([origin, net]) => [origin, net.fetch])),
  );
  const fetch: FetchFn = (input, init) => {
    urls.push(input);
    return routed(input, init);
  };
  const test = createSpeedTest({ ...options, fetch });
  const progress: ProgressEvent[] = [];
  test.on("progress", (event) => progress.push(event));
  const startedAt = performance.now();
  let ended: { outcome: SpeedTestOutcome; at: number } | undefined;
  void test.start().then((outcome) => {
    ended = { outcome, at: performance.now() };
  });
  while (ended === undefined) {
    await vi.advanceTimersByTimeAsync(50);
    if (performance.now() - startedAt > 120_000) throw new Error("The run never ended.");
  }
  for (const net of Object.values(networks)) expect(net.stats.open).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  return { outcome: ended.outcome, progress, networks, urls, elapsedMs: ended.at - startedAt };
}

function serverOf(result: Run): string {
  if (result.outcome.status !== "complete") {
    throw new Error(`Expected a result, got ${JSON.stringify(result.outcome.error)}`);
  }
  return result.outcome.result.serverId;
}

function errorOf(result: Run) {
  if (result.outcome.status !== "error") throw new Error("Expected an error, got a result.");
  return result.outcome.error;
}

describe("selfHostedEndpoint", () => {
  it("builds ticketed URLs for the server's routes", () => {
    expect(A.id).toBe("lagos-a");
    expect(A.latencyUrl()).toBe("https://a.test/ping?t=tick%2Fet%2B1");
    expect(A.downloadUrl(4096)).toBe("https://a.test/down?bytes=4096&t=tick%2Fet%2B1");
    expect(A.uploadUrl()).toBe("https://a.test/up?t=tick%2Fet%2B1");
    expect(A.maxDownloadBytes).toBe(25_000_000);
  });

  it("reads the server's app time from Server-Timing", () => {
    expect(parseAppServerTime(new Headers({ "server-timing": "app;dur=1.25" }))).toBe(1.25);
    expect(parseAppServerTime(new Headers({ "server-timing": "db;dur=3, app;dur=2" }))).toBe(2);
    expect(
      parseAppServerTime(new Headers({ "server-timing": "cfSpeedWorker;dur=9" })),
    ).toBeUndefined();
    expect(parseAppServerTime(new Headers({ "server-timing": "app;dur=0" }))).toBeUndefined();
    expect(parseAppServerTime(new Headers())).toBeUndefined();
  });
});

describe("server selection", () => {
  it("picks the candidate with the lowest latency", async () => {
    const result = await run(
      { "https://a.test": { ...LINK, rttMs: 80 }, "https://b.test": { ...LINK, rttMs: 30 } },
      { endpoints: [A, B] },
    );
    expect(serverOf(result)).toBe("lagos-b");
    expect(result.progress[0]?.phase).toBe("select");
  });

  it("breaks ties by list order", async () => {
    const result = await run(
      { "https://a.test": { ...LINK, rttMs: 50 }, "https://b.test": { ...LINK, rttMs: 50 } },
      { endpoints: [A, B] },
    );
    expect(serverOf(result)).toBe("lagos-a");
  });

  it("ranks on latency with the server's own time taken out", async () => {
    // A answers in 40 + 30 ms but reports 30 ms of server time; B answers in 50 ms.
    const result = await run(
      {
        "https://a.test": { ...LINK, rttMs: 40, serverTimeMs: 30, serverTiming: "app" },
        "https://b.test": { ...LINK, rttMs: 50 },
      },
      { endpoints: [A, B] },
    );
    expect(serverOf(result)).toBe("lagos-a");
  });

  it.each([403, 429, 503])("drops a candidate answering %i at once", async (code) => {
    const result = await run(
      {
        "https://a.test": { ...LINK, rttMs: 20, status: { code, on: "all" } },
        "https://b.test": { ...LINK, rttMs: 60 },
      },
      { endpoints: [A, B] },
    );
    expect(serverOf(result)).toBe("lagos-b");
    expect(result.networks["https://a.test"]?.stats.calls).toBe(1);
  });

  it.each([403, 503])("falls back when the only candidate answers %i", async (code) => {
    const result = await run(
      {
        "https://a.test": { ...LINK, rttMs: 20, status: { code, on: "all" } },
        [CF_ORIGIN]: { ...LINK, rttMs: 40 },
      },
      { endpoints: [A], fallback: cloudflareEndpoint },
    );
    expect(serverOf(result)).toBe("cloudflare");
    expect(result.networks["https://a.test"]?.stats.calls).toBe(1);
    expect(result.elapsedMs).toBeLessThan(STANDARD_PROFILE.maxDurationMs);
  });

  it("falls back once an unreachable candidate passes the stall timeout, and counts no loss", async () => {
    const result = await run(
      {
        "https://a.test": { ...LINK, rttMs: 20, failureRate: 1 },
        [CF_ORIGIN]: { ...LINK, rttMs: 40 },
      },
      { endpoints: [A], fallback: cloudflareEndpoint, lowData: true },
    );
    expect(serverOf(result)).toBe("cloudflare");
    if (result.outcome.status !== "complete") throw new Error("unreachable");
    expect(result.outcome.result.latency.requestLossPct).toBe(0);
    expect(result.elapsedMs).toBeLessThanOrEqual(15_000);
  });

  it("says no server is available when every candidate refuses and there is no fallback", async () => {
    const result = await run(
      {
        "https://a.test": { ...LINK, rttMs: 20, status: { code: 403, on: "all" } },
        "https://b.test": { ...LINK, rttMs: 20, status: { code: 503, on: "all" } },
      },
      { endpoints: [A, B] },
    );
    expect(errorOf(result)).toMatchObject({ code: "no-server", phase: "select" });
  });

  it("says the connection is lost when no candidate answers at all", async () => {
    const result = await run(
      {
        "https://a.test": { ...LINK, rttMs: 20, failureRate: 1 },
        "https://b.test": { ...LINK, rttMs: 20, failureRate: 1 },
      },
      { endpoints: [A, B] },
    );
    expect(errorOf(result)).toMatchObject({ code: "network-lost", phase: "select" });
  });

  it("keeps Phase 1 behaviour with one server and no fallback: no selection, 4xx ends the run", async () => {
    const result = await run(
      { "https://a.test": { ...LINK, rttMs: 20, status: { code: 403, on: "all" } } },
      { endpoints: [A] },
    );
    expect(errorOf(result)).toMatchObject({
      code: "endpoint-error",
      status: 403,
      phase: "latency",
    });
    expect(result.progress.some((event) => event.phase === "select")).toBe(false);
  });

  it("costs a single candidate no extra requests: its warm-up is the selection", async () => {
    const hosts = { "https://a.test": { ...LINK, rttMs: 30 } };
    const plain = await run(hosts, { endpoints: [A], lowData: true });
    const withFallback = await run(
      { ...hosts, [CF_ORIGIN]: { ...LINK, rttMs: 30 } },
      { endpoints: [A], fallback: cloudflareEndpoint, lowData: true },
    );
    expect(serverOf(withFallback)).toBe("lagos-a");
    expect(withFallback.networks["https://a.test"]?.stats.calls).toBe(
      plain.networks["https://a.test"]?.stats.calls,
    );
    expect(withFallback.networks[CF_ORIGIN]?.stats.calls).toBe(0);
  });

  it("sends the ticket with every request to our servers", async () => {
    const result = await run(
      { "https://a.test": { ...LINK, rttMs: 30 } },
      {
        endpoints: [A],
        lowData: true,
      },
    );
    expect(result.urls.length).toBeGreaterThan(10);
    for (const url of result.urls) expect(new URL(url).searchParams.get("t")).toBe("tick/et+1");
  });

  it("can be cancelled while it is choosing", async () => {
    const networks = {
      "https://a.test": createSimulatedNetwork({ ...LINK, rttMs: 500 }),
      "https://b.test": createSimulatedNetwork({ ...LINK, rttMs: 500 }),
    };
    const test = createSpeedTest({
      endpoints: [A, B],
      fetch: routeByOrigin({
        "https://a.test": networks["https://a.test"].fetch,
        "https://b.test": networks["https://b.test"].fetch,
      }),
    });
    const outcome = test.start();
    await vi.advanceTimersByTimeAsync(100);
    test.cancel();
    expect(await outcome).toMatchObject({
      status: "error",
      error: { code: "cancelled", phase: "select" },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(networks["https://a.test"].stats.open + networks["https://b.test"].stats.open).toBe(0);
  });

  it("uses the fallback alone when no candidate is configured", async () => {
    const result = await run(
      { [CF_ORIGIN]: { ...LINK, rttMs: 30 } },
      {
        endpoints: [],
        fallback: cloudflareEndpoint,
        lowData: true,
      },
    );
    expect(serverOf(result)).toBe("cloudflare");
  });

  it("needs at least one server", () => {
    expect(() => createSpeedTest({ endpoints: [] })).toThrow(RangeError);
  });
});

describe("selectEndpoint", () => {
  it("probes the candidates in turn, one at a time", async () => {
    const order: string[] = [];
    const busyAtStart: number[] = [];
    let inFlight = 0;
    const net = createSimulatedNetwork({ ...LINK, rttMs: 40 });
    const fetch: FetchFn = async (input, init) => {
      order.push(new URL(input).host);
      busyAtStart.push(inFlight);
      inFlight++;
      try {
        return await net.fetch(input, init);
      } finally {
        inFlight--;
      }
    };
    const selection = selectEndpoint(testContext(fetch), [A, B], undefined);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await selection).toEqual({ endpoint: A, warmedUp: true });
    // Parallel warm-ups first, then two timed rounds, alternating.
    expect(order.slice(2)).toEqual(["a.test", "b.test", "a.test", "b.test"]);
    expect(busyAtStart.slice(2)).toEqual([0, 0, 0, 0]);
  });
});
