import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadInsights } from "./insights";
import { clearStatsMemo } from "./stats-cache";
import type { Stores } from "./stores";
import { testStores } from "./testing";

// connection() needs a request; the facade's job here is what it returns, not Next's scope.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const STORES = Symbol.for("kilomita.stores");
const global = globalThis as { [STORES]?: Promise<Stores | null> | undefined };
let stores: Stores;

beforeEach(async () => {
  clearStatsMemo();
  stores = await testStores(() => Date.now());
});

afterEach(() => {
  global[STORES] = undefined;
  vi.restoreAllMocks();
});

const use = (value: Stores | null) => {
  global[STORES] = Promise.resolve(value);
};

describe("loadInsights", () => {
  it("says where the numbers come from", async () => {
    use(stores);
    expect(await loadInsights("isp", {})).toMatchObject({ status: "ok", source: "real" });
    clearStatsMemo();
    use({ ...stores, memory: true });
    expect(await loadInsights("isp", {})).toMatchObject({ status: "ok", source: "test" });
    clearStatsMemo();
    use({ ...stores, memory: true, seeded: true });
    expect(await loadInsights("isp", {})).toMatchObject({ status: "ok", source: "sample" });
  });

  it("is unavailable without stores, or when the query fails, and logs the code only", async () => {
    use(null);
    expect(await loadInsights("isp", {})).toEqual({ status: "unavailable" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = Object.assign(new Error("connect db.example:5432"), { code: "ECONNREFUSED" });
    use({
      ...stores,
      db: {
        select: () => {
          throw failing;
        },
      } as unknown as Stores["db"],
    });
    expect(await loadInsights("isp", {})).toEqual({ status: "unavailable" });
    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toEqual([
      expect.objectContaining({ level: "error", event: "insights-load", code: "ECONNREFUSED" }),
    ]);
  });
});
