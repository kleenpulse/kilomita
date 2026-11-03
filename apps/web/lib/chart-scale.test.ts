import { describe, expect, it } from "vitest";
import { niceScale, scaleY } from "./chart-scale";

describe("niceScale", () => {
  it("rounds the top up to a tidy step", () => {
    // 21 / 4 ticks = 5.25 a step, so the step is 10.
    expect(niceScale(21)).toEqual({ top: 30, ticks: [0, 10, 20, 30] });
    expect(niceScale(18)).toEqual({ top: 20, ticks: [0, 5, 10, 15, 20] });
    expect(niceScale(60)).toEqual({ top: 60, ticks: [0, 20, 40, 60] });
    expect(niceScale(0.046)).toEqual({ top: 0.06, ticks: [0, 0.02, 0.04, 0.06] });
  });

  it("never covers less than the largest value", () => {
    for (const max of [0.3, 1, 7, 13, 99, 120, 333, 999]) {
      const { top, ticks } = niceScale(max);
      expect(top, String(max)).toBeGreaterThanOrEqual(max);
      expect(ticks.at(-1)).toBe(top);
      expect(ticks[0]).toBe(0);
    }
  });

  it("falls back for nothing to show", () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(niceScale(Number.NaN)).toEqual({ top: 1, ticks: [0, 1] });
  });
});

describe("scaleY", () => {
  it("maps 0 to the bottom and the top to the top, clamping outside values", () => {
    expect(scaleY(0, 10, 100, 0)).toBe(100);
    expect(scaleY(10, 10, 100, 0)).toBe(0);
    expect(scaleY(5, 10, 100, 0)).toBe(50);
    expect(scaleY(20, 10, 100, 0)).toBe(0);
  });
});
