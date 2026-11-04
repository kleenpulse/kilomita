import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENUINE_RESULT } from "./fixtures";
import { guarded } from "./http";
import type { IpProvider } from "./ip-provider";
import type { Kv } from "./kv";
import { recordEvents } from "./metrics";
import { handleNetworkRequest } from "./network-route";
import { handleCronPurge, handleHealth } from "./ops-routes";
import { handleOutcome } from "./outcomes-route";
import { handleCorrect, handleDelete, handleSubmit } from "./results-route";
import { handleStats } from "./stats-route";
import type { Stores } from "./stores";
import { MinuteGuard, TICKETS_PER_MINUTE } from "./test-servers";
import { handleTestServers } from "./test-servers-route";
import { TEST_KEY, jsonRequest, secret, testDeps, testStores } from "./testing";
import { issueToken } from "./token";
import { handleTokenRequest } from "./tokens-route";

/*
 * The web app's counterpart of apps/server's privacy capture: every handler runs, on good paths
 * and with stores that fail with messages full of addresses and secrets, while everything written
 * to stdout, stderr and the console is captured. None of it may show the client's address, a
 * secret, a token or a ticket. Only codes and fixed strings may reach a log line.
 */

const ADDRESS = "203.0.113.77";
const CRON = `cron-${randomBytes(16).toString("hex")}`;
const NOW = Date.UTC(2026, 10, 4, 12);

let output: string[];
let stores: Stores;

beforeEach(async () => {
  output = [];
  const capture = (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
  stores = await testStores(() => NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A store whose every call fails with a message that names the address and a secret. */
function leakyFailure(secretText: string) {
  return Object.assign(new Error(`connect to ${ADDRESS} with ${secretText} failed`), {
    code: "ECONNREFUSED",
  });
}

function failingKv(secretText: string): Kv {
  const fail = () => Promise.reject(leakyFailure(secretText));
  return {
    setIfAbsent: fail,
    get: fail,
    countInWindow: fail,
    incrementFields: fail,
    readFields: fail,
  };
}

const failingDb = (secretText: string) =>
  new Proxy(stores.db, {
    get() {
      return () => {
        throw leakyFailure(secretText);
      };
    },
  });

const headers = { "x-real-ip": ADDRESS };

describe("no log line carries an address or a secret", () => {
  it("across every handler, on good paths and failing ones", async () => {
    const owner = secret();
    const { token } = issueToken(
      TEST_KEY,
      { low: true, ev: GENUINE_RESULT.engineVersion },
      NOW - 20_000,
    );
    const ticketKey = new Uint8Array(randomBytes(32));
    const good = testDeps(stores, () => NOW, "x-real-ip");
    const broken: Stores = { ...stores, kv: failingKv(owner), db: failingDb(owner) };
    const bad = testDeps(broken, () => NOW, "x-real-ip");
    const provider: IpProvider = {
      id: "leaky",
      lookup: () => Promise.reject(leakyFailure(owner)),
    };
    const run = (event: string, task: () => Promise<Response>) => guarded(event, task);
    const tickets: string[] = [];

    for (const deps of [good, bad]) {
      await run("tokens", () =>
        handleTokenRequest(
          jsonRequest("POST", "/api/tokens", { lowData: true }, headers),
          deps,
          (task) => {
            void task();
          },
        ),
      );
      const servers = await run("test-servers", () =>
        handleTestServers(jsonRequest("POST", "/api/test-servers", { lowData: true }, headers), {
          config: {
            servers: [{ id: "lagos-1", origin: "https://lagos-1.kilomita.com.ng" }],
            fallback: false,
            warnings: [],
          },
          key: ticketKey,
          guard: new MinuteGuard(TICKETS_PER_MINUTE),
          now: () => NOW,
          stores: deps.stores,
          trustedHeader: "x-real-ip",
        }),
      );
      const body = (await servers.json()) as { ticket?: string };
      if (body.ticket) tickets.push(body.ticket);
      await run("results-submit", () =>
        handleSubmit(
          jsonRequest(
            "POST",
            "/api/results",
            { token, secret: owner, result: GENUINE_RESULT },
            headers,
          ),
          deps,
        ),
      );
      await run("results-correct", () =>
        handleCorrect(
          jsonRequest("PATCH", "/api/results/x", { secret: owner, ispSlug: "glo" }, headers),
          "00000000-0000-4000-8000-000000000000",
          deps,
        ),
      );
      await run("results-delete", () =>
        handleDelete(jsonRequest("DELETE", "/api/results", { secrets: [owner] }, headers), deps),
      );
      await run("stats", () => handleStats(new URL("http://localhost/api/stats/isp"), "isp", deps));
      await run("outcomes", () =>
        handleOutcome(
          jsonRequest(
            "POST",
            "/api/outcomes",
            { outcome: "complete", lowData: true, serverId: null },
            headers,
          ),
          {
            stores: deps.stores,
            trustedHeader: "x-real-ip",
            knownServers: new Set(),
            record: (fields) => {
              if (deps.stores) void recordEvents(deps.stores.kv, fields, NOW);
            },
            now: () => NOW,
          },
        ),
      );
      await run("health", () => handleHealth(deps.stores, NOW + 2 * 60 * 60_000));
      await run("cron-purge", () =>
        handleCronPurge(
          new Request("http://localhost/api/cron/purge", {
            headers: { authorization: `Bearer ${CRON}` },
          }),
          deps.stores,
          CRON,
          NOW,
        ),
      );
      await run("network", () =>
        handleNetworkRequest(
          new Request("http://localhost/api/network", { headers }),
          provider,
          "x-real-ip",
        ),
      );
    }
    // Let the fire-and-forget writes finish.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const all = output.join("\n");
    expect(all.length, "the failing paths did log something").toBeGreaterThan(0);
    for (const needle of [ADDRESS, owner, token, CRON, ...tickets]) {
      expect(all).not.toContain(needle);
    }
    expect(all).not.toContain(Buffer.from(TEST_KEY).toString("base64"));
    // Every line our code wrote is JSON with a fixed event and, at most, a code.
    for (const line of all.split("\n").filter((l) => l.trim().startsWith("{"))) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(
        Object.keys(parsed).every((key) =>
          ["t", "level", "event", "code", "note", "count"].includes(key),
        ),
        line,
      ).toBe(true);
    }
  });
});
