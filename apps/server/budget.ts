import { readFileSync, renameSync, writeFileSync } from "node:fs";

/*
 * The monthly transfer budget. Lagos VPS plans throttle the port once the month's allowance is
 * used (to 8-10 Mbps), which would cap every reading and store it as real, so the server stops
 * serving before that. Each UTC day also gets its own slice, so a burst of abuse costs one day,
 * not the rest of the month. Counts payload bytes in both directions; TLS overhead isn't counted.
 */

export interface BudgetState {
  month: string;
  monthBytes: number;
  day: string;
  dayBytes: number;
}

export type BudgetStatus = "ok" | "over-budget" | "over-daily";

/** How far above an even share a single day may go. */
const DAY_HEADROOM = 1.5;

function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Days left in the UTC month, today included. */
function daysLeft(now: number): number {
  const date = new Date(now);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return last - date.getUTCDate() + 1;
}

export class Budget {
  readonly #limit: number | null;
  readonly #now: () => number;
  #state: BudgetState;
  /** Bytes reserved by transfers still running. */
  #inFlight = 0;

  constructor(limit: number | null, now: () => number, saved: BudgetState | null = null) {
    this.#limit = limit;
    this.#now = now;
    const time = now();
    this.#state = saved ?? { month: utcMonth(time), monthBytes: 0, day: utcDay(time), dayBytes: 0 };
    this.#roll();
  }

  #roll(): void {
    const time = this.#now();
    const month = utcMonth(time);
    const day = utcDay(time);
    if (this.#state.month !== month) {
      this.#state = { month, monthBytes: 0, day, dayBytes: 0 };
    } else if (this.#state.day !== day) {
      this.#state = { ...this.#state, day, dayBytes: 0 };
    }
  }

  /** Today's cap: the month's remainder at the start of today, shared over the days left. */
  #dailyCap(limit: number): number {
    const remaining = limit - (this.#state.monthBytes - this.#state.dayBytes);
    return Math.max(0, Math.min(remaining, (remaining / daysLeft(this.#now())) * DAY_HEADROOM));
  }

  #fits(bytes: number): BudgetStatus {
    if (this.#limit === null) return "ok";
    if (this.#state.monthBytes + this.#inFlight + bytes > this.#limit) return "over-budget";
    if (this.#state.dayBytes + this.#inFlight + bytes > this.#dailyCap(this.#limit)) {
      return "over-daily";
    }
    return "ok";
  }

  /** Whether anything may be served now (at least one byte fits). */
  status(): BudgetStatus {
    this.#roll();
    return this.#fits(1);
  }

  /** Holds `bytes` for a transfer about to start; false if they don't fit. */
  reserve(bytes: number): boolean {
    this.#roll();
    if (this.#fits(bytes) !== "ok") return false;
    this.#inFlight += bytes;
    return true;
  }

  /** Ends a reservation and counts what was actually moved. */
  settle(reserved: number, moved: number): void {
    this.#inFlight = Math.max(0, this.#inFlight - reserved);
    this.charge(moved);
  }

  /** Counts bytes moved without a reservation (uploads). */
  charge(bytes: number): void {
    this.#roll();
    this.#state.monthBytes += bytes;
    this.#state.dayBytes += bytes;
  }

  snapshot(): BudgetState {
    this.#roll();
    return { ...this.#state };
  }
}

function isState(value: unknown): value is BudgetState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.month === "string" &&
    /^\d{4}-\d{2}$/.test(state.month) &&
    typeof state.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(state.day) &&
    Number.isSafeInteger(state.monthBytes) &&
    Number.isSafeInteger(state.dayBytes) &&
    (state.monthBytes as number) >= 0 &&
    (state.dayBytes as number) >= 0
  );
}

/** The saved counter, or null when there is none or it can't be read. */
export function loadBudgetState(path: string): BudgetState | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (isState(value)) return value;
  } catch {
    // Falls through to the message below.
  }
  console.error("Budget state file is unreadable; starting the count from zero.");
  return null;
}

export function saveBudgetState(path: string, state: BudgetState): void {
  const { month, monthBytes, day, dayBytes } = state;
  writeFileSync(`${path}.tmp`, JSON.stringify({ month, monthBytes, day, dayBytes }));
  renameSync(`${path}.tmp`, path);
}
