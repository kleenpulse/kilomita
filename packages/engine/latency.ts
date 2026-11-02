import {
  EngineFailure,
  MAX_CONSECUTIVE_FAILURES,
  RETRY_DELAY_MS,
  type RunContext,
  discardBody,
  linkSignal,
  now,
  retriesExhausted,
  sleep,
  statusError,
} from "./runtime";
import { jitter, median, percentile } from "./stats";

/** Pause between loaded-latency probes. */
const LOADED_PROBE_GAP_MS = 250;
/** Abort reason that marks a probe's own timeout, as opposed to the caller's signal. */
const PROBE_TIMEOUT = Symbol("probe timeout");

export type ProbeOutcome =
  | { kind: "ok"; ms: number }
  | { kind: "timeout"; ms: number }
  /** A network error, or a 5xx with its status. */
  | { kind: "failed"; status?: number }
  /** Cut short by the caller's signal, not by the probe's own timeout. */
  | { kind: "cut" };

/**
 * One latency probe: request sent to response headers, minus the server's reported processing time,
 * never below 0. A 4xx throws, because it ends the run.
 */
export async function probe(
  ctx: RunContext,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const { controller, dispose } = linkSignal(signal);
  const timer = setTimeout(() => {
    controller.abort(PROBE_TIMEOUT);
  }, timeoutMs);
  const sentAt = now();
  try {
    const response = await ctx.fetchFn(ctx.endpoint.latencyUrl(), {
      signal: controller.signal,
      cache: "no-store",
    });
    const elapsed = now() - sentAt;
    await discardBody(response);
    if (!response.ok) {
      const error = statusError(response.status);
      if (error instanceof EngineFailure) throw error;
      return { kind: "failed", status: error.status };
    }
    const serverMs = ctx.endpoint.serverTimeMs?.(response.headers) ?? 0;
    return { kind: "ok", ms: Math.max(0, elapsed - serverMs) };
  } catch (error) {
    if (error instanceof EngineFailure) throw error;
    if (controller.signal.reason === PROBE_TIMEOUT) return { kind: "timeout", ms: timeoutMs };
    if (signal.aborted) return { kind: "cut" };
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
    dispose();
  }
}

function failureFrom(outcome: ProbeOutcome | undefined): EngineFailure {
  return retriesExhausted(outcome?.kind === "failed" ? outcome.status : undefined);
}

/**
 * Probes until one succeeds. That first success pays for DNS, TCP and TLS, so it never counts. It
 * may take up to the stall timeout (several round trips on 2G) before the line counts as lost.
 */
async function warmUp(ctx: RunContext): Promise<void> {
  const until = Math.min(now() + ctx.profile.stallTimeoutMs, ctx.deadline);
  let last: ProbeOutcome | undefined;
  let lastFailure: ProbeOutcome | undefined;
  while (now() < until) {
    const outcome = await probe(ctx, until - now(), ctx.signal);
    ctx.signal.throwIfAborted();
    if (outcome.kind === "ok") return;
    last = outcome;
    if (outcome.kind === "failed") {
      lastFailure = outcome;
      await sleep(RETRY_DELAY_MS, ctx.signal);
    }
  }
  // A probe cut short by the end of this window says nothing about the server; an answer does.
  throw failureFrom(lastFailure ?? last);
}

export interface IdleLatency {
  medianMs: number;
  p95Ms: number;
  jitterMs: number;
  /** Share of probes that failed or timed out. HTTP probes, not ICMP packet loss. */
  requestLossPct: number;
}

/**
 * Idle latency, jitter and request loss. `phaseDeadline` is asked after the warm-up, so a slow
 * warm-up doesn't eat the probes' time.
 */
export async function runIdleLatency(
  ctx: RunContext,
  phaseDeadline: () => number,
): Promise<IdleLatency> {
  await warmUp(ctx);
  const deadline = phaseDeadline();
  const samples: number[] = [];
  let sent = 0;
  let last: ProbeOutcome | undefined;

  for (let i = 0; i < ctx.profile.idleProbes; i++) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const timeout = Math.min(ctx.profile.probeTimeoutMs, remaining);
    const outcome = await probe(ctx, timeout, ctx.signal);
    ctx.signal.throwIfAborted();
    // Shortened by the phase deadline rather than a real timeout: not loss, just out of time.
    if (
      outcome.kind === "cut" ||
      (outcome.kind === "timeout" && timeout < ctx.profile.probeTimeoutMs)
    ) {
      break;
    }
    sent++;
    if (outcome.kind === "ok") samples.push(outcome.ms);
    else last = outcome;
    ctx.progress({
      phase: "latency",
      currentMbps: null,
      latencyMs: outcome.kind === "ok" ? outcome.ms : null,
    });
    if (outcome.kind === "failed") await sleep(RETRY_DELAY_MS, ctx.signal);
  }

  if (samples.length === 0) throw failureFrom(last);
  return {
    medianMs: median(samples),
    p95Ms: percentile(samples, 0.95),
    jitterMs: jitter(samples),
    requestLossPct: ((sent - samples.length) / sent) * 100,
  };
}

export interface LoadedSample {
  /** When the probe was sent. */
  at: number;
  ms: number;
}

/**
 * Probes latency, one at a time, while a throughput phase loads the line. A probe that times out
 * counts as the timeout, so heavy bufferbloat can't hide by never answering.
 */
export class LoadedProbes {
  readonly samples: LoadedSample[] = [];
  /** HTTP status of the latest failed probe, if it had one. */
  lastFailureStatus: number | undefined;
  readonly #ctx: RunContext;
  readonly #link: { controller: AbortController; dispose: () => void };
  readonly #loop: Promise<void>;
  #inFlightSince: number | undefined;
  #onFirstSample: (() => void) | undefined;

  constructor(
    ctx: RunContext,
    onSample: (ms: number) => void,
    onFailure: (error: EngineFailure) => void,
  ) {
    this.#ctx = ctx;
    this.#link = linkSignal(ctx.signal);
    this.#loop = this.#run(onSample).catch((error: unknown) => {
      if (error instanceof EngineFailure) onFailure(error);
      else if (!this.#link.controller.signal.aborted) throw error;
    });
  }

  async #run(onSample: (ms: number) => void): Promise<void> {
    const signal = this.#link.controller.signal;
    let failures = 0;
    while (!signal.aborted) {
      const at = now();
      this.#inFlightSince = at;
      const outcome = await probe(this.#ctx, this.#ctx.profile.probeTimeoutMs, signal);
      this.#inFlightSince = undefined;
      if (outcome.kind === "ok" || outcome.kind === "timeout") {
        failures = 0;
        this.samples.push({ at, ms: outcome.ms });
        onSample(outcome.ms);
        this.#onFirstSample?.();
      } else if (outcome.kind === "failed") {
        this.lastFailureStatus = outcome.status;
        // Same rule as transfers: one failure retries, a run of them ends the test.
        if (++failures >= MAX_CONSECUTIVE_FAILURES) throw retriesExhausted(outcome.status);
      }
      await sleep(LOADED_PROBE_GAP_MS, signal);
    }
  }

  /**
   * Ends the loop. With no sample yet, it first waits for one, whether a probe is in flight or the
   * loop is retrying a failed one, but not past `deadline` and not after the loop has ended. A probe
   * still in flight at that point counts at its elapsed time, a lower bound.
   */
  async stop(deadline: number): Promise<void> {
    if (this.samples.length === 0) {
      const firstSample = new Promise<void>((resolve) => {
        this.#onFirstSample = resolve;
      });
      const { controller, dispose } = linkSignal(this.#ctx.signal);
      await Promise.race([firstSample, this.#loop, sleep(deadline - now(), controller.signal)]);
      controller.abort();
      dispose();
      const since = this.#unansweredSince();
      if (since !== undefined) this.samples.push({ at: since, ms: now() - since });
    }
    this.#link.controller.abort();
    this.#link.dispose();
    await this.#loop;
  }

  /** When the probe in flight was sent, if no sample exists yet. */
  #unansweredSince(): number | undefined {
    return this.samples.length === 0 ? this.#inFlightSince : undefined;
  }

  /** Ends the loop at once, for runs that are failing anyway. */
  async abort(): Promise<void> {
    this.#link.controller.abort();
    this.#link.dispose();
    await this.#loop;
  }
}
