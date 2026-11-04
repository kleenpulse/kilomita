import { beforeEach, describe, expect, it } from "vitest";
import { GENUINE_RESULT } from "./fixtures";
import { kvSaltStore } from "./ip-hash";
import { type Kv, memoryKv } from "./kv";
import { recordEvents } from "./metrics";
import { handleOutcome } from "./outcomes-route";
import { handleSubmit } from "./results-route";
import { MinuteGuard, TICKETS_PER_MINUTE } from "./test-servers";
import { handleTestServers } from "./test-servers-route";
import { TEST_KEY, jsonRequest, secret, testDeps, testStores } from "./testing";
import { issueToken } from "./token";
import { handleTokenRequest } from "./tokens-route";

/*
 * How many Upstash commands one run costs, so the plan's monthly allowance isn't a surprise
 * (docs/runbook.md quotes these numbers). Each Kv call is counted as the commands upstashKv sends:
 * SET and GET one each, a window count two (INCR, PEXPIREAT), a hash write one per field plus
 * PEXPIREAT, a hash read one.
 */

function counting(kv: Kv) {
  let commands = 0;
  const counted: Kv = {
    setIfAbsent: (...args) => ((commands += 1), kv.setIfAbsent(...args)),
    get: (...args) => ((commands += 1), kv.get(...args)),
    countInWindow: (...args) => ((commands += 2), kv.countInWindow(...args)),
    incrementFields: (key, fields, expires) => (
      (commands += fields.length + 1),
      kv.incrementFields(key, fields, expires)
    ),
    readFields: (...args) => ((commands += 1), kv.readFields(...args)),
  };
  return {
    counted,
    read: () => commands,
    reset: () => {
      commands = 0;
    },
  };
}

const NOW = Date.UTC(2026, 10, 4, 12);
const headers = { "x-real-ip": "102.88.34.10" };

let base: Awaited<ReturnType<typeof testStores>>;
beforeEach(async () => {
  base = await testStores(() => NOW);
});

describe("Upstash commands per run", () => {
  it("costs 25 commands a run without sharing, and 6 more to share, once the day's salt is held", async () => {
    // PGlite starts in the hook (30 s timeout), not here: under parallel load it outlasts 5 s.
    const meter = counting(memoryKv(() => NOW));
    const stores = { ...base, kv: meter.counted, salt: kvSaltStore(meter.counted, () => NOW) };
    const deps = testDeps(stores, () => NOW, "x-real-ip");
    const tasks: (() => Promise<void>)[] = [];
    const record = (fields: readonly string[]) => {
      tasks.push(() => recordEvents(stores.kv, fields, NOW));
    };
    const flush = async () => {
      await Promise.all(tasks.splice(0).map((task) => task()));
    };

    const run = async () => {
      await handleTokenRequest(
        jsonRequest("POST", "/api/tokens", { lowData: true }, headers),
        deps,
        (task) => tasks.push(task),
        record,
      );
      await handleTestServers(
        jsonRequest("POST", "/api/test-servers", { lowData: true }, headers),
        {
          config: { servers: [], fallback: true, warnings: [] },
          key: null,
          guard: new MinuteGuard(TICKETS_PER_MINUTE),
          now: () => NOW,
          stores,
          trustedHeader: "x-real-ip",
          record,
        },
      );
      await handleOutcome(
        jsonRequest(
          "POST",
          "/api/outcomes",
          { outcome: "complete", lowData: true, serverId: null },
          headers,
        ),
        { stores, trustedHeader: "x-real-ip", knownServers: new Set(), record, now: () => NOW },
      );
      await flush();
    };

    // The first run of the day in a process also fetches the salt (SET NX + GET).
    await run();
    meter.reset();
    await run();
    const withoutSharing = meter.read();

    // A token for the fixture's engine version, as the results tests issue one; issuing a token
    // through the route is already counted above.
    const { token } = issueToken(TEST_KEY, { low: true, ev: GENUINE_RESULT.engineVersion }, NOW);
    meter.reset();
    const submitted = await handleSubmit(
      jsonRequest(
        "POST",
        "/api/results",
        { token, secret: secret(), result: GENUINE_RESULT },
        headers,
      ),
      { ...deps, now: () => NOW + 20_000 },
    );
    expect(submitted.status).toBe(201);
    const share = meter.read();

    // Token: 4 (run limits) + 2 (global) + 1 (purge lock) + 4 (counters); server list: 4 + 4;
    // outcome: 2 + 4.
    expect(withoutSharing).toBe(25);
    // Submit: 2 (attempts) + 2 (shares a day) + 2 (the IP hash's salt, not memoised there).
    expect(share).toBe(6);
  });
});
