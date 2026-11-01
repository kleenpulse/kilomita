import { beforeEach, describe, expect, it } from "vitest";
import { blockRealNetwork } from "./simulated-network";
import {
  ThroughputMeter,
  eligibleSamples,
  finalEstimate,
  findWarmupEnd,
  isStable,
  windowEstimate,
} from "./throughput";

beforeEach(() => {
  blockRealNetwork();
});

/** Bytes that move at `mbps` for `ms`. */
const bytesAt = (mbps: number, ms: number) => mbps * 125 * ms;

describe("ThroughputMeter", () => {
  it("spreads a segment evenly across the ticks it covers", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(0);
    meter.record(id, 500, bytesAt(2, 500));
    expect(meter.samples(500)).toEqual([2, 2]);
    expect(meter.totalBytes).toBe(bytesAt(2, 500));
  });

  it("splits a segment that straddles a tick boundary by overlap", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(200);
    meter.record(id, 300, bytesAt(8, 100));
    // 50 ms of the 100 ms segment fall in each tick.
    expect(meter.samples(500)).toEqual([1.6, 1.6]);
  });

  it("puts an instantaneous segment in the tick that ends at its time", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(250);
    meter.record(id, 250, bytesAt(1, 250));
    expect(meter.samples(500)).toEqual([1, 0]);
  });

  it("adds parallel transfers together", () => {
    const meter = new ThroughputMeter(0);
    const a = meter.open(0);
    const b = meter.open(0);
    meter.record(a, 250, bytesAt(3, 250));
    meter.record(b, 250, bytesAt(2, 250));
    expect(meter.samples(250)).toEqual([5]);
  });

  it("excludes bytes after `until` and offsets ticks from the origin", () => {
    const meter = new ThroughputMeter(1000);
    const id = meter.open(1000);
    meter.record(id, 1500, bytesAt(4, 500));
    expect(meter.samples(1250)).toEqual([4]);
    expect(meter.samples(999)).toEqual([]);
  });

  it("leaves out instantaneous segments past `until` or past the last tick", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(300);
    meter.record(id, 300, 1000);
    expect(meter.samples(310)).toEqual([0]);
    expect(meter.samples(299, true)).toEqual([0]);
  });

  it("gives a partial tick nothing from a segment that starts after `until`", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(320);
    meter.record(id, 400, 1000);
    expect(meter.samples(310, true)).toEqual([0, 0]);
  });

  it("normalises a trailing partial tick by its real length, and drops one under 50 ms", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(0);
    meter.record(id, 375, bytesAt(1, 375));
    expect(meter.samples(375, true)).toEqual([1, 1]);
    expect(meter.samples(260, true)).toEqual([1]);
    expect(meter.samples(375)).toEqual([1]);
  });

  it("settles only up to the oldest unrecorded byte of an open transfer", () => {
    const meter = new ThroughputMeter(0);
    const a = meter.open(0);
    const b = meter.open(100);
    meter.record(a, 400, 1000);
    expect(meter.settledUntil(450)).toBe(100);
    meter.record(b, 420, 1000);
    expect(meter.settledUntil(450)).toBe(400);
    meter.close(a);
    meter.close(b);
    expect(meter.settledUntil(450)).toBe(450);
  });

  it("rejects records for a transfer that isn't open", () => {
    const meter = new ThroughputMeter(0);
    const id = meter.open(0);
    meter.close(id);
    expect(() => {
      meter.record(id, 10, 1);
    }).toThrow();
  });
});

describe("findWarmupEnd", () => {
  it("is unknown before any data", () => {
    expect(findWarmupEnd([])).toBeNull();
    expect(findWarmupEnd([0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it("ends 1 s (4 ticks) after the first byte while throughput keeps growing", () => {
    expect(findWarmupEnd([0, 1, 2, 4, 8, 16])).toBe(5);
  });

  it("ends early once two consecutive ticks grow less than 10%", () => {
    expect(findWarmupEnd([5, 10, 10.5, 10.6, 10.7])).toBe(2);
  });

  it("never ends within the first 2 ticks of data", () => {
    expect(findWarmupEnd([10, 10.1, 10.2, 10.3])).toBe(2);
  });

  it("waits while it can't tell yet", () => {
    expect(findWarmupEnd([0, 5, 10])).toBeNull();
  });
});

describe("eligibleSamples and windowEstimate", () => {
  it("skips warm-up, discarded ticks and ticks before `from`", () => {
    const view = { samples: [1, 2, 3, 4, 5, 6], warmupEnd: 1, discarded: new Set([3]) };
    expect(eligibleSamples(view)).toEqual([2, 3, 5, 6]);
    expect(eligibleSamples(view, 4)).toEqual([5, 6]);
    expect(eligibleSamples({ ...view, warmupEnd: null })).toEqual([]);
  });

  it("takes the interquartile mean of the latest 8 samples", () => {
    expect(windowEstimate([999, 10, 10, 10, 10, 10, 10, 10, 1000])).toBe(10);
  });
});

describe("finalEstimate", () => {
  const none = new Set<number>();

  it("uses the latest window of post-warm-up samples, not the slow start", () => {
    const samples = [1, 2, 4, 10, 10, 11, 9, 10, 10, 10, 50, 10];
    expect(finalEstimate({ samples, warmupEnd: 3, discarded: none })).toBe(10);
  });

  it("falls back to the last 4 samples with fewer than 4 after warm-up", () => {
    expect(finalEstimate({ samples: [1, 2, 3, 4, 5], warmupEnd: 3, discarded: none })).toBe(3.5);
    expect(finalEstimate({ samples: [1, 2, 3, 4, 5], warmupEnd: null, discarded: none })).toBe(3.5);
  });

  it("uses every sample when there are fewer than 4", () => {
    expect(finalEstimate({ samples: [6, 8], warmupEnd: null, discarded: none })).toBe(7);
  });

  it("is null without samples", () => {
    expect(finalEstimate({ samples: [], warmupEnd: null, discarded: none })).toBeNull();
  });
});

describe("isStable", () => {
  it("needs 4 estimates", () => {
    expect(isStable([100, 100, 100], 0.05)).toBe(false);
  });

  it("accepts a total spread within the tolerance", () => {
    expect(isStable([100, 102, 101, 104], 0.05)).toBe(true);
  });

  it("rejects a steady climb that stays within ± the tolerance of its mean", () => {
    // Every value is within 3% of the mean (103), but the total spread is 6 > 5% of 103.
    expect(isStable([100, 102, 104, 106], 0.05)).toBe(false);
  });

  it("looks only at the last 4 estimates", () => {
    expect(isStable([10, 50, 100, 101, 100, 102], 0.05)).toBe(true);
  });

  it("is never stable at zero", () => {
    expect(isStable([0, 0, 0, 0], 0.05)).toBe(false);
  });
});
