import type { RunOutcome } from "./run-in-worker";

/*
 * How a run ended, sent once after it ends (POST /api/outcomes), so /status can show failure
 * rates. It carries exactly three fields: the outcome code, the profile and the server's id.
 * Never a number from the test, never anything about the visitor, and never during a measurement.
 */

export type OutcomeCode =
  | "complete"
  | "cancelled"
  | "hidden"
  | "offline"
  | "network-lost"
  | "endpoint-error"
  | "no-server"
  | "crashed"
  | "stale";

export interface OutcomeReport {
  outcome: OutcomeCode;
  lowData: boolean;
  serverId: string | null;
}

/** The report for a finished run, or null when there is nobody to tell (the page is unmounting). */
export function outcomeReport(
  outcome: RunOutcome,
  lowData: boolean,
  offline: boolean,
): OutcomeReport | null {
  const report = (code: OutcomeCode, serverId: string | null = null): OutcomeReport => ({
    outcome: code,
    lowData,
    serverId,
  });
  switch (outcome.status) {
    case "complete":
      return report("complete", outcome.result.serverId);
    case "stopped":
      if (outcome.reason === "unmount") return null;
      return report(outcome.reason === "user" ? "cancelled" : outcome.reason);
    case "crashed":
      return report(outcome.loaded ? "crashed" : "stale");
    case "error": {
      const { code } = outcome.error;
      if (code === "network-lost" && offline) return report("offline");
      return report(code);
    }
  }
}

type FetchFn = typeof fetch;
const browserFetch: FetchFn = (input, init) => fetch(input, init);

/** Fire and forget: keepalive lets it outlive a page that closes right after the run. */
export function sendOutcome(report: OutcomeReport, fetchFn: FetchFn = browserFetch): void {
  void fetchFn("/api/outcomes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}
