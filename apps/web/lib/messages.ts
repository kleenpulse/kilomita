import type { EngineError } from "@kilomita/engine";

export const LEFT_PAGE_MESSAGE =
  "Test stopped because you left the page. Keep KiloMita open while the test runs.";

export const CRASHED_MESSAGE =
  "The test hit a problem in this browser. Reload the page and try again.";

export const UPDATED_MESSAGE = "KiloMita was updated. Reload to run the test.";

export const OFFLINE_MESSAGE = "You're offline. The test needs an internet connection.";

/** The page couldn't get its server list, so no test traffic was sent. */
export const UNREACHABLE_MESSAGE = "Couldn't reach KiloMita. Check your connection.";

/** This connection's address started too many tests this hour or day (per-address limits). */
export const RATE_LIMITED_MESSAGE =
  "Too many tests from your connection right now. Please try again later.";

// "Later", not "in a few minutes": a server out of its day's budget is back only the next day.
export const NO_SERVER_MESSAGE = "No test server is reachable right now. Try again later.";

/** What went wrong, in plain words. A cancelled run has no error message: it is just stopped. */
export function errorMessage(error: Pick<EngineError, "code" | "status">): string {
  if (error.code === "network-lost") {
    return "Your connection dropped during the test. Check your network and try again.";
  }
  if (error.code === "no-server") return NO_SERVER_MESSAGE;
  const { status } = error;
  if (status === 429) {
    return "The test server is busy right now. Please try again in a few minutes.";
  }
  // From our servers a 403 is usually a run ticket that ran out; from others, a blocked network.
  if (status === 403) {
    return "The test server refused the test. Reload the page and try again. If it keeps happening, try another network.";
  }
  // Our servers answer 503 when they are full or out of the day's data.
  if (status === 503) {
    return "The test server is full right now. Please try again later.";
  }
  if (status !== undefined && status >= 500) {
    return "The test server had a problem. Please try again shortly.";
  }
  const code = status === undefined ? "" : ` (error ${String(status)})`;
  return `The test server didn't accept the test${code}. Please try again later.`;
}
