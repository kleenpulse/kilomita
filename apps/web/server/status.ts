import { OUTCOMES, type Outcome, type StatusData } from "./metrics";

/*
 * What /status shows, from the counters in metrics.ts. Every number is a count of runs or of
 * refusals and errors: nothing about a person, and never a count of shared results (see
 * metrics.ts). Counts come from browsers and are not checked, so the page says so.
 */

export interface Totals {
  /** Server lists handed out: about one per run started. */
  started: number;
  /** Runs whose browser reported how they ended. */
  reported: number;
  completed: number;
  /** Stopped by the visitor, or by leaving the page. */
  stopped: number;
  failed: number;
}

export interface StatusSummary {
  last24h: Totals;
  last30d: Totals;
  /** Every outcome, in a fixed order, over 30 days. */
  outcomes: { outcome: Outcome; count: number }[];
  days: { day: string; started: number; reported: number; completed: number }[];
  servers: { server: string; reported: number; completed: number }[];
  refusals: { reason: string; count: number }[];
  errors: { event: string; code: string; count: number }[];
}

const STOPPED: ReadonlySet<string> = new Set(["cancelled", "hidden"]);

function totals(buckets: readonly Readonly<Record<string, number>>[]): Totals {
  const sum: Totals = { started: 0, reported: 0, completed: 0, stopped: 0, failed: 0 };
  for (const fields of buckets) {
    for (const [name, count] of Object.entries(fields)) {
      const [kind = "", outcome = ""] = name.split(":");
      if (kind === "start") sum.started += count;
      if (kind !== "run") continue;
      sum.reported += count;
      if (outcome === "complete") sum.completed += count;
      else if (STOPPED.has(outcome)) sum.stopped += count;
      else sum.failed += count;
    }
  }
  return sum;
}

function tally(
  buckets: readonly Readonly<Record<string, number>>[],
  keyOf: (parts: string[]) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fields of buckets) {
    for (const [name, count] of Object.entries(fields)) {
      const key = keyOf(name.split(":"));
      if (key !== null) counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }
  return counts;
}

const byCountThenName =
  <T extends { count: number }>(name: (item: T) => string) =>
  (a: T, b: T) =>
    b.count - a.count || name(a).localeCompare(name(b));

export function summarizeStatus({ hours, days }: StatusData): StatusSummary {
  const dayFields = days.map((bucket) => bucket.fields);
  const outcomeCounts = tally(dayFields, ([kind, outcome]) =>
    kind === "run" && outcome !== undefined ? outcome : null,
  );
  const serverCounts = tally(dayFields, ([kind, , , server]) =>
    kind === "run" && server !== undefined ? server : null,
  );
  const serverCompleted = tally(dayFields, ([kind, outcome, , server]) =>
    kind === "run" && outcome === "complete" && server !== undefined ? server : null,
  );
  const refusals = tally(dayFields, ([kind, name]) =>
    (kind === "limited" || kind === "busy") && name !== undefined ? `${kind}:${name}` : null,
  );
  const errors = tally(dayFields, ([kind, event, code]) =>
    kind === "error" && event !== undefined && code !== undefined ? `${event}:${code}` : null,
  );

  return {
    last24h: totals(hours.slice(-24).map((bucket) => bucket.fields)),
    last30d: totals(dayFields),
    outcomes: OUTCOMES.map((outcome) => ({ outcome, count: outcomeCounts.get(outcome) ?? 0 })),
    days: days.map(({ key, fields }) => {
      const day = totals([fields]);
      return { day: key, started: day.started, reported: day.reported, completed: day.completed };
    }),
    servers: [...serverCounts]
      .map(([server, reported]) => ({
        server,
        reported,
        completed: serverCompleted.get(server) ?? 0,
      }))
      .sort((a, b) => b.reported - a.reported || a.server.localeCompare(b.server)),
    refusals: [...refusals]
      .map(([reason, count]) => ({ reason, count }))
      .sort(byCountThenName((item) => item.reason)),
    errors: [...errors]
      .map(([key, count]) => {
        const [event = "", code = ""] = key.split(":");
        return { event, code, count };
      })
      .sort(byCountThenName((item) => `${item.event}:${item.code}`)),
  };
}
