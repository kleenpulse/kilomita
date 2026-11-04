import { describe, expect, it } from "vitest";
import { OUTCOMES, type StatusData } from "./metrics";
import { summarizeStatus } from "./status";

const empty = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${String(i)}`, fields: {} }));

function data(
  hourFields: Record<string, number>[],
  dayFields: Record<string, number>[],
): StatusData {
  const hours = empty(24, "h");
  const days = empty(30, "d");
  hourFields.forEach((fields, i) => {
    hours[hours.length - 1 - i] = { key: `h-last-${String(i)}`, fields };
  });
  dayFields.forEach((fields, i) => {
    days[days.length - 1 - i] = { key: `d-last-${String(i)}`, fields };
  });
  return { hours, days };
}

describe("summarizeStatus", () => {
  const today = {
    "start:std": 10,
    "start:low": 2,
    "token:std": 9,
    "run:complete:std:lagos-1": 7,
    "run:complete:low:none": 1,
    "run:hidden:std:none": 1,
    "run:cancelled:low:none": 1,
    "run:network-lost:std:lagos-1": 2,
    "limited:servers": 3,
    "busy:tokens": 1,
    "error:results-submit:57P01": 2,
    "error:tokens:ECONNREFUSED": 1,
  };

  it("adds up starts and how runs ended", () => {
    const summary = summarizeStatus(
      data([today], [today, { "start:std": 5, "run:complete:std:lagos-1": 5 }]),
    );
    expect(summary.last24h).toEqual({
      started: 12,
      reported: 12,
      completed: 8,
      stopped: 2,
      failed: 2,
    });
    expect(summary.last30d).toEqual({
      started: 17,
      reported: 17,
      completed: 13,
      stopped: 2,
      failed: 2,
    });
  });

  it("lists every outcome in a fixed order, zeros included", () => {
    const { outcomes } = summarizeStatus(data([], [today]));
    expect(outcomes.map((row) => row.outcome)).toEqual([...OUTCOMES]);
    expect(outcomes.find((row) => row.outcome === "complete")?.count).toBe(8);
    expect(outcomes.find((row) => row.outcome === "stale")?.count).toBe(0);
  });

  it("breaks runs down by server, refusals by reason and errors by code", () => {
    const summary = summarizeStatus(data([], [today]));
    expect(summary.servers).toEqual([
      { server: "lagos-1", reported: 9, completed: 7 },
      { server: "none", reported: 3, completed: 1 },
    ]);
    expect(summary.refusals).toEqual([
      { reason: "limited:servers", count: 3 },
      { reason: "busy:tokens", count: 1 },
    ]);
    expect(summary.errors).toEqual([
      { event: "results-submit", code: "57P01", count: 2 },
      { event: "tokens", code: "ECONNREFUSED", count: 1 },
    ]);
  });

  it("gives one row per day, oldest first", () => {
    const { days } = summarizeStatus(data([], [today]));
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ day: "d-last-0", started: 12, reported: 12, completed: 8 });
    expect(days[0]).toEqual({ day: "d0", started: 0, reported: 0, completed: 0 });
  });

  it("ignores token counts and any field it doesn't know", () => {
    const { last30d } = summarizeStatus(
      data([], [{ "token:std": 50, "share:accepted": 4, odd: 1 }]),
    );
    expect(last30d).toEqual({ started: 0, reported: 0, completed: 0, stopped: 0, failed: 0 });
  });
});
