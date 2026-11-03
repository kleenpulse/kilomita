import type { StatsCell } from "@kilomita/shared";
import { DEFAULT_STATS_WINDOW } from "@kilomita/shared/lists";
import { type Dimension, type StatsFilter, groupStats } from "./stats";
import type { Stores } from "./stores";

/** Stats are memoised for a minute per process, shared by the API and the insight pages. */
const MEMO_MS = 60_000;

// On the process-wide global, like the stores (stores.ts): routes and pages are separate module
// graphs, and two memos could answer the same question differently for up to a minute.
const MEMO: unique symbol = Symbol.for("kilomita.stats-memo");
type Memo = Map<string, { at: number; cells: StatsCell[] }>;
const shared = globalThis as {
  [MEMO]?: Memo | undefined;
};
const memo: Memo = (shared[MEMO] ??= new Map() as Memo);

export async function cachedGroupStats(
  stores: Stores,
  dimension: Dimension,
  filter: StatsFilter,
  now: number,
): Promise<StatsCell[]> {
  const key = JSON.stringify([
    dimension,
    filter.isp,
    filter.state,
    filter.type,
    filter.window ?? DEFAULT_STATS_WINDOW,
  ]);
  let entry = memo.get(key);
  if (!entry || now - entry.at >= MEMO_MS) {
    entry = { at: now, cells: await groupStats(stores.db, dimension, filter, now) };
    memo.set(key, entry);
  }
  return entry.cells;
}

/** For tests: forget memoised answers. */
export function clearStatsMemo(): void {
  memo.clear();
}
