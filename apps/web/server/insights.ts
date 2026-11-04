import type { StatsCell } from "@kilomita/shared";
import { connection } from "next/server";
import type { InsightsSource } from "@/lib/insights-format";
import { logFailure } from "./http";
import { type Dimension, type FilterName, type StatsFilter, parsePageFilter } from "./stats";
import { cachedGroupStats } from "./stats-cache";
import { readStatus } from "./metrics";
import { type StatusSummary, summarizeStatus } from "./status";
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
    logFailure("insights-load", error);
    return { status: "unavailable" };
  }
}

export type { StatusSummary } from "./status";

export type StatusView =
  { status: "ok"; source: InsightsSource; summary: StatusSummary } | { status: "unavailable" };

/*
 * /status renders on every request; its 54 hash reads are memoised for a minute per process, on
 * globalThis like the stats memo (routes and pages are separate module graphs).
 */
const STATUS_MEMO: unique symbol = Symbol.for("kilomita.status-memo");
const memo = globalThis as {
  [STATUS_MEMO]?: WeakMap<object, { at: number; summary: StatusSummary }> | undefined;
};
const STATUS_TTL_MS = 60_000;

export async function loadStatus(): Promise<StatusView> {
  await connection();
  const stores = await getStores();
  if (!stores) return { status: "unavailable" };
  const source = !stores.memory ? "real" : stores.seeded ? "sample" : "test";
  const cache = (memo[STATUS_MEMO] ??= new WeakMap());
  const now = Date.now();
  const cached = cache.get(stores.kv);
  if (cached && now - cached.at < STATUS_TTL_MS) {
    return { status: "ok", source, summary: cached.summary };
  }
  try {
    const summary = summarizeStatus(await readStatus(stores.kv, now));
    cache.set(stores.kv, { at: now, summary });
    return { status: "ok", source, summary };
  } catch (error) {
    logFailure("status-load", error);
    return { status: "unavailable" };
  }
}
