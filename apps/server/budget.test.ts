import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget, loadBudgetState, saveBudgetState } from "./budget.ts";

const GB = 1e9;
let time = 0;
const clock = () => time;
const at = (iso: string) => {
  time = Date.parse(iso);
};

describe("Budget", () => {
  it("always allows without a limit", () => {
    at("2026-11-03T12:00:00Z");
    const budget = new Budget(null, clock);
    expect(budget.reserve(1e15)).toBe(true);
    expect(budget.status()).toBe("ok");
  });

  it("gives each day a slice, so a burst costs one day and not the month", () => {
    // 30 days in November: on the 1st, 900 GB / 30 days × 1.5 = 45 GB.
    at("2026-11-01T00:00:00Z");
    const budget = new Budget(900 * GB, clock);
    expect(budget.reserve(45 * GB)).toBe(true);
    budget.settle(45 * GB, 45 * GB);
    expect(budget.status()).toBe("over-daily");
    expect(budget.reserve(1)).toBe(false);

    at("2026-11-02T00:00:00Z");
    expect(budget.status()).toBe("ok");
    // 855 GB left over 29 days × 1.5.
    const today = (855 * GB * 1.5) / 29;
    expect(budget.reserve(Math.floor(today))).toBe(true);
    expect(budget.reserve(2)).toBe(false);
  });

  it("stops everything once the month is used up, until the next month", () => {
    at("2026-11-30T08:00:00Z");
    const budget = new Budget(900 * GB, clock, {
      month: "2026-11",
      monthBytes: 899 * GB,
      day: "2026-11-30",
      dayBytes: 0,
    });
    // The last day may use exactly what is left, never more.
    expect(budget.reserve(1 * GB + 1)).toBe(false);
    expect(budget.reserve(1 * GB)).toBe(true);
    budget.settle(1 * GB, 1 * GB);
    expect(budget.status()).toBe("over-budget");

    at("2026-12-01T00:00:00Z");
    expect(budget.status()).toBe("ok");
    expect(budget.snapshot()).toEqual({
      month: "2026-12",
      monthBytes: 0,
      day: "2026-12-01",
      dayBytes: 0,
    });
  });

  it("counts reservations still in flight, so parallel transfers can't overshoot", () => {
    at("2026-11-30T08:00:00Z");
    const budget = new Budget(100, clock);
    expect(budget.reserve(60)).toBe(true);
    expect(budget.reserve(60)).toBe(false);
    budget.settle(60, 10);
    expect(budget.reserve(90)).toBe(true);
    expect(budget.snapshot().monthBytes).toBe(10);
  });

  it("counts uploads as they arrive", () => {
    at("2026-11-30T08:00:00Z");
    const budget = new Budget(100, clock);
    budget.charge(100);
    expect(budget.status()).toBe("over-budget");
  });
});

describe("budget state file", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("survives a restart and holds nothing but the four counters", () => {
    dir = mkdtempSync(join(tmpdir(), "kilomita-budget-"));
    const path = join(dir, "egress.json");
    at("2026-11-03T12:00:00Z");
    const first = new Budget(900 * GB, clock);
    first.charge(1234);
    saveBudgetState(path, first.snapshot());
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")) as object).sort()).toEqual([
      "day",
      "dayBytes",
      "month",
      "monthBytes",
    ]);

    const second = new Budget(900 * GB, clock, loadBudgetState(path));
    expect(second.snapshot().monthBytes).toBe(1234);
  });

  it("starts from zero on a missing or corrupt file", () => {
    dir = mkdtempSync(join(tmpdir(), "kilomita-budget-"));
    const path = join(dir, "egress.json");
    expect(loadBudgetState(path)).toBeNull();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    writeFileSync(path, "{ not json");
    expect(loadBudgetState(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ month: "2026-11", monthBytes: -5 }));
    expect(loadBudgetState(path)).toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
