import { describe, expect, it } from "vitest";
import { ISPS } from "./isps";
import { GEOPOLITICAL_ZONES, NIGERIAN_STATES } from "./states";

describe("NIGERIAN_STATES", () => {
  it("lists the 36 states plus the FCT", () => {
    expect(NIGERIAN_STATES).toHaveLength(37);
    expect(NIGERIAN_STATES.some((state) => state.slug === "fct")).toBe(true);
  });

  it("has unique slugs and names", () => {
    expect(new Set(NIGERIAN_STATES.map((state) => state.slug)).size).toBe(37);
    expect(new Set(NIGERIAN_STATES.map((state) => state.name)).size).toBe(37);
  });

  it("covers all six geopolitical zones", () => {
    const zones = new Set(NIGERIAN_STATES.map((state) => state.zone));
    expect([...zones].sort()).toEqual([...GEOPOLITICAL_ZONES].sort());
  });
});

describe("ISPS", () => {
  it("has unique slugs and includes an Other fallback", () => {
    expect(new Set(ISPS.map((isp) => isp.slug)).size).toBe(ISPS.length);
    expect(ISPS.some((isp) => isp.slug === "other")).toBe(true);
  });
});
