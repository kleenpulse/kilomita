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
