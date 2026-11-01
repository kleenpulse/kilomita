import { beforeEach, describe, expect, it } from "vitest";
import { TEST_LIMITS } from "./limits";
import { LOW_DATA_PROFILE, STANDARD_PROFILE } from "./profiles";
import { blockRealNetwork } from "./simulated-network";

beforeEach(() => {
  blockRealNetwork();
});

describe("TEST_LIMITS", () => {
  it("matches the profiles the engine runs with", () => {
    expect(TEST_LIMITS.standard).toEqual({
      maxBytes: STANDARD_PROFILE.maxBytes,
      maxDurationMs: STANDARD_PROFILE.maxDurationMs,
    });
    expect(TEST_LIMITS.lowData).toEqual({
      maxBytes: LOW_DATA_PROFILE.maxBytes,
      maxDurationMs: LOW_DATA_PROFILE.maxDurationMs,
    });
  });

  it("can't be changed by a caller", () => {
    expect(Object.isFrozen(TEST_LIMITS)).toBe(true);
    expect(Object.isFrozen(TEST_LIMITS.standard)).toBe(true);
    expect(Object.isFrozen(TEST_LIMITS.lowData)).toBe(true);
  });
});
