import { beforeEach, describe, expect, it } from "vitest";
import { ByteBudget, makePayload, nextRequestSize, stallLimitMs } from "./transfer";
import { blockRealNetwork } from "./simulated-network";

beforeEach(() => {
  blockRealNetwork();
});

describe("ByteBudget", () => {
  it("never hands out more than its total, however it is asked", () => {
    const budget = new ByteBudget(1000.9);
    const reserved = [400, 400, 400, 400].map((wanted) => budget.reserve(wanted));
    expect(reserved).toEqual([400, 400, 200, 0]);
    expect(budget.remaining).toBe(0);
  });

  it("ignores negative and fractional requests", () => {
    const budget = new ByteBudget(10);
    expect(budget.reserve(-5)).toBe(0);
    expect(budget.reserve(2.7)).toBe(2);
    expect(budget.remaining).toBe(8);
  });
});

describe("nextRequestSize", () => {
  const base = {
    rate: 100,
    targetMs: 1000,
    idleRttMs: 20,
    minBytes: 64_000,
    maxBytes: 25_000_000,
    remaining: 1e9,
    streams: 1,
  };

  it("starts with the minimum before the stream has a rate", () => {
    expect(nextRequestSize({ ...base, rate: null })).toBe(64_000);
  });

  it("lasts the target time at the stream's rate", () => {
    expect(nextRequestSize(base)).toBe(100_000);
  });

  it("lasts at least 8 idle round trips on high-latency lines", () => {
    expect(nextRequestSize({ ...base, idleRttMs: 250 })).toBe(200_000);
  });

  it("is clamped to the minimum, the maximum and the per-stream share of the budget", () => {
    expect(nextRequestSize({ ...base, rate: 1 })).toBe(64_000);
    expect(nextRequestSize({ ...base, rate: 1e6 })).toBe(25_000_000);
    expect(nextRequestSize({ ...base, remaining: 300_000, streams: 3 })).toBe(100_000);
  });

  it("returns 0 once the budget can't give every stream a minimum request", () => {
    expect(nextRequestSize({ ...base, remaining: 190_000, streams: 3 })).toBe(0);
    expect(nextRequestSize({ ...base, remaining: 63_999, rate: null })).toBe(0);
  });
});

describe("stallLimitMs", () => {
  it("uses the stall timeout for downloads", () => {
    expect(stallLimitMs("download", 6000, 9000)).toBe(6000);
  });

  it("allows twice the last POST's duration for uploads on slow lines", () => {
    expect(stallLimitMs("upload", 6000, 0)).toBe(6000);
    expect(stallLimitMs("upload", 6000, 2000)).toBe(6000);
    expect(stallLimitMs("upload", 6000, 4500)).toBe(9000);
  });
});

describe("makePayload", () => {
  it("is the requested size and the same every time", () => {
    const payload = makePayload(1001);
    expect(payload.byteLength).toBe(1001);
    expect(makePayload(1001)).toEqual(payload);
  });

  it("looks random, so proxies can't compress it", () => {
    const payload = makePayload(65_536);
    expect(new Set(payload).size).toBe(256);
  });
});
