import { type SQL, sql } from "drizzle-orm";

/*
 * A distribution-free 95% interval for a median: the r-th and s-th smallest of n results. The
 * number of results below the true median is Binomial(n, ½), so with its normal approximation
 * r = n/2 − 1.96·√n/2 and s = 1 + n/2 + 1.96·√n/2, rounded half up and kept within 1..n. A test
 * checks the exact binomial coverage of these ranks is at least 95% for every n from 30 to 10,000.
 *
 * The ranks are written twice, here for tests and in SQL for the query, and a test pins them
 * equal for every n: the same IEEE operations in the same order, and floor(x + 0.5) on both sides
 * (Postgres' round() on a double rounds half to even, Math.round half up).
 */

const clamp = (rank: number, n: number) => Math.min(n, Math.max(1, rank));

export function medianRanks(n: number): [low: number, high: number] {
  const spread = (1.96 * Math.sqrt(n)) / 2;
  return [
    clamp(Math.floor(n / 2 - spread + 0.5), n),
    clamp(Math.floor(1 + n / 2 + spread + 0.5), n),
  ];
}

/** The same ranks in SQL, for a group of `n` rows (a float8 expression such as count(*)::float8). */
export function sqlMedianRanks(n: SQL): [low: SQL, high: SQL] {
  const spread = sql`(1.96::float8 * sqrt(${n})) / 2::float8`;
  const ranked = (rank: SQL) => sql`greatest(1, least(${n}, floor(${rank})))::int`;
  return [
    ranked(sql`${n} / 2::float8 - ${spread} + 0.5::float8`),
    ranked(sql`1::float8 + ${n} / 2::float8 + ${spread} + 0.5::float8`),
  ];
}
