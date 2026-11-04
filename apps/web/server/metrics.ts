import { TIMED_OUT, withinBudget } from "./deadline";
import { errorCode, log } from "./http";
import { utcDay } from "./ip-hash";
import type { Kv } from "./kv";

/*
 * Anonymous counters for /status: how runs end, servers handed out, tokens issued, refusals and
 * errors, per UTC hour and day. A counter is a hash field; nothing identifies a person or a
 * result. Shares are never counted here (CLAUDE.md, "Metrics"): an exact count of new shares,
 * or of flagged ones, would tell an attacker what the published count bands hide.
 *
 * Writes are fire-and-forget: they run after the response (Next's after()) and never fail a
 * request, so a Redis outage costs only the counts.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const METRICS_RETENTION_MS = 100 * DAY;
/** A write that takes longer is given up: after() would otherwise keep the function alive on a hang. */
export const METRICS_BUDGET_MS = 2_000;

export const OUTCOMES = Object.freeze([
  "complete",
  "cancelled",
  "hidden",
  "offline",
  "network-lost",
  "endpoint-error",
  "no-server",
  "crashed",
  "stale",
] as const);
export type Outcome = (typeof OUTCOMES)[number];

/** Called with the counter names to add one to; it schedules the write and returns at once. */
export type Recorder = (fields: readonly string[]) => void;
export const noRecorder: Recorder = () => undefined;

export const hourKey = (ms: number) => `m:h:${new Date(ms).toISOString().slice(0, 13)}`;
export const dayKey = (ms: number) => `m:d:${utcDay(ms)}`;

export const profileOf = (lowData: boolean) => (lowData ? "low" : "std");

/** Error codes come from drivers and the runtime; anything unusual is folded into "other". */
export function failureField(event: string, code: string): string {
  return `error:${event}:${/^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "other"}`;
}

/** Adds one to each field in this hour's and today's hash. Never rejects. */
export async function recordEvents(kv: Kv, fields: readonly string[], now: number): Promise<void> {
  if (fields.length === 0) return;
  const expires = now + METRICS_RETENTION_MS;
  try {
    const written = await withinBudget(
      Promise.all([
        kv.incrementFields(hourKey(now), fields, expires),
        kv.incrementFields(dayKey(now), fields, expires),
      ]),
      METRICS_BUDGET_MS,
    );
    if (written === TIMED_OUT) log("warn", "metrics-write", { code: "timeout" });
  } catch (error) {
    log("warn", "metrics-write", { code: errorCode(error) });
  }
}

/** A Recorder that runs each write through `schedule` (Next's after() in the routes). */
export function recorder(
  kv: Kv | null | undefined,
  schedule: (task: () => Promise<void>) => void,
  now: () => number = Date.now,
): Recorder {
  if (!kv) return noRecorder;
  return (fields) => {
    if (fields.length === 0) return;
    const time = now();
    schedule(() => recordEvents(kv, fields, time));
  };
}

export interface StatusBucket {
  /** "2026-11-04T13" for an hour, "2026-11-04" for a day. */
  key: string;
  fields: Readonly<Record<string, number>>;
}

export interface StatusData {
  hours: StatusBucket[];
  days: StatusBucket[];
}

/** The last 24 hours and 30 days, oldest first. 54 hash reads. */
export async function readStatus(kv: Kv, now: number): Promise<StatusData> {
  const hourStarts = Array.from({ length: 24 }, (_, i) => now - (23 - i) * HOUR);
  const dayStarts = Array.from({ length: 30 }, (_, i) => now - (29 - i) * DAY);
  const [hours, days] = await Promise.all([
    Promise.all(
      hourStarts.map(async (ms) => ({
        key: new Date(ms).toISOString().slice(0, 13),
        fields: await kv.readFields(hourKey(ms)),
      })),
    ),
    Promise.all(
      dayStarts.map(async (ms) => ({ key: utcDay(ms), fields: await kv.readFields(dayKey(ms)) })),
    ),
  ]);
  return { hours, days };
}
