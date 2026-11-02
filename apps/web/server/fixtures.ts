import type { SpeedTestResult } from "@kilomita/shared";

/** A genuine low-data result (the engine's own output on a simulated 20/5 Mbps 4G link). */
export const GENUINE_RESULT: SpeedTestResult = {
  downloadMbps: 19.88,
  uploadMbps: 4.95,
  latency: { idleMedianMs: 50, idleP95Ms: 62, jitterMs: 4, requestLossPct: 0 },
  loadedLatency: { downloadMs: 70, uploadMs: 64, grade: "A" },
  bytesUsed: 9_015_511,
  durationMs: 7_796,
  lowDataMode: true,
  engineVersion: "0.3.0",
  serverId: "cloudflare",
  measuredAt: "2026-11-02T12:00:00.000Z",
  ispSlug: "mtn",
  stateSlug: "lagos",
  networkType: "4g",
  deviceClass: "mobile",
};
