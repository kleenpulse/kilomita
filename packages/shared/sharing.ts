// Limits of the sharing flow that both the browser and the server must agree on. Zod-free: it is
// part of `@kilomita/shared/lists`.

const MINUTE = 60_000;

export const SHARING = Object.freeze({
  /** A test token stays valid this long after it is issued. */
  tokenTtlMs: 30 * MINUTE,
  /** A shared result's network details can be corrected for this long. */
  correctionWindowMs: 30 * MINUTE,
  /** Secrets per DELETE request; the browser sends larger lists in batches. */
  deleteBatch: 100,
  /** Shared results are deleted after this long, and the browser forgets them too. */
  retentionMs: 365 * 24 * 60 * MINUTE,
  /** No median is published for a group with fewer results than this. */
  minGroupSize: 30,
});

/** The windows the published stats cover, in days. Rolling: the last N × 24 hours. */
export const STATS_WINDOWS = [7, 30, 90] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];
export const DEFAULT_STATS_WINDOW: StatsWindow = 30;

/**
 * A published group's size, as a band: an exact count would let anyone who compares two
 * overlapping groups see how many results separate them. `few` bands are labelled "read with care".
 */
export const COUNT_BANDS = [
  { band: "30-49", min: 30, few: true },
  { band: "50-99", min: 50, few: true },
  { band: "100-249", min: 100, few: false },
  { band: "250-499", min: 250, few: false },
  { band: "500-999", min: 500, few: false },
  { band: "1000+", min: 1000, few: false },
] as const;
export type CountBand = (typeof COUNT_BANDS)[number]["band"];
