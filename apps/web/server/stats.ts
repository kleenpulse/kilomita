import { SHARING, type StatsCell } from "@kilomita/shared";
import { ISPS, NETWORK_TYPES, NIGERIAN_STATES } from "@kilomita/shared/lists";
import { type SQLWrapper, and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/database";
import { results } from "./db/schema";

/*
 * Medians, never means: a few very fast lines would drag a mean far above what most people get.
 * Over the last 30 days of server time, without flagged rows, and only for groups of at least
 * SHARING.minGroupSize results: a smaller group is reported with no numbers and no count.
 */

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// Nigeria is on WAT (UTC+1) all year, with no daylight saving.
const LAGOS = sql`${results.createdAt} at time zone 'Africa/Lagos'`;

export const DIMENSIONS = {
  isp: sql<string>`${results.ispSlug}`,
  state: sql<string>`${results.stateSlug}`,
  "network-type": sql<string>`${results.networkType}`,
  hour: sql<string>`extract(hour from ${LAGOS})::int::text`,
  /** Daily, for the 30-day trend. */
  trend: sql<string>`to_char(${LAGOS}, 'YYYY-MM-DD')`,
} as const;
export type Dimension = keyof typeof DIMENSIONS;

export interface StatsFilter {
  isp?: string;
  state?: string;
  type?: string;
}

const FILTER_VALUES: Record<keyof StatsFilter, ReadonlySet<string>> = {
  isp: new Set(ISPS.map((isp) => isp.slug)),
  state: new Set(NIGERIAN_STATES.map((state) => state.slug)),
  type: new Set(NETWORK_TYPES),
};

/** The filter from a query string, or null if it holds anything unknown (answered with 400). */
export function parseFilter(params: URLSearchParams): StatsFilter | null {
  const filter: StatsFilter = {};
  for (const [name, value] of params) {
    if (!(name in FILTER_VALUES) || name in filter) return null;
    const key = name as keyof StatsFilter;
    if (!FILTER_VALUES[key].has(value)) return null;
    filter[key] = value;
  }
  return filter;
}

const median = (column: SQLWrapper) =>
  sql<number>`percentile_cont(0.5) within group (order by ${column})`.mapWith(Number);

export async function groupStats(
  db: Db,
  dimension: Dimension,
  filter: StatsFilter,
  now: number,
): Promise<StatsCell[]> {
  const key = DIMENSIONS[dimension];
  const conditions = [
    gte(results.createdAt, new Date(now - WINDOW_MS)),
    isNull(results.flag),
    filter.isp === undefined ? undefined : eq(results.ispSlug, filter.isp),
    filter.state === undefined ? undefined : eq(results.stateSlug, filter.state),
    filter.type === undefined ? undefined : eq(results.networkType, filter.type),
    dimension === "state" ? isNotNull(results.stateSlug) : undefined,
  ];
  const rows = await db
    .select({
      key,
      count: sql<number>`count(*)`.mapWith(Number),
      downloadMbps: median(results.downloadMbps),
      uploadMbps: median(results.uploadMbps),
      latencyMs: median(results.idleMedianMs),
    })
    .from(results)
    .where(and(...conditions))
    .groupBy(key)
    .orderBy(key);
  return rows.map(({ key: name, count, downloadMbps, uploadMbps, latencyMs }) =>
    count < SHARING.minGroupSize
      ? { key: name, enough: false }
      : { key: name, enough: true, downloadMbps, uploadMbps, latencyMs },
  );
}
