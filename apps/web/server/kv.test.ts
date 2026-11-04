import { describe, expect, it } from "vitest";
import { type UpstashClient, memoryKv, upstashKv } from "./kv";

describe("memoryKv", () => {
  it("sets a key once, until it expires", async () => {
    let time = 1_000;
    const kv = memoryKv(() => time);
    expect(await kv.setIfAbsent("a", "1", 2_000)).toBe(true);
    expect(await kv.setIfAbsent("a", "2", 3_000)).toBe(false);
    expect(await kv.get("a")).toBe("1");
    time = 2_000;
    expect(await kv.get("a")).toBeNull();
    expect(await kv.setIfAbsent("a", "3", 3_000)).toBe(true);
  });

  it("counts within a window and starts again after it", async () => {
    let time = 0;
    const kv = memoryKv(() => time);
    expect(await kv.countInWindow("c", 60_000)).toBe(1);
    expect(await kv.countInWindow("c", 60_000)).toBe(2);
    time = 60_000;
    expect(await kv.countInWindow("c", 120_000)).toBe(1);
  });

  it("counts hash fields until the hash expires", async () => {
    let time = 0;
    const kv = memoryKv(() => time);
    expect(await kv.readFields("h")).toEqual({});
    await kv.incrementFields("h", ["a", "b"], 1_000);
    await kv.incrementFields("h", ["a"], 1_000);
    expect(await kv.readFields("h")).toEqual({ a: 2, b: 1 });
    time = 1_000;
    expect(await kv.readFields("h")).toEqual({});
  });
});

describe("upstashKv", () => {
  function fakeRedis() {
    const calls: unknown[][] = [];
    const pipeline = {
      incr(...args: unknown[]) {
        calls.push(["incr", ...args]);
        return pipeline;
      },
      hincrby(...args: unknown[]) {
        calls.push(["hincrby", ...args]);
        return pipeline;
      },
      pexpireat(...args: unknown[]) {
        calls.push(["pexpireat", ...args]);
        return pipeline;
      },
      exec() {
        calls.push(["exec"]);
        return Promise.resolve([7, 1]);
      },
    };
    const redis = {
      set: (...args: unknown[]) => {
        calls.push(["set", ...args]);
        return Promise.resolve(args[0] === "taken" ? null : "OK");
      },
      get: (...args: unknown[]) => {
        calls.push(["get", ...args]);
        return Promise.resolve(args[0] === "missing" ? null : "value");
      },
      pipeline: () => pipeline,
      hgetall: (...args: unknown[]) => {
        calls.push(["hgetall", ...args]);
        return Promise.resolve(args[0] === "missing" ? null : { a: "3", b: "1" });
      },
    };
    return { calls, kv: upstashKv(redis as unknown as UpstashClient) };
  }

  it("sets with NX and an absolute expiry in milliseconds", async () => {
    const { calls, kv } = fakeRedis();
    expect(await kv.setIfAbsent("free", "v", 1_234)).toBe(true);
    expect(await kv.setIfAbsent("taken", "v", 1_234)).toBe(false);
    expect(calls).toEqual([
      ["set", "free", "v", { nx: true, pxat: 1_234 }],
      ["set", "taken", "v", { nx: true, pxat: 1_234 }],
    ]);
  });

  it("reads null for a missing key", async () => {
    const { kv } = fakeRedis();
    expect(await kv.get("missing")).toBeNull();
    expect(await kv.get("there")).toBe("value");
  });

  it("counts with INCR and PEXPIREAT in one round trip", async () => {
    const { calls, kv } = fakeRedis();
    expect(await kv.countInWindow("c", 60_000)).toBe(7);
    expect(calls).toEqual([["incr", "c"], ["pexpireat", "c", 60_000], ["exec"]]);
  });

  it("increments every field and sets the expiry in one round trip", async () => {
    const { calls, kv } = fakeRedis();
    await kv.incrementFields("h", ["a", "b"], 9_000);
    expect(calls).toEqual([
      ["hincrby", "h", "a", 1],
      ["hincrby", "h", "b", 1],
      ["pexpireat", "h", 9_000],
      ["exec"],
    ]);
  });

  it("sends nothing when there is no field to count", async () => {
    const { calls, kv } = fakeRedis();
    await kv.incrementFields("h", [], 9_000);
    expect(calls).toEqual([]);
  });

  it("reads the string counts back as numbers, and nothing for a missing hash", async () => {
    const { kv } = fakeRedis();
    expect(await kv.readFields("there")).toEqual({ a: 3, b: 1 });
    expect(await kv.readFields("missing")).toEqual({});
  });
});
