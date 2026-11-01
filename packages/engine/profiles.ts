export type Direction = "download" | "upload";
export type Phase = "latency" | Direction;

const MB = 1_000_000;
const KB = 1_000;

export interface Profile {
  /** Hard data cap per test. Sizes are decimal (1 MB = 1,000,000 bytes). */
  maxBytes: number;
  /** Hard deadline for the whole test. */
  maxDurationMs: number;
  /** Idle latency probes after the warm-up probe. */
  idleProbes: number;
  /** Per-phase time limits. The latency limit starts after the warm-up probe. */
  phaseLimitMs: Record<Phase, number>;
  maxStreams: Record<Direction, number>;
  minRequestBytes: Record<Direction, number>;
  maxRequestBytes: Record<Direction, number>;
  /** How long one request should take at the current per-stream rate. */
  requestTargetMs: Record<Direction, number>;
  /** Allowed spread of the last window estimates, as a fraction of their mean. */
  stabilityTolerance: number;
  probeTimeoutMs: number;
  stallTimeoutMs: number;
}

/**
 * Up to 5 streams: browsers allow 6 HTTP/1.1 connections per host, and one must stay free for the
 * loaded-latency probe if a proxy or server falls back from HTTP/2.
 */
export const STANDARD_PROFILE: Profile = {
  maxBytes: 50 * MB,
  maxDurationMs: 30_000,
  idleProbes: 20,
  phaseLimitMs: { latency: 5_000, download: 12_000, upload: 10_000 },
  maxStreams: { download: 5, upload: 5 },
  minRequestBytes: { download: 64 * KB, upload: 32 * KB },
  maxRequestBytes: { download: 25 * MB, upload: 8 * MB },
  requestTargetMs: { download: 1_000, upload: 500 },
  stabilityTolerance: 0.05,
  probeTimeoutMs: 3_000,
  stallTimeoutMs: 6_000,
};

export const LOW_DATA_PROFILE: Profile = {
  ...STANDARD_PROFILE,
  maxBytes: 10 * MB,
  maxDurationMs: 15_000,
  idleProbes: 10,
  phaseLimitMs: { latency: 3_000, download: 5_000, upload: 5_000 },
  maxStreams: { download: 3, upload: 2 },
  maxRequestBytes: { download: 4 * MB, upload: 2 * MB },
  stabilityTolerance: 0.08,
};

/** Payload is reserved against this share of the cap, leaving room for protocol overhead. */
export const PAYLOAD_SHARE = 0.95;
/** Download may reserve this share of the payload budget; upload gets the rest. */
export const DOWNLOAD_SHARE = 2 / 3;
