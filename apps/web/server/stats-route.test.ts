import { SHARING } from "@kilomita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { results } from "./db/schema";
import { clearStatsMemo, handleStats } from "./stats-route";
import type { SharingDeps, Stores } from "./stores";
import { resultRow, testDeps, testStores } from "./testing";

const NOW = Date.UTC(2026, 10, 2, 12);
const MIN = SHARING.minGroupSize;
let time: number;
let stores: Stores;
let deps: SharingDeps;

beforeEach(async () => {
  time = NOW;
  clearStatsMemo();
  stores = await testStores(() => time);
  deps = testDeps(stores, () => time);
});

function stats(path: string) {
  const url = new URL(`http://localhost/api/stats/${path}`);
  return handleStats(url, url.pathname.split("/").at(-1) ?? "", deps);
}

async function cells(path: string) {
  const response = await stats(path);
  expect(response.status).toBe(200);
  return ((await response.json()) as { cells: unknown[] }).cells;
}

function rows(count: number, overrides: Parameters<typeof resultRow>[0] = {}) {
  return Array.from({ length: count }, (_, i) =>
    resultRow({ downloadMbps: i + 1, uploadMbps: 1, idleMedianMs: 40, ...overrides }),
  );
}

describe("GET /api/stats", () => {
  it(`publishes nothing for a group below ${String(MIN)} results, not even its size`, async () => {
    await stores.db.insert(results).values(rows(MIN - 1, { ispSlug: "glo" }));
    await stores.db.insert(results).values(rows(MIN, { ispSlug: "mtn" }));
    expect(await cells("isp")).toEqual([
      { key: "glo", enough: false },
      { key: "mtn", enough: true, downloadMbps: (MIN + 1) / 2, uploadMbps: 1, latencyMs: 40 },
    ]);
  });

  it("uses exact medians for odd and even group sizes", async () => {
    await stores.db.insert(results).values(rows(MIN + 1, { ispSlug: "mtn" }));
    await stores.db.insert(results).values(rows(MIN, { ispSlug: "airtel" }));
    const found = (await cells("isp")) as { key: string; downloadMbps: number }[];
    const byKey = new Map(found.map((cell) => [cell.key, cell.downloadMbps]));
    expect(byKey.get("mtn")).toBe((MIN + 2) / 2);
    expect(byKey.get("airtel")).toBe((MIN + 1) / 2);
  });

  it("leaves out flagged rows and anything older than 30 days", async () => {
    await stores.db.insert(results).values(rows(MIN - 1));
    await stores.db.insert(results).values(resultRow({ flag: "duplicate" }));
    await stores.db.insert(results).values(resultRow({ flag: "implausible" }));
    await stores.db
      .insert(results)
      .values(resultRow({ createdAt: new Date(NOW - 31 * 24 * 60 * 60 * 1000) }));
    expect(await cells("isp")).toEqual([{ key: "mtn", enough: false }]);
  });

  it("buckets hours in Lagos time, and days for the trend", async () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    const late = new Date(Date.UTC(2026, 10, 1, 23, 30));
    await stores.db.insert(results).values(rows(MIN, { createdAt: late }));
    expect(await cells("hour")).toEqual([expect.objectContaining({ key: "0", enough: true })]);
    expect(await cells("trend")).toEqual([
      expect.objectContaining({ key: "2026-11-02", enough: true }),
    ]);
  });

  it("filters, and groups states without the rows that have none", async () => {
    await stores.db.insert(results).values(rows(MIN, { stateSlug: "kano", networkType: "3g" }));
    await stores.db.insert(results).values(rows(MIN, { stateSlug: null }));
    expect(await cells("state")).toEqual([expect.objectContaining({ key: "kano", enough: true })]);
    expect(await cells("network-type?state=kano")).toEqual([
      expect.objectContaining({ key: "3g", enough: true }),
    ]);
    expect(await cells("isp?type=5g")).toEqual([]);
  });

  it("refuses unknown dimensions, parameters and values", async () => {
    expect((await stats("speed")).status).toBe(404);
    expect((await stats("isp?isp=nope")).status).toBe(400);
    expect((await stats("isp?colour=red")).status).toBe(400);
    expect((await stats("isp?isp=mtn&isp=glo")).status).toBe(400);
  });

  it("may be cached publicly, and is memoised for a minute", async () => {
    const first = await stats("isp");
    expect(first.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=600",
    );
    await stores.db.insert(results).values(rows(MIN));
    expect(await cells("isp")).toEqual([]);
    time = NOW + 60_000;
    expect(await cells("isp")).toEqual([expect.objectContaining({ key: "mtn", enough: true })]);
  });
});
