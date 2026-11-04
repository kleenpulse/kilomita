import { beforeEach, describe, expect, it, vi } from "vitest";
import { results } from "./db/schema";
import { ADDRESS_LIMITS } from "./address-limits";
import { LIMITS } from "./limits";
import { noRecorder } from "./metrics";
import type { SharingDeps, Stores } from "./stores";
import { TEST_KEY, jsonRequest, resultRow, testDeps, testStores } from "./testing";
import { verifyToken } from "./token";
import { handleTokenRequest } from "./tokens-route";

const NOW = Date.UTC(2026, 10, 2, 12);
let time: number;
let stores: Stores;
let deps: SharingDeps;
let scheduled: (() => Promise<void>)[];

beforeEach(async () => {
  time = NOW;
  stores = await testStores(() => time);
  deps = testDeps(stores, () => time);
  scheduled = [];
});

const ask = (body: unknown = { lowData: true }, using = deps) =>
  handleTokenRequest(jsonRequest("POST", "/api/tokens", body), using, (task) => {
    scheduled.push(task);
  });

describe("POST /api/tokens", () => {
  it("issues a signed token for the run's profile and the current engine", async () => {
    const response = await ask({ lowData: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { token, expiresAt } = (await response.json()) as { token: string; expiresAt: number };
    expect(expiresAt).toBe(NOW + 30 * 60_000);
    const check = verifyToken(TEST_KEY, token, NOW);
    expect(check.ok && check.claims).toMatchObject({ iat: NOW, low: true, ev: "0.4.0" });
  });

  it("stores nothing for a token", async () => {
    await ask();
    expect(await stores.db.select().from(results)).toEqual([]);
  });

  it("refuses a bad body", async () => {
    expect((await ask({})).status).toBe(400);
    expect((await ask({ lowData: "yes" })).status).toBe(400);
    expect((await ask({ lowData: true, extra: 1 })).status).toBe(400);
  });

  it("has a global ceiling per minute, and nothing per address without CLIENT_IP_HEADER", async () => {
    const minute = Math.floor(NOW / 60_000);
    for (let i = 0; i < LIMITS.tokensPerMinute; i++) {
      await stores.kv.countInWindow(`tokens:${String(minute)}`, (minute + 1) * 60_000);
    }
    expect((await ask()).status).toBe(429);
    time = (minute + 1) * 60_000;
    expect((await ask()).status).toBe(200);
  });

  describe("per address, with CLIENT_IP_HEADER", () => {
    const fromAddress = (ip: string, record = noRecorder) =>
      handleTokenRequest(
        jsonRequest("POST", "/api/tokens", { lowData: false }, { "x-real-ip": ip }),
        testDeps(stores, () => time, "x-real-ip"),
        (task) => {
          scheduled.push(task);
        },
        record,
      );

    it("allows runsPerHour tokens an hour to one address, then 429, and counts the refusal", async () => {
      const recorded: string[] = [];
      const record = (fields: readonly string[]) => {
        recorded.push(...fields);
      };
      for (let i = 0; i < ADDRESS_LIMITS.runsPerHour; i++) {
        expect((await fromAddress("102.88.34.10", record)).status).toBe(200);
      }
      const refused = await fromAddress("102.88.34.10", record);
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ error: "rate-limited" });
      expect(recorded.filter((field) => field === "limited:tokens")).toHaveLength(1);
      expect(recorded.filter((field) => field === "token:std")).toHaveLength(
        ADDRESS_LIMITS.runsPerHour,
      );
      expect((await fromAddress("102.88.34.11")).status).toBe(200);
    });

    it("still issues tokens when the limiter's Redis calls fail", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const count = stores.kv.countInWindow.bind(stores.kv);
      stores.kv.countInWindow = (key, end) =>
        key.startsWith("rl:") ? Promise.reject(new Error("redis down")) : count(key, end);
      expect((await fromAddress("102.88.34.10")).status).toBe(200);
    });
  });

  it("is unavailable without stores or a usable key", async () => {
    expect((await ask(undefined, { ...deps, stores: null })).status).toBe(503);
    expect((await ask(undefined, { ...deps, key: null })).status).toBe(503);
  });

  it("logs a failed purge by its code only, never the error", async () => {
    const failing = new Proxy(stores.db, {
      get(target, property, receiver) {
        if (property === "delete") {
          return () => {
            throw Object.assign(new Error("connect to db.example.neon.tech:5432 failed"), {
              code: "ECONNREFUSED",
            });
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await ask(undefined, { ...deps, stores: { ...stores, db: failing } });
    await expect(Promise.all(scheduled.map((task) => task()))).resolves.toBeDefined();
    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toEqual([
      expect.objectContaining({ level: "error", event: "retention-purge", code: "ECONNREFUSED" }),
    ]);
    log.mockRestore();
  });

  it("purges old data after answering, at most once an hour", async () => {
    const year = 366 * 24 * 60 * 60 * 1000;
    await stores.db.insert(results).values(resultRow({ createdAt: new Date(NOW - year) }));
    await ask();
    await ask();
    expect(scheduled).toHaveLength(2);
    await Promise.all(scheduled.map((task) => task()));
    expect(await stores.db.select().from(results)).toEqual([]);

    await stores.db.insert(results).values(resultRow({ createdAt: new Date(NOW - year) }));
    scheduled = [];
    await ask();
    await Promise.all(scheduled.map((task) => task()));
    // Within the hour the lock holds, so the second old row stays until the next purge.
    expect(await stores.db.select().from(results)).toHaveLength(1);
  });
});
