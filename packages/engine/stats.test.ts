import { beforeEach, describe, expect, it } from "vitest";
import { interquartileMean, jitter, mean, median, percentile } from "./stats";
import { blockRealNetwork } from "./simulated-network";

beforeEach(() => {
  blockRealNetwork();
});

describe("percentile", () => {
  it("interpolates linearly between the closest ranks", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("ignores input order", () => {
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 1)).toBe(3);
  });

  it("returns the only value of a single sample", () => {
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("throws on an empty list", () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
  });
});

describe("median", () => {
  it("takes the middle value or the mean of the middle two", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("mean", () => {
  it("averages and rejects an empty list", () => {
    expect(mean([1, 2, 6])).toBe(3);
    expect(() => mean([])).toThrow(RangeError);
  });
});

describe("interquartileMean", () => {
  it("trims a quarter from each end", () => {
    expect(interquartileMean([8, 1, 7, 2, 6, 3, 5, 4])).toBe(4.5);
  });

  it("ignores outliers at both ends", () => {
    expect(interquartileMean([0, 10, 10, 10, 10, 10, 10, 1000])).toBe(10);
  });

  it("trims nothing below 4 values", () => {
    expect(interquartileMean([6, 8])).toBe(7);
    expect(interquartileMean([1, 2, 3])).toBe(2);
  });

  it("trims one value from each end of 5", () => {
    expect(interquartileMean([1, 2, 3, 4, 100])).toBe(3);
  });
});

describe("jitter", () => {
  it("is the mean absolute difference between consecutive samples", () => {
    expect(jitter([100, 130, 90])).toBe(35);
    expect(jitter([10, 20, 10])).toBe(10);
  });

  it("is 0 with fewer than two samples", () => {
    expect(jitter([])).toBe(0);
    expect(jitter([42])).toBe(0);
  });
});
