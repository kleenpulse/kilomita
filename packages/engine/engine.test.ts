import { SpeedTestResultSchema } from "@kilomita/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, cloudflareEndpoint, createSpeedTest } from "./index";
import { LOW_DATA_PROFILE, type Profile, STANDARD_PROFILE } from "./profiles";
import {
  type NetworkConditions,
  type SimulatedNetwork,
  blockRealNetwork,
  createSimulatedNetwork,
  strictThisFetch,
} from "./simulated-network";
import type {
  EngineError,
  EngineResult,
  FetchFn,
  ProgressEvent,
  SpeedTest,
  SpeedTestOptions,
  SpeedTestOutcome,
} from "./types";

const ResultSchema = SpeedTestResultSchema.pick({
  downloadMbps: true,
  uploadMbps: true,
  latency: true,
  loadedLatency: true,
  bytesUsed: true,
  durationMs: true,
  lowDataMode: true,
  engineVersion: true,
  serverId: true,
  measuredAt: true,
});

beforeEach(() => {
  vi.useFakeTimers();
  blockRealNetwork();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Events {
  progress: ProgressEvent[];
  complete: EngineResult[];
  error: EngineError[];
}

function record(test: SpeedTest): Events {
  const events: Events = { progress: [], complete: [], error: [] };
  test.on("progress", (event) => events.progress.push(event));
  test.on("complete", (event) => events.complete.push(event));
  test.on("error", (event) => events.error.push(event));
  return events;
}

interface Run {
  outcome: SpeedTestOutcome;
  events: Events;
  network: SimulatedNetwork;
  /** Virtual time from start() to the outcome. */
  elapsedMs: number;
}

/** Runs a test to its end on the fake clock, then checks it left nothing behind. */
async function runTest(
  test: SpeedTest,
  network: SimulatedNetwork,
  profile: Profile,
  maxDurationMs = profile.maxDurationMs,
): Promise<Run> {
  const events = record(test);
  const startedAt = performance.now();
  let ended: { outcome: SpeedTestOutcome; at: number } | undefined;
  void test.start().then((outcome) => {
    ended = { outcome, at: performance.now() };
  });
  while (ended === undefined) {
    await vi.advanceTimersByTimeAsync(50);
    if (performance.now() - startedAt > 120_000) throw new Error("The run never ended.");
  }
  const elapsedMs = ended.at - startedAt;
  expect(elapsedMs).toBeLessThanOrEqual(maxDurationMs);
  expect(network.stats.open).toBe(0);
  expect(network.stats.maxOpen).toBeLessThanOrEqual(maxOpen(profile));
  expect(vi.getTimerCount()).toBe(0);
  expect(events.complete.length + events.error.length).toBe(1);
  return { outcome: ended.outcome, events, network, elapsedMs };
}

function scenario(conditions: NetworkConditions, options: Partial<SpeedTestOptions> = {}) {
  const network = createSimulatedNetwork(conditions);
  const profile = options.lowData ? LOW_DATA_PROFILE : STANDARD_PROFILE;
  const test = createSpeedTest({
    endpoints: [cloudflareEndpoint],
    fetch: network.fetch,
    ...options,
  });
  return runTest(test, network, profile, options.maxDurationMs);
}

function completed(run: Run): EngineResult {
  if (run.outcome.status !== "complete") {
    throw new Error(`Expected a result, got ${JSON.stringify(run.outcome.error)}`);
  }
  return run.outcome.result;
}

function failed(run: Run): EngineError {
  if (run.outcome.status !== "error") throw new Error("Expected an error, got a result.");
  return run.outcome.error;
}

const within = (actual: number, expected: number, tolerance: number) => {
  expect(actual).toBeGreaterThanOrEqual(expected * (1 - tolerance));
  expect(actual).toBeLessThanOrEqual(expected * (1 + tolerance));
};

const isProbe = (input: string, init: RequestInit) =>
  init.method !== "POST" && new URL(input).searchParams.get("bytes") === "0";
const isDownload = (input: string, init: RequestInit) =>
  init.method !== "POST" && Number(new URL(input).searchParams.get("bytes")) > 0;
/** The warm-up and idle probes come first. */
const FIRST_LOW_DATA_LOADED_PROBE = LOW_DATA_PROFILE.idleProbes + 2;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Headers arrive, then the body never sends a byte until the request is aborted. */
function silentResponse(init: RequestInit): Promise<Response> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  init.signal?.addEventListener("abort", () => {
    controller.error(abortError());
  });
  return Promise.resolve(new Response(body));
}

/** Never answers (or answers `status` after `afterMs`), and honours abort. */
function unanswered(
  init: RequestInit,
  reply?: { afterMs: number; status: number },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = reply
      ? setTimeout(() => {
          resolve(new Response(null, { status: reply.status }));
        }, reply.afterMs)
      : undefined;
    init.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError());
    });
  });
}

/** One request slot per stream plus one for the loaded-latency probe. */
const maxOpen = (profile: Profile) =>
  Math.max(profile.maxStreams.download, profile.maxStreams.upload) + 1;

describe("accuracy", () => {
  it("measures a fast line that needs several streams", async () => {
    const run = await scenario(
      { downMbps: 150, upMbps: 40, rttMs: 20, perStreamMbps: 37.5, slowStartMs: 500 },
      { maxBytes: 400e6 },
    );
    const result = completed(run);
    within(result.downloadMbps, 150, 0.1);
    within(result.uploadMbps, 40, 0.1);
    expect(run.network.stats.maxConcurrent.download).toBeGreaterThanOrEqual(4);
    expect(result.stoppedBy).toEqual({ download: "stable", upload: "stable" });
  });

  it("ramps upload streams on settled data, despite upload's per-request lag", async () => {
    const run = await scenario(
      { downMbps: 40, upMbps: 40, rttMs: 100, perStreamMbps: 10, slowStartMs: 300 },
      { maxBytes: 400e6 },
    );
    within(completed(run).uploadMbps, 40, 0.1);
    expect(run.network.stats.maxConcurrent.upload).toBeGreaterThanOrEqual(4);
  });

  it("measures a slow line, with a round trip on every request", async () => {
    const result = completed(
      await scenario({ downMbps: 2, upMbps: 0.5, rttMs: 150, slowStartMs: 300 }),
    );
    within(result.downloadMbps, 2, 0.1);
    within(result.uploadMbps, 0.5, 0.1);
  });

  it("completes on 2G without false errors or loss", async () => {
    const run = await scenario(
      { downMbps: 0.25, upMbps: 0.1, rttMs: 700, handshakeRtts: 3 },
      { lowData: true },
    );
    const result = completed(run);
    within(result.downloadMbps, 0.25, 0.1);
    expect(result.uploadMbps).toBeGreaterThan(0);
    expect(result.latency.requestLossPct).toBe(0);
    expect(result.latency.idleMedianMs).toBe(700);
  });

  it("fits a slow 2G warm-up and heavy bloat into the 15 s low-data limit", async () => {
    const run = await scenario(
      { downMbps: 0.25, upMbps: 0.1, rttMs: 700, handshakeRtts: 7, bloatMs: 2000 },
      { lowData: true },
    );
    const result = completed(run);
    expect(result.durationMs).toBeLessThanOrEqual(15_000);
    expect(result.uploadMbps).toBeGreaterThan(0);
    expect(result.loadedLatency.downloadMs).toBeGreaterThanOrEqual(2000);
    expect(result.loadedLatency.uploadMs).toBeGreaterThanOrEqual(2000);
    expect(result.loadedLatency.grade).toBe("F");
  });

  it("cuts an unanswered loaded probe at the deadline and counts it as a lower bound", async () => {
    // Upload's only probe (sent one RTT in) would answer 4.3 s into a ~3.6 s phase: past 15 s.
    const run = await scenario(
      { downMbps: 0.25, upMbps: 0.1, rttMs: 700, handshakeRtts: 7, bloatMs: 2900 },
      { lowData: true },
    );
    const result = completed(run);
    expect(result.durationMs).toBeLessThanOrEqual(15_000);
    expect(result.loadedLatency.uploadMs).toBeGreaterThan(1500);
    expect(result.loadedLatency.uploadMs).toBeLessThan(2900 + 700);
  });

  it("counts a probe that times out under load as the timeout", async () => {
    const result = completed(await scenario({ downMbps: 20, upMbps: 5, rttMs: 40, bloatMs: 4000 }));
    expect(result.loadedLatency.downloadMs).toBe(STANDARD_PROFILE.probeTimeoutMs);
    expect(result.loadedLatency.grade).toBe("F");
  });

  it("keeps reading accurately when low-data mode ends at the cap on 4G", async () => {
    const run = await scenario(
      { downMbps: 40, upMbps: 10, rttMs: 30, slowStartMs: 500 },
      { lowData: true },
    );
    const result = completed(run);
    expect(result.stoppedBy).toEqual({ download: "data-cap", upload: "data-cap" });
    within(result.downloadMbps, 40, 0.15);
    within(result.uploadMbps, 10, 0.15);
  });

  it("doesn't call a steady climb stable", async () => {
    const result = completed(
      await scenario(
        // 10% a second compounds to 2.4% a tick: the last 4 estimates spread about 7%.
        { downMbps: 30, upMbps: 10, rttMs: 30, perStreamMbps: 25, capacityRampPerSec: 0.1 },
        { maxBytes: 400e6 },
      ),
    );
    expect(result.stoppedBy.download).toBe("time");
  });

  it("ends by an overridden max duration on a line that never settles", async () => {
    const run = await scenario(
      { downMbps: 10, upMbps: 5, rttMs: 50, capacityRampPerSec: 0.3 },
      { maxDurationMs: 12_000 },
    );
    const result = completed(run);
    // Phases stop 100 ms early, leaving room to abort requests and build the result.
    expect(result.durationMs).toBeLessThanOrEqual(12_000 - 100);
    expect(result.stoppedBy).toEqual({ download: "time", upload: "time" });
  });
});

describe("latency", () => {
  it("reports request loss on a flaky line and still completes", async () => {
    const result = completed(
      await scenario({ downMbps: 20, upMbps: 5, rttMs: 60, failureRate: 0.1, seed: 7 }),
    );
    expect(result.latency.requestLossPct).toBeGreaterThan(0);
    expect(result.latency.requestLossPct).toBeLessThan(30);
    within(result.downloadMbps, 20, 0.1);
  });

  it("measures jitter on a jittery line and keeps the median robust", async () => {
    const result = completed(
      await scenario({ downMbps: 20, upMbps: 5, rttMs: 100, jitterMs: 80, seed: 3 }),
    );
    // Two independent uniform ±80 ms delays differ by 2 × 80 / 3 ≈ 53 ms on average.
    expect(result.latency.jitterMs).toBeGreaterThan(40);
    expect(result.latency.jitterMs).toBeLessThan(65);
    within(result.latency.idleMedianMs, 100, 0.15);
  });

  it("grades bufferbloat from the latency added under load", async () => {
    const result = completed(await scenario({ downMbps: 20, upMbps: 5, rttMs: 40, bloatMs: 300 }));
    within(result.addedLatencyMs, 300, 0.05);
    expect(result.loadedLatency.grade).toBe("D");
  });

  it("subtracts server time from loaded probes too, so a clean line still gets an A", async () => {
    const result = completed(
      await scenario({ downMbps: 20, upMbps: 5, rttMs: 40, serverTimeMs: 30 }),
    );
    expect(result.latency.idleMedianMs).toBe(40);
    expect(result.loadedLatency.downloadMs).toBe(40);
    expect(result.loadedLatency.grade).toBe("A");
  });

  it("reports a loaded p95 at or above the loaded median, within the line's spread", async () => {
    const result = completed(
      await scenario({ downMbps: 20, upMbps: 5, rttMs: 40, bloatMs: 100, jitterMs: 30, seed: 7 }),
    );
    for (const direction of ["download", "upload"] as const) {
      const median = result.loadedLatency[`${direction}Ms`];
      expect(result.loadedP95Ms[direction]).toBeGreaterThan(median);
      expect(result.loadedP95Ms[direction]).toBeLessThanOrEqual(40 + 100 + 30);
    }
  });

  it("leaves probes sent during the warm-up out of the loaded p95, as out of the median", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 40 });
    let downloading = false;
    let slowed = false;
    // The first probe under load answers 2 s late; it is sent before the warm-up ends.
    const firstLoadedProbeSlow: FetchFn = async (input, init) => {
      const bytes = Number(new URL(input).searchParams.get("bytes"));
      if (bytes > 0) downloading = true;
      const response = await network.fetch(input, init);
      if (downloading && bytes === 0 && !slowed) {
        slowed = true;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      return response;
    };
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch: firstLoadedProbeSlow });
    const result = completed(await runTest(test, network, STANDARD_PROFILE));
    expect(slowed).toBe(true);
    expect(result.loadedLatency.downloadMs).toBe(40);
    expect(result.loadedP95Ms.download).toBe(40);
  });

  it("clamps latency at 0 when the server reports more time than was measured", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 20 });
    const inflated: FetchFn = async (input, init) => {
      const response = await network.fetch(input, init);
      const headers = new Headers(response.headers);
      headers.set("server-timing", "cfRequestDuration;dur=40");
      return new Response(response.body, { status: response.status, headers });
    };
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch: inflated });
    const result = completed(await runTest(test, network, STANDARD_PROFILE));
    expect(result.latency.idleMedianMs).toBe(0);
    expect(ResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("data cap", () => {
  it.each([
    ["standard", STANDARD_PROFILE, false],
    ["low-data", LOW_DATA_PROFILE, true],
  ] as const)("never asks for more than 95%% of the %s cap", async (_name, profile, lowData) => {
    const conditions = { downMbps: 300, upMbps: 300, rttMs: 15 };
    const first = await scenario(conditions, { lowData });
    const second = await scenario(conditions, { lowData });
    const result = completed(first);
    expect(result.stoppedBy).toEqual({ download: "data-cap", upload: "data-cap" });
    expect(first.network.stats.requestedBytes).toBeLessThanOrEqual(profile.maxBytes * 0.95);
    expect(result.bytesUsed).toBeLessThanOrEqual(profile.maxBytes * 0.95);
    // Only the wall-clock timestamp may differ between identical runs.
    expect({ ...completed(second), measuredAt: "" }).toEqual({ ...result, measuredAt: "" });
  });

  it("still reads a fast line roughly when the standard cap ends the test", async () => {
    const result = completed(await scenario({ downMbps: 300, upMbps: 300, rttMs: 15 }));
    within(result.downloadMbps, 300, 0.2);
  });
});

describe("failures", () => {
  it("reports a dropped connection quickly and stops sending", async () => {
    const run = await scenario({ downMbps: 20, upMbps: 5, rttMs: 50, dropAtMs: 3000 });
    expect(failed(run)).toMatchObject({ code: "network-lost", phase: "download" });
    expect(run.elapsedMs).toBeLessThan(4000);
    const calls = run.network.stats.calls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.network.stats.calls).toBe(calls);
  });

  it("reports a silent stall within the stall timeout", async () => {
    const run = await scenario({ downMbps: 20, upMbps: 5, rttMs: 50, stallAtMs: 3000 });
    expect(failed(run)).toMatchObject({ code: "network-lost", phase: "download" });
    expect(run.elapsedMs).toBeLessThanOrEqual(3000 + STANDARD_PROFILE.stallTimeoutMs + 300);
  });

  it("stops at once on a 4xx", async () => {
    const limited = await scenario({
      downMbps: 20,
      upMbps: 5,
      rttMs: 50,
      status: { code: 429, on: "all" },
    });
    expect(failed(limited)).toMatchObject({
      code: "endpoint-error",
      status: 429,
      phase: "latency",
    });
    expect(limited.network.stats.calls).toBe(1);

    const blocked = await scenario({
      downMbps: 20,
      upMbps: 5,
      rttMs: 50,
      status: { code: 403, on: "download" },
    });
    expect(failed(blocked)).toMatchObject({
      code: "endpoint-error",
      status: 403,
      phase: "download",
    });
    expect(blocked.network.stats.maxConcurrent.download).toBe(1);
  });

  it("stops at once on a 4xx to a probe under load", async () => {
    const run = await scenario({
      downMbps: 20,
      upMbps: 5,
      rttMs: 50,
      status: { code: 429, on: "loaded-probe" },
    });
    expect(failed(run)).toMatchObject({ code: "endpoint-error", status: 429, phase: "download" });
  });

  it("reports the server error when probes under load fail 4 times in a row", async () => {
    const run = await scenario({
      downMbps: 20,
      upMbps: 5,
      rttMs: 50,
      status: { code: 503, on: "loaded-probe" },
    });
    // A download probe can land in a gap between requests and succeed, resetting the count, so the
    // phase that fails isn't fixed; the run must still end with the server's status.
    expect(failed(run)).toMatchObject({ code: "endpoint-error", status: 503 });
    expect(run.elapsedMs).toBeLessThan(STANDARD_PROFILE.maxDurationMs - 5000);
  });

  it("retries a 5xx, then gives up after 4 failures in a row", async () => {
    const run = await scenario({
      downMbps: 20,
      upMbps: 5,
      rttMs: 50,
      status: { code: 503, on: "upload" },
    });
    expect(failed(run)).toMatchObject({ code: "endpoint-error", status: 503, phase: "upload" });
  });

  it("aborts and retries a download that stops sending, instead of freezing the reading", async () => {
    const network = createSimulatedNetwork({
      downMbps: 20,
      upMbps: 5,
      rttMs: 50,
      perStreamMbps: 5,
    });
    let downloads = 0;
    const fetch: FetchFn = (input, init) =>
      isDownload(input, init) && ++downloads === 4
        ? silentResponse(init)
        : network.fetch(input, init);
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch });
    within(completed(await runTest(test, network, STANDARD_PROFILE)).downloadMbps, 20, 0.1);
  });

  it("aborts and retries an upload that never gets its reply", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    let uploads = 0;
    const fetch: FetchFn = (input, init) =>
      init.method === "POST" && ++uploads === 3 ? unanswered(init) : network.fetch(input, init);
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch });
    within(completed(await runTest(test, network, STANDARD_PROFILE)).uploadMbps, 5, 0.1);
  });

  it("survives a failed probe in a phase too short to retry it under load", async () => {
    const network = createSimulatedNetwork({ downMbps: 300, upMbps: 300, rttMs: 15 });
    let probes = 0;
    const fetch: FetchFn = (input, init) =>
      isProbe(input, init) && ++probes === FIRST_LOW_DATA_LOADED_PROBE
        ? Promise.reject(new TypeError("Failed to fetch"))
        : network.fetch(input, init);
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch, lowData: true });
    const result = completed(await runTest(test, network, LOW_DATA_PROFILE));
    expect(result.stoppedBy).toEqual({ download: "data-cap", upload: "data-cap" });
  });

  it("stops on a 4xx to the loaded probe it waits for at the end of a phase", async () => {
    const network = createSimulatedNetwork({ downMbps: 300, upMbps: 300, rttMs: 15 });
    let probes = 0;
    // The phase ends at the cap long before this probe answers.
    const fetch: FetchFn = (input, init) =>
      isProbe(input, init) && ++probes === FIRST_LOW_DATA_LOADED_PROBE
        ? unanswered(init, { afterMs: 1000, status: 429 })
        : network.fetch(input, init);
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch, lowData: true });
    const run = await runTest(test, network, LOW_DATA_PROFILE);
    expect(failed(run)).toMatchObject({ code: "endpoint-error", status: 429, phase: "download" });
    expect(run.elapsedMs).toBeLessThan(5000);
  });
});

describe("lifecycle", () => {
  it("cancels mid-run with one event and no requests afterwards", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch: network.fetch });
    const events = record(test);
    const outcome = test.start();
    await vi.advanceTimersByTimeAsync(3000);
    test.cancel();
    test.cancel();
    expect(await outcome).toMatchObject({
      status: "error",
      error: { code: "cancelled", phase: "download" },
    });
    const calls = network.stats.calls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(network.stats.calls).toBe(calls);
    expect(network.stats.open).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(events.error).toHaveLength(1);
    expect(events.complete).toHaveLength(0);
  });

  it("treats cancel before start as the outcome, without a request", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch: network.fetch });
    const events = record(test);
    test.cancel();
    const first = test.start();
    expect(test.start()).toBe(first);
    expect(await first).toMatchObject({ status: "error", error: { code: "cancelled" } });
    expect(events.error).toHaveLength(1);
    expect(network.stats.calls).toBe(0);
  });

  it("ignores cancel after the test has ended and returns the same outcome", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch: network.fetch });
    const run = await runTest(test, network, STANDARD_PROFILE);
    test.cancel();
    expect(run.events.error).toHaveLength(0);
    expect(await test.start()).toBe(run.outcome);
  });

  it("emits progress through every phase, with data used never going down", async () => {
    const run = await scenario({ downMbps: 20, upMbps: 5, rttMs: 50 });
    const phases = run.events.progress.map((event) => event.phase);
    expect([...new Set(phases)]).toEqual(["latency", "download", "upload"]);
    const bytes = run.events.progress.map((event) => event.bytesUsed);
    expect(bytes).toEqual([...bytes].sort((a, b) => a - b));
    expect(
      run.events.progress.some((event) => event.phase === "download" && event.currentMbps !== null),
    ).toBe(true);
  });

  it("logs a throwing listener and keeps going", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint], fetch: network.fetch });
    test.on("progress", () => {
      throw new Error("listener bug");
    });
    completed(await runTest(test, network, STANDARD_PROFILE));
    expect(logged).toHaveBeenCalled();
  });

  it("produces a result the shared schema accepts", async () => {
    const result = completed(await scenario({ downMbps: 20, upMbps: 5, rttMs: 50 }));
    expect(ResultSchema.parse(result)).toMatchObject({
      engineVersion: ENGINE_VERSION,
      serverId: "cloudflare",
    });
  });
});

describe("fetch", () => {
  it("calls the global fetch without a foreign `this`", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    vi.stubGlobal("fetch", strictThisFetch(network.fetch));
    const test = createSpeedTest({ endpoints: [cloudflareEndpoint] });
    completed(await runTest(test, network, STANDARD_PROFILE));
  });

  it("calls a passed-in fetch without a foreign `this`", async () => {
    const network = createSimulatedNetwork({ downMbps: 20, upMbps: 5, rttMs: 50 });
    const test = createSpeedTest({
      endpoints: [cloudflareEndpoint],
      fetch: strictThisFetch(network.fetch),
    });
    completed(await runTest(test, network, STANDARD_PROFILE));
  });
});

describe("options", () => {
  it.each([
    { maxBytes: 999_999 },
    { maxBytes: Number.NaN },
    { maxBytes: Number.POSITIVE_INFINITY },
    { maxDurationMs: 9_999 },
    { maxDurationMs: Number.NaN },
  ])("rejects %o", (options) => {
    expect(() => createSpeedTest({ endpoints: [cloudflareEndpoint], ...options })).toThrow(
      RangeError,
    );
  });
});

describe("ENGINE_VERSION", () => {
  it("is accepted by the result schema", () => {
    expect(SpeedTestResultSchema.shape.engineVersion.safeParse(ENGINE_VERSION).success).toBe(true);
  });
});
