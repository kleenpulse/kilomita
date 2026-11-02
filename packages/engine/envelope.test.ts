import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAUSIBILITY, outsideEnvelope } from "./envelope";
import { cloudflareEndpoint, createSpeedTest } from "./index";
import {
  type NetworkConditions,
  blockRealNetwork,
  createSimulatedNetwork,
} from "./simulated-network";
import type { EngineResult, SpeedTestOutcome } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  blockRealNetwork();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LINKS: readonly (readonly [string, NetworkConditions])[] = [
  ["2G", { downMbps: 0.2, upMbps: 0.1, rttMs: 600, jitterMs: 100 }],
  ["3G", { downMbps: 2, upMbps: 0.5, rttMs: 150, jitterMs: 30 }],
  ["4G", { downMbps: 20, upMbps: 5, rttMs: 50, jitterMs: 10 }],
  ["4G with bloat", { downMbps: 20, upMbps: 5, rttMs: 50, bloatMs: 400 }],
  ["4G with failures", { downMbps: 15, upMbps: 4, rttMs: 60, failureRate: 0.05 }],
  ["fibre", { downMbps: 100, upMbps: 50, rttMs: 15 }],
  ["300 Mbps", { downMbps: 300, upMbps: 100, rttMs: 10 }],
  ["300 Mbps, slow start", { downMbps: 300, upMbps: 300, rttMs: 8, slowStartMs: 2000 }],
  ["1 Gbps", { downMbps: 1000, upMbps: 500, rttMs: 4 }],
  ["1 Gbps symmetric", { downMbps: 1000, upMbps: 1000, rttMs: 2 }],
];

async function measure(conditions: NetworkConditions, lowData: boolean): Promise<EngineResult> {
  const network = createSimulatedNetwork({ seed: 7, ...conditions });
  const test = createSpeedTest({ endpoint: cloudflareEndpoint, fetch: network.fetch, lowData });
  let outcome: SpeedTestOutcome | undefined;
  void test.start().then((ended) => {
    outcome = ended;
  });
  while (outcome === undefined) await vi.advanceTimersByTimeAsync(50);
  if (outcome.status !== "complete") throw new Error(`No result: ${outcome.error.code}`);
  return outcome.result;
}

describe("the plausibility envelope", () => {
  for (const lowData of [false, true]) {
    for (const [name, conditions] of LINKS) {
      it(`holds every genuine result with a 2x margin: ${name}${lowData ? ", low-data" : ""}`, async () => {
        const result = await measure(conditions, lowData);
        expect(outsideEnvelope(result)).toBeNull();
        expect(result.durationMs).toBeGreaterThanOrEqual(2 * PLAUSIBILITY.minDurationMs);
        const dataSeconds =
          (result.bytesUsed * 8) / 1e6 / (result.downloadMbps + result.uploadMbps);
        expect(dataSeconds).toBeGreaterThanOrEqual(2 * PLAUSIBILITY.minDataSeconds);
      });
    }
  }

  it("is tight: the fastest simulated runs come within 2.5x of each floor", async () => {
    const fast = await measure({ downMbps: 1000, upMbps: 1000, rttMs: 2 }, true);
    expect(fast.durationMs).toBeLessThan(2.5 * PLAUSIBILITY.minDurationMs);
    const dataSeconds = (fast.bytesUsed * 8) / 1e6 / (fast.downloadMbps + fast.uploadMbps);
    expect(dataSeconds).toBeLessThan(2.5 * PLAUSIBILITY.minDataSeconds);
  });

  it("names what a result misses", () => {
    const base = { durationMs: 10_000, bytesUsed: 10_000_000, downloadMbps: 20, uploadMbps: 5 };
    expect(outsideEnvelope(base)).toBeNull();
    expect(outsideEnvelope({ ...base, durationMs: 249 })).toBe("too-short");
    expect(outsideEnvelope({ ...base, durationMs: 250 })).toBeNull();
    // 25 Mbps for 0.125 s is 390,625 bytes.
    expect(outsideEnvelope({ ...base, bytesUsed: 390_624 })).toBe("too-little-data");
    expect(outsideEnvelope({ ...base, bytesUsed: 390_625 })).toBeNull();
  });
});
