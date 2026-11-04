import { afterEach, describe, expect, it, vi } from "vitest";
import { type Kv, memoryKv } from "./kv";
import {
  METRICS_RETENTION_MS,
  dayKey,
  failureField,
  hourKey,
  readStatus,
  recordEvents,
  recorder,
} from "./metrics";

const NOW = Date.UTC(2026, 10, 4, 13, 20);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("keys", () => {
  it("names UTC hours and days", () => {
    expect(hourKey(NOW)).toBe("m:h:2026-11-04T13");
    expect(dayKey(NOW)).toBe("m:d:2026-11-04");
  });
});

describe("failureField", () => {
  it("keeps short codes and folds anything else into other", () => {
    expect(failureField("tokens", "ECONNREFUSED")).toBe("error:tokens:ECONNREFUSED");
    expect(failureField("tokens", "42P01")).toBe("error:tokens:42P01");
    expect(failureField("tokens", "connect to db.neon.tech:5432")).toBe("error:tokens:other");
    expect(failureField("tokens", "x".repeat(33))).toBe("error:tokens:other");
  });
});

describe("recordEvents", () => {
  it("adds one per field to this hour's and today's hash, kept 100 days", async () => {
    const kv = memoryKv(() => NOW);
    const spy = vi.spyOn(kv, "incrementFields");
    await recordEvents(kv, ["start:low", "token:low"], NOW);
    expect(spy).toHaveBeenCalledWith(
      hourKey(NOW),
      ["start:low", "token:low"],
      NOW + METRICS_RETENTION_MS,
    );
    expect(spy).toHaveBeenCalledWith(
      dayKey(NOW),
      ["start:low", "token:low"],
      NOW + METRICS_RETENTION_MS,
    );
    expect(await kv.readFields(dayKey(NOW))).toEqual({ "start:low": 1, "token:low": 1 });
  });

  it("never rejects: a failed write is logged by code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: Kv = {
      ...memoryKv(),
      incrementFields: () =>
        Promise.reject(Object.assign(new Error("redis at eu1.upstash.io"), { code: "ETIMEDOUT" })),
    };
    await expect(recordEvents(broken, ["start:low"], NOW)).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).toContain('"event":"metrics-write"');
    expect(JSON.stringify(warn.mock.calls)).not.toContain("upstash.io");
  });
});

describe("recorder", () => {
  it("schedules the write instead of running it on the answer path", async () => {
    const kv = memoryKv(() => NOW);
    const tasks: (() => Promise<void>)[] = [];
    const record = recorder(
      kv,
      (task) => tasks.push(task),
      () => NOW,
    );
    record(["start:std"]);
    expect(await kv.readFields(dayKey(NOW))).toEqual({});
    await Promise.all(tasks.map((task) => task()));
    expect(await kv.readFields(dayKey(NOW))).toEqual({ "start:std": 1 });
  });

  it("does nothing without a store or fields", () => {
    const tasks: unknown[] = [];
    recorder(null, (task) => tasks.push(task))(["start:std"]);
    recorder(memoryKv(), (task) => tasks.push(task))([]);
    expect(tasks).toEqual([]);
  });
});

describe("readStatus", () => {
  it("reads 24 hours and 30 days, oldest first, ending now", async () => {
    const kv = memoryKv(() => NOW);
    await recordEvents(kv, ["run:complete:low:none"], NOW);
    await recordEvents(kv, ["run:hidden:low:none"], NOW - 3 * 3_600_000);
    const { hours, days } = await readStatus(kv, NOW);
    expect(hours).toHaveLength(24);
    expect(days).toHaveLength(30);
    expect(hours.at(-1)).toEqual({ key: "2026-11-04T13", fields: { "run:complete:low:none": 1 } });
    expect(hours.at(-4)?.fields).toEqual({ "run:hidden:low:none": 1 });
    expect(days.at(-1)).toEqual({
      key: "2026-11-04",
      fields: { "run:complete:low:none": 1, "run:hidden:low:none": 1 },
    });
    expect(days[0]?.key).toBe("2026-10-06");
  });
});
