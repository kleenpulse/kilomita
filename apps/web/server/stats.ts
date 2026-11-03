import { type CountBand, SHARING, type StatsCell, type StatsWindow } from "@kilomita/shared";
import {
  COUNT_BANDS,
  DEFAULT_STATS_WINDOW,
  ISPS,
  NETWORK_TYPES,
  NIGERIAN_STATES,
  STATS_WINDOWS,
} from "@kilomita/shared/lists";
import { type SQL, type SQLWrapper, and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/database";
import { results } from "./db/schema";
import { sqlMedianRanks } from "./median-interval";

/*
 * Medians, never means: a few very fast lines would drag a mean far above what most people get.
 * Over a rolling window of server time, without flagged rows. This file is the only place that
 * decides what is published:
 * - a group of fewer than SHARING.minGroupSize results gets no numbers and no count, and looks the
 *   same as a group with none (every known key is listed);
 * - a larger one gets its size as a band, its medians and a 95% interval for each, all rounded
 *   (Mbps to 2 significant figures, ms to whole ms). The exact size never leaves this file: with
 *   it, two overlapping groups would show how many results separate them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
// Nigeria is on WAT (UTC+1) all year, with no daylight saving.
const LAGOS = sql`${results.createdAt} at time zone 'Africa/Lagos'`;

export const DIMENSIONS = {
  isp: sql<string>`${results.ispSlug}`,
  state: sql<string>`${results.stateSlug}`,
  "network-type": sql<string>`${results.networkType}`,
  hour: sql<string>`extract(hour from ${LAGOS})::int::text`,
  /** 3-hour blocks keyed by their first hour ("0", "3", … "21"): each needs 30 results, not 24. */
  daypart: sql<string>`((extract(hour from ${LAGOS})::int / 3) * 3)::text`,
  /** Daily, for the trend over 7 days. */
  trend: sql<string>`to_char(${LAGOS}, 'YYYY-MM-DD')`,
  /** Weekly (Monday-start), for the trend over 30 or 90 days: a day rarely reaches 30 results. */
  week: sql<string>`to_char(date_trunc('week', ${LAGOS}), 'YYYY-MM-DD')`,
} as const;
export type Dimension = keyof typeof DIMENSIONS;

export interface StatsFilter {
  isp?: string;
  state?: string;
  type?: string;
  window?: StatsWindow;
}
export type FilterName = keyof StatsFilter;

const FILTER_VALUES: Record<FilterName, ReadonlySet<string>> = {
  isp: new Set(ISPS.map((isp) => isp.slug)),
  state: new Set(NIGERIAN_STATES.map((state) => state.slug)),
  type: new Set(NETWORK_TYPES),
  window: new Set(STATS_WINDOWS.map(String)),
};

function setFilter(filter: StatsFilter, name: FilterName, value: string): void {
  if (name === "window") filter.window = Number(value) as StatsWindow;
  else filter[name] = value;
}

/** The API's filter: null (answered with 400) if the query holds anything unknown or repeated. */
export function parseFilter(params: URLSearchParams): StatsFilter | null {
  const filter: StatsFilter = {};
  for (const [name, value] of params) {
    if (!(name in FILTER_VALUES) || name in filter) return null;
    const key = name as FilterName;
    if (!FILTER_VALUES[key].has(value)) return null;
    setFilter(filter, key, value);
  }
  return filter;
}

/**
 * A page's filter, from Next's searchParams. Pages are shared and crawled, so this is lenient:
 * unknown names (fbclid, utm_*) are ignored, an empty value ("All" in the form) means no filter,
 * the first of repeated values wins, and names the page doesn't offer (`ignore`, its own dimension
 * among them) are skipped. Only an invalid value of an offered name gives null (a 404).
 */
export function parsePageFilter(
  params: Record<string, string | string[] | undefined>,
  ignore: readonly FilterName[] = [],
): StatsFilter | null {
  const filter: StatsFilter = {};
  for (const name of Object.keys(FILTER_VALUES) as FilterName[]) {
    if (ignore.includes(name)) continue;
    const raw = params[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === "") continue;
    if (!FILTER_VALUES[name].has(value)) return null;
    setFilter(filter, name, value);
  }
  return filter;
}

const median = (column: SQLWrapper) =>
  sql<number>`percentile_cont(0.5) within group (order by ${column})`.mapWith(Number);

const N = sql`count(*)::float8`;
const [LOW_RANK, HIGH_RANK] = sqlMedianRanks(N);
const ranked = (column: SQLWrapper, rank: SQL) =>
  sql<number>`(array_agg(${column} order by ${column}))[${rank}]`.mapWith(Number);
const bounds = (column: SQLWrapper) => ({
  low: ranked(column, LOW_RANK),
  high: ranked(column, HIGH_RANK),
});

/** Mbps to 2 significant figures. */
export const roundMbps = (value: number) => Number(value.toPrecision(2));
export const roundMs = (value: number) => Math.round(value);

export function countBand(n: number): CountBand {
  let band: CountBand = COUNT_BANDS[0].band;
  for (const entry of COUNT_BANDS) if (n >= entry.min) band = entry.band;
  return band;
}

/** The keys a dimension always lists, in display order. Days and weeks come from SQL. */
async function knownKeys(db: Db, dimension: Dimension, from: Date, now: Date): Promise<string[]> {
  switch (dimension) {
    case "isp":
      return ISPS.map((isp) => isp.slug);
    case "state":
      return NIGERIAN_STATES.map((state) => state.slug);
    case "network-type":
      return [...NETWORK_TYPES];
    case "hour":
      return Array.from({ length: 24 }, (_, hour) => String(hour));
    case "daypart":
      return Array.from({ length: 8 }, (_, block) => String(block * 3));
    case "trend":
    case "week": {
      // The same Lagos-time truncation as the grouping, so the boundaries can't disagree.
      const unit = dimension === "trend" ? sql.raw("day") : sql.raw("week");
      const lagos = (time: Date) =>
        sql`date_trunc('${unit}', ${time.toISOString()}::timestamptz at time zone 'Africa/Lagos')`;
      const rows = await db
        .select({ key: sql<string>`to_char(g, 'YYYY-MM-DD')` })
        .from(sql`generate_series(${lagos(from)}, ${lagos(now)}, interval '1 ${unit}') as g`);
      return rows.map((row) => row.key);
    }
  }
}

export async function groupStats(
  db: Db,
  dimension: Dimension,
  filter: StatsFilter,
  now: number,
): Promise<StatsCell[]> {
  const key = DIMENSIONS[dimension];
  const from = new Date(now - (filter.window ?? DEFAULT_STATS_WINDOW) * DAY_MS);
  const conditions = [
    gte(results.createdAt, from),
    isNull(results.flag),
    filter.isp === undefined ? undefined : eq(results.ispSlug, filter.isp),
    filter.state === undefined ? undefined : eq(results.stateSlug, filter.state),
    filter.type === undefined ? undefined : eq(results.networkType, filter.type),
    dimension === "state" ? isNotNull(results.stateSlug) : undefined,
  ];
  const [rows, keys] = await Promise.all([
    db
      .select({
        key,
        count: sql<number>`count(*)`.mapWith(Number),
        downloadMbps: median(results.downloadMbps),
        uploadMbps: median(results.uploadMbps),
        latencyMs: median(results.idleMedianMs),
        download: bounds(results.downloadMbps),
        upload: bounds(results.uploadMbps),
        latency: bounds(results.idleMedianMs),
      })
      .from(results)
      .where(and(...conditions))
      .groupBy(key),
    knownKeys(db, dimension, from, new Date(now)),
  ]);

  const found = new Map(rows.map((row) => [row.key, row]));
  return keys.map((name): StatsCell => {
    const row = found.get(name);
    if (!row || row.count < SHARING.minGroupSize) return { key: name, enough: false };
    return {
      key: name,
      enough: true,
      nBand: countBand(row.count),
      downloadMbps: roundMbps(row.downloadMbps),
      uploadMbps: roundMbps(row.uploadMbps),
      latencyMs: roundMs(row.latencyMs),
      interval: {
        downloadMbps: [roundMbps(row.download.low), roundMbps(row.download.high)],
        uploadMbps: [roundMbps(row.upload.low), roundMbps(row.upload.high)],
        latencyMs: [roundMs(row.latency.low), roundMs(row.latency.high)],
      },
    };
  });
}
