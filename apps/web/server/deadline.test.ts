import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMIT_BUDGET_MS, withinRunLimits } from "./address-limits";
import { TIMED_OUT, withinBudget } from "./deadline";
import type { SaltStore } from "./ip-hash";
import { type Kv, memoryKv } from "./kv";
import { METRICS_BUDGET_MS, recordEvents } from "./metrics";
import { MinuteGuard, TICKETS_PER_MINUTE } from "./test-servers";
import { handleTestServers } from "./test-servers-route";
import { jsonRequest } from "./testing";

/*
 * mita-93's checkpoint-1 FIX: the real Upstash client retries a failed call for about 4.3 s and
 * never times out a hung connection, while the page gives up on the server list after 3 s. These
 * tests hang Redis outright and check that the test still gets its servers within the budget.
 */

const NOW = Date.UTC(2026, 10, 4, 12);
const never = <T>() => new Promise<T>(() => undefined);
const fixedSalt: SaltStore = { saltForToday: () => Promise.resolve(new Uint8Array(32).fill(5)) };

/** A Kv whose every call hangs forever, like a dead TCP connection. */
const hungKv: Kv = {
  setIfAbsent: never,
  get: never,
  countInWindow: never,
  incrementFields: never,
  readFields: never,
};

let warnings: string[];

beforeEach(() => {
  // Only the timers: request bodies stream through microtasks and setImmediate.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warnings.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const listRequest = () =>
  jsonRequest("POST", "/api/test-servers", { lowData: true }, { "x-real-ip": "102.88.34.10" });

function serverDeps(stores: { kv: Kv; salt: SaltStore }) {
  return {
    config: {
      servers: [{ id: "lagos-1", origin: "https://lagos-1.kilomita.com.ng" }],
      fallback: false,
      warnings: [],
    },
    key: new Uint8Array(32).fill(9),
    guard: new MinuteGuard(TICKETS_PER_MINUTE),
    now: () => NOW,
    stores,
    trustedHeader: "x-real-ip",
  };
}

async function settled<T>(promise: Promise<T>): Promise<{ done: boolean; value?: T }> {
  let state: { done: boolean; value?: T } = { done: false };
  void promise.then((value) => {
    state = { done: true, value };
  });
  await vi.advanceTimersByTimeAsync(0);
  return state;
}

describe("withinBudget", () => {
  it("answers the task's result, or TIMED_OUT at the deadline, and leaves no timer behind", async () => {
    expect(await withinBudget(Promise.resolve(7), 100)).toBe(7);
    const pending = withinBudget(never<number>(), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(TIMED_OUT);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("with Redis hung", () => {
  it("(a) still hands out servers and a ticket, within the budget, logged as a timeout", async () => {
    const answer = handleTestServers(listRequest(), serverDeps({ kv: hungKv, salt: fixedSalt }));
    expect((await settled(answer)).done).toBe(false);
    await vi.advanceTimersByTimeAsync(LIMIT_BUDGET_MS);
    const response = await answer;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { servers: unknown; ticket: unknown };
    expect(body.servers).toEqual([{ id: "lagos-1", origin: "https://lagos-1.kilomita.com.ng" }]);
    expect(body.ticket).toMatch(/^k1\./);
    expect(
      warnings.some(
        (line) => line.includes('"event":"limit-skipped"') && line.includes('"code":"timeout"'),
      ),
    ).toBe(true);
  });

  it("(b) does the same when the day's salt never arrives", async () => {
    const answer = handleTestServers(
      listRequest(),
      serverDeps({ kv: memoryKv(() => NOW), salt: { saltForToday: never } }),
    );
    await vi.advanceTimersByTimeAsync(LIMIT_BUDGET_MS);
    expect((await answer).status).toBe(200);
  });

  it("(c) the hour and day checks share one budget, not two in a row", async () => {
    const verdict = withinRunLimits(
      { kv: hungKv, salt: fixedSalt, ip: "102.88.34.10", now: NOW },
      "servers",
    );
    await vi.advanceTimersByTimeAsync(LIMIT_BUDGET_MS);
    expect(await settled(verdict)).toEqual({ done: true, value: true });
  });

  it("gives a counter write up after its own budget, so after() never runs on", async () => {
    const write = recordEvents(hungKv, ["start:low"], NOW);
    await vi.advanceTimersByTimeAsync(METRICS_BUDGET_MS - 1);
    expect((await settled(write)).done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await settled(write)).done).toBe(true);
    expect(
      warnings.some(
        (line) => line.includes('"event":"metrics-write"') && line.includes('"code":"timeout"'),
      ),
    ).toBe(true);
  });
});
