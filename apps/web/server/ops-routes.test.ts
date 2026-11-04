import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { results } from "./db/schema";
import { handleCronPurge, handleHealth } from "./ops-routes";
import type { Stores } from "./stores";
import { resultRow, testStores } from "./testing";

const NOW = Date.UTC(2026, 10, 4, 12);
let stores: Stores;

beforeEach(async () => {
  stores = await testStores(() => NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers ok, uncached, and nothing more", async () => {
    const response = await handleHealth(stores, NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("is degraded without stores", async () => {
    const response = await handleHealth(null, NOW);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded" });
  });

  it("is degraded when Redis fails, and says no more than that", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stores.kv.get = () =>
      Promise.reject(
        Object.assign(new Error("eu1-redis.upstash.io refused"), { code: "ECONNREFUSED" }),
      );
    const response = await handleHealth(stores, NOW);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(JSON.stringify({ status: "degraded" }));
  });

  it("asks the database at most once an hour, Redis every time", async () => {
    const execute = vi.spyOn(stores.db, "execute");
    const get = vi.spyOn(stores.kv, "get");
    // Hours after the other tests: the file shares one database, and so one memo entry.
    const T = NOW + 10 * 60 * 60_000;
    await handleHealth(stores, T);
    await handleHealth(stores, T + 15 * 60_000);
    await handleHealth(stores, T + 45 * 60_000);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(3);
    await handleHealth(stores, T + 60 * 60_000);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/health after a database failure", () => {
  it("rechecks after 5 minutes, not an hour, so it recovers soon after the database does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const execute = vi
      .spyOn(stores.db, "execute")
      .mockRejectedValueOnce(Object.assign(new Error("db down"), { code: "ECONNREFUSED" }));
    // Far from the other tests' times: the file shares one database, and so one memo entry.
    const T = NOW + 20 * 60 * 60_000;
    expect((await handleHealth(stores, T)).status).toBe(503);
    expect((await handleHealth(stores, T + 4 * 60_000)).status).toBe(503);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await handleHealth(stores, T + 5 * 60_000)).status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/cron/purge", () => {
  const call = (authorization?: string) =>
    new Request("http://localhost/api/cron/purge", {
      headers: authorization === undefined ? {} : { authorization },
    });
  const SECRET = "a-long-random-cron-secret";

  it("purges expired results with the right secret", async () => {
    const year = 366 * 24 * 60 * 60 * 1000;
    await stores.db.insert(results).values(resultRow({ createdAt: new Date(NOW - year) }));
    const response = await handleCronPurge(call(`Bearer ${SECRET}`), stores, SECRET, NOW);
    expect(response.status).toBe(200);
    expect(await stores.db.select().from(results)).toEqual([]);
  });

  it.each([undefined, "", "Bearer wrong", `Bearer ${SECRET}x`, SECRET])(
    "refuses %j and purges nothing",
    async (authorization) => {
      const year = 366 * 24 * 60 * 60 * 1000;
      await stores.db.insert(results).values(resultRow({ createdAt: new Date(NOW - year) }));
      const response = await handleCronPurge(call(authorization), stores, SECRET, NOW);
      expect(response.status).toBe(401);
      expect(await stores.db.select().from(results)).toHaveLength(1);
    },
  );

  it("never runs when no secret is configured, whatever is sent", async () => {
    for (const secret of [undefined, "", "  "]) {
      expect((await handleCronPurge(call("Bearer "), stores, secret, NOW)).status).toBe(503);
      expect((await handleCronPurge(call("Bearer undefined"), stores, secret, NOW)).status).toBe(
        503,
      );
    }
  });
});
