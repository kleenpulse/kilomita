import { describe, expect, it } from "vitest";
import {
  bandLabel,
  blockLabel,
  dayLabel,
  formatMbps,
  formatRange,
  hourLabel,
  isFewResults,
  ispName,
  stateName,
  typeLabel,
} from "./insights-format";

describe("insights formatting", () => {
  it("prints the server's rounded values as they are", () => {
    expect(formatMbps(0.046)).toBe("0.046 Mbps");
    expect(formatMbps(1200)).toBe("1,200 Mbps");
    expect(formatRange([10, 21])).toBe("10–21");
  });

  it("labels count bands, and flags the small ones", () => {
    expect(bandLabel("30-49")).toBe("30–49 results");
    expect(bandLabel("1000+")).toBe("1,000+ results");
    expect([isFewResults("30-49"), isFewResults("50-99"), isFewResults("100-249")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("names ISPs, states and network types", () => {
    expect([ispName("fiberone"), stateName("fct"), typeLabel("fixed-wireless")]).toEqual([
      "FiberOne",
      "Federal Capital Territory",
      "Fixed wireless",
    ]);
  });

  it("labels days and hours", () => {
    expect(dayLabel("2026-11-03")).toBe("3 Nov");
    expect(hourLabel("7")).toBe("07:00");
    expect([blockLabel("0"), blockLabel("21")]).toEqual(["00:00–03:00", "21:00–00:00"]);
  });
});
