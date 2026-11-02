import { describe, expect, it } from "vitest";
import { NETWORK_TYPES } from "./network-types";
import {
  CorrectResultSchema,
  DeleteResultsSchema,
  IspSchema,
  NetworkTypeSchema,
  NigerianStateSchema,
  ResultSecretSchema,
  SpeedTestResultSchema,
  type SpeedTestResult,
  SubmitResultSchema,
} from "./schemas";
import { SHARING } from "./sharing";

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

describe("NetworkTypeSchema", () => {
  it("accepts exactly the zod-free NETWORK_TYPES list", () => {
    expect(NetworkTypeSchema.options).toEqual([...NETWORK_TYPES]);
    expect(NetworkTypeSchema.options).toHaveLength(8);
  });
});

const SECRET = "a".repeat(43);

describe("ResultSecretSchema", () => {
  it("takes exactly 43 base64url characters (32 bytes, no padding)", () => {
    expect(ResultSecretSchema.safeParse("Az09_-".padEnd(43, "x")).success).toBe(true);
    expect(ResultSecretSchema.safeParse("a".repeat(42)).success).toBe(false);
    expect(ResultSecretSchema.safeParse("a".repeat(44)).success).toBe(false);
    expect(ResultSecretSchema.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
    expect(ResultSecretSchema.safeParse(`${"a".repeat(42)}+`).success).toBe(false);
  });
});

describe("SubmitResultSchema", () => {
  it("accepts a token, a secret and a result, and nothing else", () => {
    const body = { token: "v1.x.y", secret: SECRET, result: validResult };
    expect(SubmitResultSchema.safeParse(body).success).toBe(true);
    expect(SubmitResultSchema.safeParse({ ...body, ip: "1.2.3.4" }).success).toBe(false);
    expect(SubmitResultSchema.safeParse({ ...body, token: "" }).success).toBe(false);
  });
});

describe("CorrectResultSchema", () => {
  it("needs something to correct, and lets the state be cleared", () => {
    expect(CorrectResultSchema.safeParse({ secret: SECRET }).success).toBe(false);
    expect(CorrectResultSchema.safeParse({ secret: SECRET, stateSlug: null }).success).toBe(true);
    expect(CorrectResultSchema.safeParse({ secret: SECRET, ispSlug: "glo" }).success).toBe(true);
    expect(CorrectResultSchema.safeParse({ secret: SECRET, ispSlug: "nope" }).success).toBe(false);
    expect(
      CorrectResultSchema.safeParse({ secret: SECRET, networkType: "4g", downloadMbps: 1 }).success,
    ).toBe(false);
  });
});

describe("DeleteResultsSchema", () => {
  it("takes one to a batch of secrets", () => {
    const secrets = (n: number) => Array.from({ length: n }, () => SECRET);
    expect(DeleteResultsSchema.safeParse({ secrets: secrets(0) }).success).toBe(false);
    expect(DeleteResultsSchema.safeParse({ secrets: secrets(1) }).success).toBe(true);
    expect(DeleteResultsSchema.safeParse({ secrets: secrets(SHARING.deleteBatch) }).success).toBe(
      true,
    );
    expect(
      DeleteResultsSchema.safeParse({ secrets: secrets(SHARING.deleteBatch + 1) }).success,
    ).toBe(false);
  });
});
