import type { StatsCell } from "@kilomita/shared";
import { json, unavailable } from "./http";
import { DIMENSIONS, type Dimension, groupStats, parseFilter } from "./stats";
import type { SharingDeps } from "./stores";

/** Public and the same for everyone, so a CDN may keep it for a while. */
const CACHE = "public, s-maxage=300, stale-while-revalidate=600";
const MEMO_MS = 60_000;

const memo = new Map<string, { at: number; cells: StatsCell[] }>();

/**
 * GET /api/stats/:dimension (isp, state, network-type, hour, or trend for daily cells), with
 * optional isp, state and type filters. Anything unknown is a 400, so junk
 * query strings can't fill the cache.
 */
export async function handleStats(
  url: URL,
  dimension: string,
  { stores, now }: SharingDeps,
): Promise<Response> {
  if (!stores) return unavailable();
  const memory = stores.memory;
  if (!(dimension in DIMENSIONS)) return json(404, { error: "not-found" }, { memory });
  const filter = parseFilter(url.searchParams);
  if (!filter) return json(400, { error: "invalid" }, { memory });

  const memoKey = JSON.stringify([dimension, filter.isp, filter.state, filter.type]);
  const time = now();
  let entry = memo.get(memoKey);
  if (!entry || time - entry.at >= MEMO_MS) {
    entry = { at: time, cells: await groupStats(stores.db, dimension as Dimension, filter, time) };
    memo.set(memoKey, entry);
  }
  return json(200, { cells: entry.cells }, { memory, cache: CACHE });
}

/** For tests: forget memoised answers. */
export function clearStatsMemo(): void {
  memo.clear();
}
