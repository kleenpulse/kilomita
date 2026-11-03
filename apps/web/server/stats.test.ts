import { ISPS, NETWORK_TYPES, NIGERIAN_STATES, SHARING } from "@kilomita/shared/lists";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { results } from "./db/schema";
import { medianRanks, sqlMedianRanks } from "./median-interval";
import {
  countBand,
  groupStats,
  parseFilter,
  parsePageFilter,
  roundMbps,
  roundMs,
  type Dimension,
  type StatsFilter,
} from "./stats";
import type { Stores } from "./stores";
import { resultRow, testStores } from "./testing";

const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 24 * 60 * 60 * 1000;
const MIN = SHARING.minGroupSize;
let stores: Stores;

beforeEach(async () => {
  stores = await testStores(() => NOW);
});

const stats = (dimension: Dimension, filter: StatsFilter = {}, now = NOW) =>
  groupStats(stores.db, dimension, filter, now);

async function cell(dimension: Dimension, key: string, filter: StatsFilter = {}) {
  const found = (await stats(dimension, filter)).find((entry) => entry.key === key);
  if (!found) throw new Error(`no ${key} cell`);
  return found;
}

/** Rows whose download speeds are the given values; upload and latency stay constant. */
function rowsWith(downloads: readonly number[], overrides: Parameters<typeof resultRow>[0] = {}) {
  return downloads.map((downloadMbps) =>
    resultRow({
      downloadMbps,
      uploadMbps: 1,
      idleMedianMs: 40,
      createdAt: new Date(NOW - DAY),
      ...overrides,
    }),
  );
}
const oneTo = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe("groupStats: what is published", () => {
  it(`lists every ISP, and gives a group below ${String(MIN)} no numbers, like a group with none`, async () => {
    await stores.db.insert(results).values(rowsWith(oneTo(MIN - 1), { ispSlug: "glo" }));
    await stores.db.insert(results).values(rowsWith(oneTo(MIN), { ispSlug: "mtn" }));
    const cells = await stats("isp");
    expect(cells.map((entry) => entry.key)).toEqual(ISPS.map((isp) => isp.slug));
    expect(cells.find((entry) => entry.key === "glo")).toEqual({ key: "glo", enough: false });
    expect(cells.find((entry) => entry.key === "ipnx")).toEqual({ key: "ipnx", enough: false });
  });

  it("publishes a band, rounded medians and the order-statistic interval", async () => {
    // 1..30: the median is 15.5, and for n = 30 the 95% ranks are the 10th and 21st values.
    await stores.db.insert(results).values(rowsWith(oneTo(MIN)));
    expect(medianRanks(30)).toEqual([10, 21]);
    expect(await cell("isp", "mtn")).toEqual({
      key: "mtn",
      enough: true,
      nBand: "30-49",
      downloadMbps: 16,
      uploadMbps: 1,
      latencyMs: 40,
      interval: { downloadMbps: [10, 21], uploadMbps: [1, 1], latencyMs: [40, 40] },
    });
  });

  it("rounds Mbps to 2 significant figures and ms to whole ms", async () => {
    await stores.db
      .insert(results)
      .values(
        rowsWith(Array<number>(MIN).fill(12.3456), { uploadMbps: 0.04567, idleMedianMs: 41.6 }),
      );
    expect(await cell("isp", "mtn")).toMatchObject({
      downloadMbps: 12,
      uploadMbps: 0.046,
      latencyMs: 42,
      interval: { downloadMbps: [12, 12], uploadMbps: [0.046, 0.046], latencyMs: [42, 42] },
    });
    expect([roundMbps(123.4), roundMbps(0), roundMs(0.5)]).toEqual([120, 0, 1]);
  });

  it("bands a group's size at every edge", async () => {
    const edges: [number, string][] = [
      [30, "30-49"],
      [49, "30-49"],
      [50, "50-99"],
      [99, "50-99"],
      [100, "100-249"],
      [249, "100-249"],
      [250, "250-499"],
      [499, "250-499"],
      [500, "500-999"],
      [999, "500-999"],
      [1000, "1000+"],
      [25_000, "1000+"],
    ];
    expect(edges.map(([n]) => countBand(n))).toEqual(edges.map(([, band]) => band));
    await stores.db.insert(results).values(rowsWith(oneTo(50)));
    expect(await cell("isp", "mtn")).toMatchObject({ nBand: "50-99" });
  });

  it("never publishes a hidden result exactly, only rounded (differencing two groups)", async () => {
    // X: MTN in Kano on 4G, 30 results. Y: MTN in Kano, the same 30 plus one hidden 3G result v.
    const x = oneTo(MIN).map((i) => i * 0.8);
    const cases = [
      // Between X's 15th and 16th values: Y's median (n = 31, the 16th value) is v itself.
      { v: 12.3456, field: (c: Published) => c.downloadMbps },
      // Between X's 9th and 10th: Y's lower bound (rank 10 for n = 31) is v itself.
      { v: 7.6543, field: (c: Published) => c.interval.downloadMbps[0] },
    ];
    for (const { v, field } of cases) {
      await stores.db.delete(results);
      await stores.db.insert(results).values(rowsWith(x, { stateSlug: "kano", networkType: "4g" }));
      await stores.db
        .insert(results)
        .values(rowsWith([v], { stateSlug: "kano", networkType: "3g" }));
      const groupX = published(await cell("isp", "mtn", { state: "kano", type: "4g" }));
      const groupY = published(await cell("isp", "mtn", { state: "kano" }));
      const numbers =
        JSON.stringify(groupY)
          .match(/-?\d+(\.\d+)?/g)
          ?.map(Number) ?? [];
      expect(numbers).not.toContain(v);
      // The residual leak, as /privacy and /methodology describe it: v, rounded.
      expect(field(groupY)).toBe(roundMbps(v));
      expect(groupY.nBand).toBe(groupX.nBand);
    }
  });

  it("lets someone who shares made-up results into a hidden group read one real result (insertion)", async () => {
    // The residual leak /privacy and /methodology describe: a sender knows how many results they
    // added, so the count band hides nothing from them. Pinned so a mitigation shows up here.
    const victim = 23.4567;
    const kebbi = { stateSlug: "kebbi", networkType: "5g" };
    const group = () => cell("isp", "mtn", { state: "kebbi", type: "5g" });
    await stores.db.insert(results).values(rowsWith([victim], kebbi));
    const forged = [...Array<number>(9).fill(0.5), ...Array<number>(20).fill(900)];
    for (const [added, value] of forged.entries()) {
      expect((await group()).enough, `hidden after ${String(added)} forged`).toBe(false);
      await stores.db.insert(results).values(rowsWith([value], kebbi));
    }
    // n = 30 is known exactly, and rank 10 (9 forged below, 20 above) is the real result.
    const shown = published(await group());
    expect(shown.nBand).toBe("30-49");
    expect(shown.interval.downloadMbps[0]).toBe(roundMbps(victim));
  });

  it("leaves out flagged rows", async () => {
    await stores.db.insert(results).values(rowsWith(oneTo(MIN - 1)));
    await stores.db
      .insert(results)
      .values(resultRow({ flag: "duplicate", createdAt: new Date(NOW - DAY) }));
    await stores.db
      .insert(results)
      .values(resultRow({ flag: "implausible", createdAt: new Date(NOW - DAY) }));
    expect(await cell("isp", "mtn")).toEqual({ key: "mtn", enough: false });
  });

  it("covers a rolling window of 7, 30 or 90 days, 30 by default", async () => {
    await stores.db
      .insert(results)
      .values(rowsWith(oneTo(MIN), { createdAt: new Date(NOW - 8 * DAY) }));
    await stores.db
      .insert(results)
      .values(rowsWith(oneTo(MIN), { ispSlug: "glo", createdAt: new Date(NOW - 60 * DAY) }));
    expect(await cell("isp", "mtn")).toMatchObject({ enough: true });
    expect(await cell("isp", "mtn", { window: 7 })).toEqual({ key: "mtn", enough: false });
    expect(await cell("isp", "glo")).toEqual({ key: "glo", enough: false });
    expect(await cell("isp", "glo", { window: 90 })).toMatchObject({ enough: true });
  });

  it("filters, and groups states without the rows that have none", async () => {
    await stores.db
      .insert(results)
      .values(rowsWith(oneTo(MIN), { stateSlug: "kano", networkType: "3g" }));
    await stores.db.insert(results).values(rowsWith(oneTo(MIN), { stateSlug: null }));
    const states = await stats("state");
    expect(states.map((entry) => entry.key)).toEqual(NIGERIAN_STATES.map((state) => state.slug));
    expect(states.filter((entry) => entry.enough).map((entry) => entry.key)).toEqual(["kano"]);
    const types = await stats("network-type", { state: "kano" });
    expect(types.map((entry) => entry.key)).toEqual([...NETWORK_TYPES]);
    expect(types.filter((entry) => entry.enough).map((entry) => entry.key)).toEqual(["3g"]);
    expect((await stats("isp", { type: "5g" })).every((entry) => !entry.enough)).toBe(true);
  });
});

describe("groupStats: time keys in Lagos time", () => {
  it("lists all 24 hours and buckets 23:30 UTC as 00:30 the next Lagos day", async () => {
    const late = new Date(Date.UTC(2026, 10, 1, 23, 30));
    await stores.db.insert(results).values(rowsWith(oneTo(MIN), { createdAt: late }));
    const hours = await stats("hour");
    expect(hours.map((entry) => entry.key)).toEqual(oneTo(24).map((hour) => String(hour - 1)));
    expect(hours.filter((entry) => entry.enough).map((entry) => entry.key)).toEqual(["0"]);
    const days = await stats("trend");
    expect(days.filter((entry) => entry.enough).map((entry) => entry.key)).toEqual(["2026-11-02"]);
    const blocks = await stats("daypart");
    expect(blocks.map((entry) => entry.key)).toEqual(["0", "3", "6", "9", "12", "15", "18", "21"]);
    expect(blocks.filter((entry) => entry.enough).map((entry) => entry.key)).toEqual(["0"]);
  });

  it("puts each hour in its 3-hour block", async () => {
    // 13:59 UTC is 14:59 in Lagos: the 12:00-15:00 block. 14:00 UTC is 15:00: the next one.
    await stores.db
      .insert(results)
      .values(rowsWith(oneTo(MIN), { createdAt: new Date(Date.UTC(2026, 10, 1, 13, 59)) }));
    await stores.db
      .insert(results)
      .values(
        rowsWith(oneTo(MIN), { ispSlug: "glo", createdAt: new Date(Date.UTC(2026, 10, 1, 14)) }),
      );
    const shown = async (isp: string) =>
      (await stats("daypart", { isp })).filter((entry) => entry.enough).map((entry) => entry.key);
    expect(await shown("mtn")).toEqual(["12"]);
    expect(await shown("glo")).toEqual(["15"]);
  });

  it("lists N + 1 Lagos days for a window of N, ending on today in Lagos", async () => {
    // At 23:30 UTC it is already the next day in Lagos.
    const now = Date.UTC(2026, 10, 2, 23, 30);
    const keys = (await stats("trend", { window: 7 }, now)).map((entry) => entry.key);
    expect(keys).toEqual([
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect((await stats("trend", {}, now)).map((entry) => entry.key)).toHaveLength(31);
  });

  it("lists Monday-start weeks, grouping a row with its own Lagos week", async () => {
    // Sunday 2026-11-01 23:30 UTC is Monday 00:30 in Lagos: the week of 2026-11-02.
    const late = new Date(Date.UTC(2026, 10, 1, 23, 30));
    await stores.db.insert(results).values(rowsWith(oneTo(MIN), { createdAt: late }));
    const weeks = await stats("week", { window: 90 });
    expect(weeks.at(-1)?.key).toBe("2026-11-02");
    expect(weeks.every((entry) => new Date(`${entry.key}T12:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(weeks.filter((entry) => entry.enough).map((entry) => entry.key)).toEqual(["2026-11-02"]);
  });
});

describe("the median interval's ranks", () => {
  it("are the same in SQL as in TypeScript for every n from 30 to 10,000", async () => {
    const [low, high] = sqlMedianRanks(sql`n::float8`);
    const rows = await stores.db
      .select({
        n: sql<number>`n`.mapWith(Number),
        low: sql<number>`${low}`.mapWith(Number),
        high: sql<number>`${high}`.mapWith(Number),
      })
      .from(sql`generate_series(30, 10000) as n`);
    expect(rows).toHaveLength(10000 - 29);
    const mismatches = rows.filter((row) => {
      const [tsLow, tsHigh] = medianRanks(row.n);
      return tsLow !== row.low || tsHigh !== row.high;
    });
    expect(mismatches).toEqual([]);
  });

  it("cover the median with at least 95% probability, exactly, for every n from 30 to 10,000", () => {
    // The r-th to s-th smallest cover the median when r <= B <= s - 1, B ~ Binomial(n, 1/2).
    // Probabilities come from a recurrence outward from the mode, never C(n, k)·0.5^n, which
    // underflows past n ≈ 1074.
    let worst = 1;
    for (let n = 30; n <= 10_000; n++) {
      const [r, s] = medianRanks(n);
      const weights = new Float64Array(n + 1);
      const mode = Math.floor(n / 2);
      weights[mode] = 1;
      for (let k = mode; k < n; k++) weights[k + 1] = (weights[k] ?? 0) * ((n - k) / (k + 1));
      for (let k = mode; k > 0; k--) weights[k - 1] = (weights[k] ?? 0) * (k / (n - k + 1));
      let total = 0;
      let inside = 0;
      for (let k = 0; k <= n; k++) {
        total += weights[k] ?? 0;
        if (k >= r && k <= s - 1) inside += weights[k] ?? 0;
      }
      worst = Math.min(worst, inside / total);
    }
    expect(worst).toBeGreaterThanOrEqual(0.95);
  });

  it("stay within 1..n", () => {
    for (const n of [1, 2, 3, 5, 30]) {
      const [low, high] = medianRanks(n);
      expect(low).toBeGreaterThanOrEqual(1);
      expect(high).toBeLessThanOrEqual(n);
    }
  });
});

describe("filters", () => {
  it("the API's is strict", () => {
    const parse = (query: string) => parseFilter(new URLSearchParams(query));
    expect(parse("isp=mtn&state=kano&type=4g&window=90")).toEqual({
      isp: "mtn",
      state: "kano",
      type: "4g",
      window: 90,
    });
    for (const bad of [
      "isp=nope",
      "colour=red",
      "isp=mtn&isp=glo",
      "window=14",
      "window=",
      "state=",
    ]) {
      expect(parse(bad), bad).toBeNull();
    }
  });

  it("a page's ignores what links add, empty values and its own dimension", () => {
    expect(parsePageFilter({ fbclid: "x", utm_source: "wa", state: "", type: "4g" })).toEqual({
      type: "4g",
    });
    expect(parsePageFilter({ state: ["kano", "lagos"], window: "7" })).toEqual({
      state: "kano",
      window: 7,
    });
    expect(parsePageFilter({ state: "kano", isp: "glo" }, ["state"])).toEqual({ isp: "glo" });
    expect(parsePageFilter({ isp: "glo", state: "atlantis" }, ["isp", "state"])).toEqual({});
    expect(parsePageFilter({ state: "atlantis" })).toBeNull();
    expect(parsePageFilter({ window: "14" })).toBeNull();
  });
});

type Published = Extract<Awaited<ReturnType<typeof groupStats>>[number], { enough: true }>;
function published(entry: Awaited<ReturnType<typeof groupStats>>[number]): Published {
  if (!entry.enough) throw new Error(`${entry.key} is hidden`);
  return entry;
}
