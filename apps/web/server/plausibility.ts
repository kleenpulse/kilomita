import { TEST_LIMITS, gradeBufferbloat, outsideEnvelope } from "@kilomita/engine/limits";
import type { SpeedTestResult } from "@kilomita/shared";
import type { TokenClaims } from "./token";

/*
 * Two tiers. An impossible result (it contradicts its own token, the engine's caps or its own
 * numbers) is refused. A merely unusual one, outside what the engine produced on any simulated
 * link, is stored with a flag and left out of aggregates: a simulator isn't the real world, and
 * refusing real 2G results would bias the numbers upwards.
 */

/** Slack for timers and the server's own handling. */
const SLACK_MS = 1_000;
const MAX_LATENCY_MS = 60_000;
const MAX_MBPS = 10_000;

export type Impossible =
  | "profile-mismatch"
  | "engine-mismatch"
  | "unknown-server"
  | "over-data-cap"
  | "over-time-limit"
  | "longer-than-token"
  | "latency-out-of-range"
  | "speed-out-of-range"
  | "grade-mismatch";

/** `knownServers`: the deployment's configured test servers (lib/test-servers.ts). */
export function impossibility(
  result: SpeedTestResult,
  claims: TokenClaims,
  now: number,
  knownServers: ReadonlySet<string>,
): Impossible | null {
  if (result.lowDataMode !== claims.low) return "profile-mismatch";
  // The token carries the server's engine version when it was issued, so a run that straddles a
  // deploy still matches. A tab loaded before an engine bump gets the new version on its next token
  // and is refused until it reloads: a stale engine's numbers aren't comparable.
  if (result.engineVersion !== claims.ev) return "engine-mismatch";
  if (!knownServers.has(result.serverId)) return "unknown-server";
  const limits = result.lowDataMode ? TEST_LIMITS.lowData : TEST_LIMITS.standard;
  if (result.bytesUsed > limits.maxBytes) return "over-data-cap";
  if (result.durationMs > limits.maxDurationMs + SLACK_MS) return "over-time-limit";
  // The run started after the token was issued.
  if (now - claims.iat < result.durationMs - SLACK_MS) return "longer-than-token";

  const { idleMedianMs, idleP95Ms, jitterMs } = result.latency;
  const { downloadMs, uploadMs, grade } = result.loadedLatency;
  const latencies = [idleMedianMs, idleP95Ms, jitterMs, downloadMs, uploadMs];
  if (idleP95Ms < idleMedianMs || latencies.some((ms) => ms > MAX_LATENCY_MS)) {
    return "latency-out-of-range";
  }
  if (result.downloadMbps > MAX_MBPS || result.uploadMbps > MAX_MBPS) return "speed-out-of-range";
  // The engine's own rule, on the result's own numbers.
  const addedMs = Math.max(0, Math.max(downloadMs, uploadMs) - idleMedianMs);
  if (gradeBufferbloat(addedMs) !== grade) return "grade-mismatch";
  return null;
}

/** "implausible" when the result is outside the engine's simulated envelope, else null. */
export function implausible(result: SpeedTestResult): "implausible" | null {
  return outsideEnvelope(result) === null ? null : "implausible";
}
