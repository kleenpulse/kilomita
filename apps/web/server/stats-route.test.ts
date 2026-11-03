import { SHARING } from "@kilomita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { results } from "./db/schema";
import { clearStatsMemo } from "./stats-cache";
import { handleStats } from "./stats-route";
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

type Cell = { key: string; enough: boolean };
async function cells(path: string): Promise<Cell[]> {
  const response = await stats(path);
  expect(response.status).toBe(200);
  return ((await response.json()) as { cells: Cell[] }).cells;
}
const enough = async (path: string) =>
  (await cells(path)).filter((cell) => cell.enough).map((cell) => cell.key);

function rows(count: number, overrides: Parameters<typeof resultRow>[0] = {}) {
  return Array.from({ length: count }, (_, i) =>
    resultRow({ downloadMbps: i + 1, uploadMbps: 1, idleMedianMs: 40, ...overrides }),
  );
}

describe("GET /api/stats", () => {
  it("answers every dimension, with the window filter", async () => {
    await stores.db.insert(results).values(rows(MIN));
    expect(await enough("isp")).toEqual(["mtn"]);
    expect(await enough("isp?window=7")).toEqual(["mtn"]);
    expect(await enough("week?window=90")).toHaveLength(1);
    for (const dimension of ["state", "network-type", "hour", "daypart", "trend"]) {
      expect(await enough(dimension), dimension).toHaveLength(1);
    }
  });

  it("refuses unknown dimensions, parameters and values", async () => {
    expect((await stats("speed")).status).toBe(404);
    expect((await stats("isp?isp=nope")).status).toBe(400);
    expect((await stats("isp?colour=red")).status).toBe(400);
    expect((await stats("isp?isp=mtn&isp=glo")).status).toBe(400);
    expect((await stats("isp?window=14")).status).toBe(400);
  });

  it("may be cached publicly, and is memoised for a minute per window", async () => {
    const first = await stats("isp");
    expect(first.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=600",
    );
    await stores.db.insert(results).values(rows(MIN));
    expect(await enough("isp")).toEqual([]);
    // Another window is another memo entry.
    expect(await enough("isp?window=90")).toEqual(["mtn"]);
    time = NOW + 60_000;
    expect(await enough("isp")).toEqual(["mtn"]);
  });
});
