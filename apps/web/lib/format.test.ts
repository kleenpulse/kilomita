import { describe, expect, it } from "vitest";
import { formatMbps, formatMegabytes, formatMs, formatSeconds } from "./format";

describe("formatMbps", () => {
  it.each([
    [0, "0.00"],
    [0.854, "0.85"],
    [0.994, "0.99"],
    [0.996, "1.0"],
    [8.44, "8.4"],
    [9.94, "9.9"],
    [9.96, "10"],
    [23.4, "23"],
    [245.6, "246"],
  ])("%s → %s", (mbps, text) => {
    expect(formatMbps(mbps)).toBe(text);
  });
});

describe("formatMegabytes", () => {
  it("uses decimal megabytes with one decimal", () => {
    expect(formatMegabytes(9_412_345)).toBe("9.4 MB");
    expect(formatMegabytes(50_000_000)).toBe("50.0 MB");
  });

  it("shows zero as zero and a few bytes as under 0.1 MB", () => {
    expect(formatMegabytes(0)).toBe("0.0 MB");
    expect(formatMegabytes(12_000)).toBe("<0.1 MB");
    expect(formatMegabytes(100_000)).toBe("0.1 MB");
  });
});

describe("formatMs and formatSeconds", () => {
  it("rounds", () => {
    expect(formatMs(52.6)).toBe("53 ms");
    expect(formatSeconds(30_000)).toBe("30 s");
    expect(formatSeconds(14_600)).toBe("15 s");
  });
});
