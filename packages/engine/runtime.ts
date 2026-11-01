import type { TestEndpoint } from "./endpoint";
import type { Profile } from "./profiles";
import type { FetchFn, ProgressEvent } from "./types";

/** Pause before retrying a failed request. */
export const RETRY_DELAY_MS = 250;
/** Failures in a row (network errors or 5xx, with no progress between) that end the run. */
export const MAX_CONSECUTIVE_FAILURES = 4;

export interface RunContext {
  readonly fetchFn: FetchFn;
  readonly endpoint: TestEndpoint;
  readonly profile: Profile;
  /** Aborts when the run is cancelled or ends. */
  readonly signal: AbortSignal;
  /** The hard global deadline, on the `performance.now()` clock. */
  readonly deadline: number;
  /** Payload bytes sent and received so far. */
  readonly usage: { bytes: number };
  progress(event: Pick<ProgressEvent, "phase" | "currentMbps" | "latencyMs">): void;
}

/** A failure that ends the run. */
export class EngineFailure extends Error {
  readonly code: "network-lost" | "endpoint-error";
  readonly status: number | undefined;

  constructor(code: "network-lost" | "endpoint-error", message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A 5xx response: worth a retry, unlike a 4xx. */
export class ServerError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The test server answered ${status}.`);
    this.status = status;
  }
}

/** 4xx ends the run at once (429 is rate limiting, 403 can block a whole network); 5xx is retried. */
export function statusError(status: number): EngineFailure | ServerError {
  if (status >= 400 && status < 500) {
    return new EngineFailure(
      "endpoint-error",
      `The test server refused the request (${status}).`,
      status,
    );
  }
  return new ServerError(status);
}

/** The run-ending failure after retries ran out. */
export function retriesExhausted(lastStatus: number | undefined): EngineFailure {
  return lastStatus === undefined
    ? new EngineFailure("network-lost", "The connection was lost.")
    : new EngineFailure(
        "endpoint-error",
        `The test server kept failing (${lastStatus}).`,
        lastStatus,
      );
}

/**
 * Releases a response body the engine doesn't read. Until then, browsers on HTTP/1.1 and Node keep
 * the connection busy, and later requests queue behind it.
 */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already closed or errored.
  }
}

export function now(): number {
  return performance.now();
}

/** Resolves after `ms`, or at once when `signal` aborts. Never rejects. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Aborts `controller` once `ms` pass without a `touch()`. Call `clear` when the work is done. */
export function watchdog(
  controller: AbortController,
  ms: number,
): { touch: () => void; clear: () => void } {
  const fire = () => {
    controller.abort(
      new DOMException("No progress before the inactivity timeout.", "TimeoutError"),
    );
  };
  let timer = setTimeout(fire, ms);
  return {
    touch: () => {
      clearTimeout(timer);
      timer = setTimeout(fire, ms);
    },
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/** A child controller that aborts with `parent`. Call `dispose` to unhook it. */
export function linkSignal(parent: AbortSignal): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => {
    controller.abort(parent.reason);
  };
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return {
    controller,
    dispose: () => {
      parent.removeEventListener("abort", abort);
    },
  };
}
