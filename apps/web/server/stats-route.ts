import { json, unavailable } from "./http";
import { DIMENSIONS, type Dimension, parseFilter } from "./stats";
import { cachedGroupStats } from "./stats-cache";
import type { SharingDeps } from "./stores";

/** Public and the same for everyone, so a CDN may keep it for a while. */
const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/**
 * GET /api/stats/:dimension (isp, state, network-type, hour, daypart for 3-hour blocks, trend for
 * daily cells, week for weekly ones), with optional isp, state, type and window (7, 30 or 90 days)
 * filters. Anything unknown is a 400, so junk query strings can't fill the cache.
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
  const cells = await cachedGroupStats(stores, dimension as Dimension, filter, now());
  return json(200, { cells }, { memory, cache: CACHE });
}
