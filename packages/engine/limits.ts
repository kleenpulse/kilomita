// Kept apart from the engine's index so a page can show the caps without bundling the engine.
import { LOW_DATA_PROFILE, type Profile, STANDARD_PROFILE } from "./profiles";

export interface TestLimits {
  /** Hard data cap per test, in decimal bytes. */
  readonly maxBytes: number;
  readonly maxDurationMs: number;
}

function limitsOf(profile: Profile): TestLimits {
  return Object.freeze({ maxBytes: profile.maxBytes, maxDurationMs: profile.maxDurationMs });
}

export const TEST_LIMITS: Readonly<Record<"standard" | "lowData", TestLimits>> = Object.freeze({
  standard: limitsOf(STANDARD_PROFILE),
  lowData: limitsOf(LOW_DATA_PROFILE),
});
