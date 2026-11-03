import { describe, expect, it } from "vitest";
import { GENUINE_RESULT } from "./fixtures";
import { impossibility, implausible } from "./plausibility";
import type { TokenClaims } from "./token";

const ISSUED = Date.UTC(2026, 10, 2, 12);
const claims: TokenClaims = { jti: "a".repeat(22), iat: ISSUED, low: true, ev: "0.3.0" };
const SUBMITTED = ISSUED + 20_000;

const KNOWN = new Set(["cloudflare"]);
const check = (overrides: Partial<typeof GENUINE_RESULT>, at = SUBMITTED) =>
  impossibility({ ...GENUINE_RESULT, ...overrides }, claims, at, KNOWN);

describe("impossibility", () => {
  it("passes a genuine result", () => {
    expect(check({})).toBeNull();
  });

  it("accepts only the deployment's configured servers", () => {
    const ours = new Set(["lagos-1"]);
    const result = { ...GENUINE_RESULT, serverId: "lagos-1" };
    expect(impossibility(result, claims, SUBMITTED, ours)).toBeNull();
    expect(impossibility(result, claims, SUBMITTED, KNOWN)).toBe("unknown-server");
    // With the Cloudflare fallback off, a result claiming Cloudflare is refused.
    expect(impossibility(GENUINE_RESULT, claims, SUBMITTED, ours)).toBe("unknown-server");
  });

  it("refuses a result that contradicts its token", () => {
    expect(check({ lowDataMode: false })).toBe("profile-mismatch");
    expect(check({ engineVersion: "0.2.0" })).toBe("engine-mismatch");
    // The run can't have lasted longer than the token has existed (1 s slack).
    expect(check({}, ISSUED + GENUINE_RESULT.durationMs - 1_001)).toBe("longer-than-token");
    expect(check({}, ISSUED + GENUINE_RESULT.durationMs - 1_000)).toBeNull();
  });

  it("refuses what the engine's caps make impossible", () => {
    expect(check({ serverId: "elsewhere" })).toBe("unknown-server");
    expect(check({ bytesUsed: 10_000_001 })).toBe("over-data-cap");
    expect(check({ bytesUsed: 10_000_000 })).toBeNull();
    expect(check({ durationMs: 16_001 })).toBe("over-time-limit");
  });

  it("refuses impossible latencies and speeds", () => {
    const latency = GENUINE_RESULT.latency;
    expect(check({ latency: { ...latency, idleP95Ms: 49 } })).toBe("latency-out-of-range");
    expect(check({ latency: { ...latency, jitterMs: 60_001 } })).toBe("latency-out-of-range");
    expect(check({ downloadMbps: 10_001 })).toBe("speed-out-of-range");
  });

  it("re-grades bufferbloat with the engine's own rule", () => {
    const loaded = GENUINE_RESULT.loadedLatency;
    expect(check({ loadedLatency: { ...loaded, grade: "B" } })).toBe("grade-mismatch");
    // 50 ms idle, 480 ms loaded: 430 ms added, grade F.
    expect(check({ loadedLatency: { ...loaded, downloadMs: 480, grade: "F" } })).toBeNull();
    // Loaded faster than idle adds nothing: grade A.
    expect(check({ loadedLatency: { downloadMs: 10, uploadMs: 10, grade: "A" } })).toBeNull();
  });
});

describe("implausible", () => {
  it("flags only results outside the simulated envelope", () => {
    expect(implausible(GENUINE_RESULT)).toBeNull();
    expect(implausible({ ...GENUINE_RESULT, durationMs: 200 })).toBe("implausible");
    expect(implausible({ ...GENUINE_RESULT, bytesUsed: 100_000 })).toBe("implausible");
  });
});
