import { afterEach, describe, expect, it, vi } from "vitest";
import { ADDRESS_LIMITS } from "./address-limits";
import { type Kv, memoryKv } from "./kv";
import { kvSaltStore } from "./ip-hash";
import { handleOutcome, parseOutcome, type OutcomeDeps } from "./outcomes-route";
import { jsonRequest } from "./testing";

const NOW = Date.UTC(2026, 10, 4, 12);

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(overrides: Partial<OutcomeDeps> = {}) {
  const recorded: string[] = [];
  const kv = memoryKv(() => NOW);
  const deps: OutcomeDeps = {
    stores: { kv, salt: kvSaltStore(kv, () => NOW), memory: false },
    trustedHeader: "x-real-ip",
    knownServers: new Set(["lagos-1", "cloudflare"]),
    record: (fields) => recorded.push(...fields),
    now: () => NOW,
    ...overrides,
  };
  return { deps, recorded };
}

const report = (body: unknown, ip = "102.88.34.10") =>
  jsonRequest("POST", "/api/outcomes", body, { "x-real-ip": ip });

describe("parseOutcome", () => {
  it("takes exactly the three fields", () => {
    expect(parseOutcome({ outcome: "complete", lowData: true, serverId: "lagos-1" })).toEqual({
      outcome: "complete",
      lowData: true,
      serverId: "lagos-1",
    });
    expect(parseOutcome({ outcome: "hidden", lowData: false, serverId: null })).not.toBeNull();
  });

  it.each([
    [{ outcome: "complete", lowData: true }],
    [{ outcome: "complete", lowData: true, serverId: null, downloadMbps: 20 }],
    [{ outcome: "won", lowData: true, serverId: null }],
    [{ outcome: "complete", lowData: "yes", serverId: null }],
    [{ outcome: "complete", lowData: true, serverId: 5 }],
    [{ outcome: "complete", lowData: true, serverId: "x".repeat(33) }],
    [[]],
    [null],
    ["complete"],
  ])("refuses %j", (body) => {
    expect(parseOutcome(body)).toBeNull();
  });
});

describe("POST /api/outcomes", () => {
  it("counts one run and answers 204, uncached, with no body", async () => {
    const { deps, recorded } = setup();
    const response = await handleOutcome(
      report({ outcome: "complete", lowData: true, serverId: "lagos-1" }),
      deps,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(recorded).toEqual(["run:complete:low:lagos-1"]);
  });

  it("folds unknown server ids into none, so forged reports can't add counter names", async () => {
    const { deps, recorded } = setup();
    await handleOutcome(
      report({ outcome: "network-lost", lowData: false, serverId: "evil" }),
      deps,
    );
    await handleOutcome(report({ outcome: "no-server", lowData: false, serverId: null }), deps);
    expect(recorded).toEqual(["run:network-lost:std:none", "run:no-server:std:none"]);
  });

  it("refuses a bad body and counts nothing", async () => {
    const { deps, recorded } = setup();
    expect((await handleOutcome(report({ outcome: "complete" }), deps)).status).toBe(400);
    expect(recorded).toEqual([]);
  });

  it("takes outcomesPerHour reports an hour from one address", async () => {
    const { deps, recorded } = setup();
    const body = { outcome: "complete", lowData: true, serverId: null };
    for (let i = 0; i < ADDRESS_LIMITS.outcomesPerHour; i++) {
      expect((await handleOutcome(report(body), deps)).status).toBe(204);
    }
    expect((await handleOutcome(report(body), deps)).status).toBe(429);
    expect(recorded).toHaveLength(ADDRESS_LIMITS.outcomesPerHour);
  });

  it("answers 204 and counts nothing when there are no stores", async () => {
    const { deps } = setup({ stores: null, record: () => undefined });
    const response = await handleOutcome(
      report({ outcome: "complete", lowData: true, serverId: null }),
      deps,
    );
    expect(response.status).toBe(204);
  });

  it("answers 204 when every Redis call fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down = () => Promise.reject(new Error("redis down"));
    const broken: Kv = {
      setIfAbsent: down,
      get: down,
      countInWindow: down,
      incrementFields: down,
      readFields: down,
    };
    const { deps } = setup({ stores: { kv: broken, salt: kvSaltStore(broken), memory: false } });
    const response = await handleOutcome(
      report({ outcome: "complete", lowData: true, serverId: null }),
      deps,
    );
    expect(response.status).toBe(204);
  });
});
