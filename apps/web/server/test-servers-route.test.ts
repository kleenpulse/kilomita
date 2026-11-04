import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADDRESS_LIMITS } from "./address-limits";
import { kvSaltStore } from "./ip-hash";
import { type Kv, memoryKv } from "./kv";
import { jsonRequest } from "./testing";
import { MinuteGuard, TICKETS_PER_MINUTE, testServerSetup } from "./test-servers";
import { handleTestServers, type TestServerDeps } from "./test-servers-route";

const SECRET = randomBytes(32).toString("base64");
const NOW = Date.UTC(2026, 10, 3, 12);
const servers = [{ id: "lagos-1", origin: "https://lagos-1.kilomita.ng" }];

function deps(overrides: Partial<TestServerDeps> = {}): TestServerDeps {
  return {
    config: { servers, fallback: false, warnings: [] },
    key: new Uint8Array(randomBytes(32)),
    guard: new MinuteGuard(TICKETS_PER_MINUTE),
    now: () => NOW,
    stores: null,
    trustedHeader: undefined,
    ...overrides,
  };
}

const ask = (body: unknown = { lowData: false }) => jsonRequest("POST", "/api/test-servers", body);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/test-servers", () => {
  it("answers the servers, the fallback setting and a fresh ticket, uncached", async () => {
    const response = await handleTestServers(ask(), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      servers: unknown;
      fallback: unknown;
      ticket: unknown;
    };
    expect(body.servers).toEqual(servers);
    expect(body.fallback).toBe(false);
    expect(body.ticket).toMatch(/^k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("offers no servers of ours without the ticket secret", async () => {
    const response = await handleTestServers(
      ask(),
      deps({ key: null, config: { servers, fallback: true, warnings: [] } }),
    );
    expect(await response.json()).toEqual({ servers: [], fallback: true, ticket: null });
  });

  it.each([[{}], [{ lowData: "yes" }], [{ lowData: true, extra: 1 }]])(
    "refuses %j",
    async (body) => {
      expect((await handleTestServers(ask(body), deps())).status).toBe(400);
    },
  );

  it("is a CPU guard only: ticket 1,201 in a minute is issued, request 60,001 is refused", async () => {
    const guard = new MinuteGuard(TICKETS_PER_MINUTE);
    const d = deps({ guard });
    for (let i = 0; i < 1_200; i++) guard.allow(NOW);
    expect((await handleTestServers(ask(), d)).status).toBe(200);
    for (let i = 1_201; i < TICKETS_PER_MINUTE; i++) guard.allow(NOW);
    expect((await handleTestServers(ask(), d)).status).toBe(429);
    // A new minute starts from zero.
    expect((await handleTestServers(ask(), deps({ guard, now: () => NOW + 60_000 }))).status).toBe(
      200,
    );
  });

  describe("per address, with CLIENT_IP_HEADER", () => {
    const fixedSalt = { saltForToday: () => Promise.resolve(new Uint8Array(32).fill(3)) };
    const from = (ip: string) =>
      jsonRequest("POST", "/api/test-servers", { lowData: true }, { "x-real-ip": ip });

    it("hands out runsPerHour tickets an hour to one address, then 429", async () => {
      const recorded: string[] = [];
      const d = deps({
        stores: { kv: memoryKv(() => NOW), salt: fixedSalt },
        trustedHeader: "x-real-ip",
        record: (fields) => recorded.push(...fields),
      });
      for (let i = 0; i < ADDRESS_LIMITS.runsPerHour; i++) {
        expect((await handleTestServers(from("102.88.34.10"), d)).status).toBe(200);
      }
      const refused = await handleTestServers(from("102.88.34.10"), d);
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ error: "rate-limited" });
      expect((await handleTestServers(from("102.88.34.99"), d)).status).toBe(200);
      expect(recorded.filter((f) => f === "start:low")).toHaveLength(
        ADDRESS_LIMITS.runsPerHour + 1,
      );
      expect(recorded.filter((f) => f === "limited:servers")).toHaveLength(1);
    });

    it("still answers servers and a ticket when every Redis call fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const down = () => Promise.reject(new Error("redis down"));
      const broken: Kv = {
        setIfAbsent: down,
        get: down,
        countInWindow: down,
        incrementFields: down,
        readFields: down,
      };
      const response = await handleTestServers(
        from("102.88.34.10"),
        deps({
          stores: { kv: broken, salt: kvSaltStore(broken) },
          trustedHeader: "x-real-ip",
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { servers: unknown; ticket: unknown };
      expect(body.servers).toEqual(servers);
      expect(body.ticket).toMatch(/^k1\./);
    });
  });
});

describe("testServerSetup", () => {
  it("warns once about a bad config, without printing any value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = {
      KILOMITA_TEST_SERVERS: "lagos=ftp://secret-host.example",
      KILOMITA_SERVER_TICKET_SECRET: SECRET,
      NODE_ENV: "production",
    };
    testServerSetup(env);
    testServerSetup(env);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret-host");
  });

  it("says when our servers are configured but the ticket secret is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const setup = testServerSetup({
      KILOMITA_TEST_SERVERS: "lagos=https://lagos.kilomita.ng",
      NODE_ENV: "production",
    });
    expect(setup.key).toBeNull();
    expect(warn.mock.calls.map((call) => JSON.parse(String(call[0])) as unknown)).toEqual([
      expect.objectContaining({
        event: "ticket-secret-missing",
        note: "KILOMITA_SERVER_TICKET_SECRET is missing or malformed: own test servers are off.",
      }),
    ]);
  });
});
