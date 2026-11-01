import { describe, expect, it } from "vitest";
import {
  IspSchema,
  NigerianStateSchema,
  SpeedTestResultSchema,
  type SpeedTestResult,
} from "./schemas";

const validResult: SpeedTestResult = {
  downloadMbps: 42.5,
  uploadMbps: 11.2,
  latency: { idleMedianMs: 38, idleP95Ms: 61, jitterMs: 4.2, requestLossPct: 0 },
  loadedLatency: { downloadMs: 120, uploadMs: 95, grade: "B" },
  bytesUsed: 48_000_000,
  durationMs: 9_800,
  lowDataMode: false,
  engineVersion: "0.1.0",
  serverId: "cloudflare",
  measuredAt: "2026-11-01T12:00:00Z",
  ispSlug: "mtn",
  stateSlug: "lagos",
  lgaSlug: "ikeja",
  networkType: "4g",
  deviceClass: "mobile",
};

function withOverrides(overrides: Record<string, unknown>) {
  return { ...validResult, ...overrides };
}

describe("SpeedTestResultSchema", () => {
  it("accepts a valid result", () => {
    expect(SpeedTestResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("accepts a result without optional location fields", () => {
    const { stateSlug: _state, lgaSlug: _lga, ...rest } = validResult;
    expect(SpeedTestResultSchema.safeParse(rest).success).toBe(true);
  });

  it.each([
    ["negative download", withOverrides({ downloadMbps: -1 })],
    ["NaN upload", withOverrides({ uploadMbps: Number.NaN })],
    ["infinite download", withOverrides({ downloadMbps: Number.POSITIVE_INFINITY })],
    ["fractional bytes", withOverrides({ bytesUsed: 1.5 })],
    ["unknown state", withOverrides({ stateSlug: "atlantis" })],
    ["unknown ISP", withOverrides({ ispSlug: "not-an-isp" })],
    ["bad engine version", withOverrides({ engineVersion: "v1" })],
    ["non-ISO timestamp", withOverrides({ measuredAt: "yesterday" })],
    ["malformed LGA slug", withOverrides({ lgaSlug: "Ikeja LGA" })],
    [
      "request loss above 100%",
      withOverrides({ latency: { ...validResult.latency, requestLossPct: 101 } }),
    ],
    [
      "unknown bufferbloat grade",
      withOverrides({ loadedLatency: { ...validResult.loadedLatency, grade: "E" } }),
    ],
  ])("rejects %s", (_label, input) => {
    expect(SpeedTestResultSchema.safeParse(input).success).toBe(false);
  });

  it("has no field that could hold a raw IP address", () => {
    const keys = Object.keys(SpeedTestResultSchema.shape);
    expect(keys.some((key) => key.toLowerCase().includes("ip") && key !== "ispSlug")).toBe(false);
  });
});

describe("NigerianStateSchema", () => {
  it("accepts FCT and rejects free text", () => {
    expect(NigerianStateSchema.safeParse("fct").success).toBe(true);
    expect(NigerianStateSchema.safeParse("Lagos").success).toBe(false);
  });
});

describe("IspSchema", () => {
  it("requires a known slug and a name", () => {
    expect(IspSchema.safeParse({ slug: "glo", name: "Glo" }).success).toBe(true);
    expect(IspSchema.safeParse({ slug: "glo", name: "" }).success).toBe(false);
  });
});
