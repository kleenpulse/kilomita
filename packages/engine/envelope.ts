import type { SpeedTestResult } from "@kilomita/shared";

/**
 * The envelope of results the engine genuinely produces. A result outside it isn't impossible,
 * just unlike any simulated run, so the server stores it flagged and leaves it out of aggregates.
 *
 * Derived in envelope.test.ts from the engine on simulated links from 2G to 1 Gbps, both
 * profiles: the shortest run took 522 ms, and the least data per Mbps measured was 0.25 s worth,
 * both at 1 Gbps in low-data mode. The floors are half of those.
 */
export const PLAUSIBILITY = Object.freeze({
  minDurationMs: 250,
  /** bytesUsed must carry at least this many seconds of the claimed download plus upload rate. */
  minDataSeconds: 0.125,
});

export type EnvelopeMiss = "too-short" | "too-little-data";

type Measured = Pick<SpeedTestResult, "durationMs" | "bytesUsed" | "downloadMbps" | "uploadMbps">;

export function outsideEnvelope(result: Measured): EnvelopeMiss | null {
  if (result.durationMs < PLAUSIBILITY.minDurationMs) return "too-short";
  const claimedBytesPerSecond = ((result.downloadMbps + result.uploadMbps) * 1e6) / 8;
  if (result.bytesUsed < claimedBytesPerSecond * PLAUSIBILITY.minDataSeconds) {
    return "too-little-data";
  }
  return null;
}
