import type { EngineError } from "@kilomita/engine";

export const LEFT_PAGE_MESSAGE =
  "Test stopped because you left the page. Keep KiloMita open while the test runs.";

export const CRASHED_MESSAGE =
  "The test hit a problem in this browser. Reload the page and try again.";

/** What went wrong, in plain words. A cancelled run has no error message: it is just stopped. */
export function errorMessage(error: Pick<EngineError, "code" | "status">): string {
  if (error.code === "network-lost") {
    return "Your connection dropped during the test. Check your network and try again.";
  }
  const { status } = error;
  if (status === 429) {
    return "The test server is busy right now. Please try again in a few minutes.";
  }
  if (status === 403) {
    return "The test server refused requests from your network. This can happen on some shared or VPN connections. Try again later or on another network.";
  }
  if (status !== undefined && status >= 500) {
    return "The test server had a problem. Please try again shortly.";
  }
  const code = status === undefined ? "" : ` (error ${String(status)})`;
  return `The test server didn't accept the test${code}. Please try again later.`;
}
