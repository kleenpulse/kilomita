import type { StatsCell } from "@kilomita/shared";
import { connection } from "next/server";
import type { InsightsSource } from "@/lib/insights-format";
import { logFailure } from "./http";
import { type Dimension, type FilterName, type StatsFilter, parsePageFilter } from "./stats";
import { cachedGroupStats } from "./stats-cache";
import { getStores } from "./stores";

/*
 * The insight pages' only way into server code (eslint.config.ts allows app/(insights)/ pages
 * this module and nothing else under server/). Everything here runs at request time, so `next
 * build` never touches a database.
 */

export { parsePageFilter };
export type { FilterName, InsightsSource, StatsFilter };

export type Insights =
  { status: "ok"; source: InsightsSource; cells: StatsCell[] } | { status: "unavailable" };

export async function loadInsights(dimension: Dimension, filter: StatsFilter): Promise<Insights> {
  await connection();
  const stores = await getStores();
  if (!stores) return { status: "unavailable" };
  try {
    const cells = await cachedGroupStats(stores, dimension, filter, Date.now());
    const source = !stores.memory ? "real" : stores.seeded ? "sample" : "test";
    return { status: "ok", source, cells };
  } catch (error) {
    logFailure("Loading insights", error);
    return { status: "unavailable" };
  }
}
