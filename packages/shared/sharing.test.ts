import { describe, expect, it } from "vitest";
import { COUNT_BANDS, DEFAULT_STATS_WINDOW, SHARING, STATS_WINDOWS } from "./sharing";

describe("published stats constants", () => {
  it("start the first count band exactly at the minimum group size, bands ascending", () => {
    expect(COUNT_BANDS[0].min).toBe(SHARING.minGroupSize);
    const mins = COUNT_BANDS.map((band) => band.min);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
    // Each band's name is its own range: the next band starts one above its upper end.
    COUNT_BANDS.forEach((band, i) => {
      const next = COUNT_BANDS[i + 1];
      expect(band.band).toBe(
        next ? `${String(band.min)}-${String(next.min - 1)}` : `${String(band.min)}+`,
      );
    });
  });

  it("offer 7, 30 and 90 days, 30 by default, all inside the 12-month retention", () => {
    expect(STATS_WINDOWS).toEqual([7, 30, 90]);
    expect(DEFAULT_STATS_WINDOW).toBe(30);
    expect(Math.max(...STATS_WINDOWS) * 24 * 60 * 60 * 1000).toBeLessThan(SHARING.retentionMs);
  });
});
