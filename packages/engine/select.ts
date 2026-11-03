import type { TestEndpoint } from "./endpoint";
import { probe, type ProbeOutcome } from "./latency";
import { EngineFailure, RETRY_DELAY_MS, type RunContext, now, sleep } from "./runtime";
import { median } from "./stats";

/** Timed probes per candidate when there is more than one. */
const SELECTION_PROBES = 2;
/** 503 means the server is full or over its budget: try elsewhere at once. */
const UNAVAILABLE = 503;

export interface Selection {
  endpoint: TestEndpoint;
  /** Whether its connection is already set up, so the latency phase can skip its warm-up. */
  warmedUp: boolean;
}

type Warmed = "ok" | "refused" | "unreachable";

/**
 * Sets up a connection to one candidate. A 4xx or 503 drops it at once; network errors and other
 * 5xx are retried until `until`.
 */
async function warmUp(ctx: RunContext, until: number): Promise<Warmed> {
  while (now() < until) {
    let outcome: ProbeOutcome;
    try {
      outcome = await probe(ctx, until - now(), ctx.signal);
    } catch (error) {
      if (error instanceof EngineFailure) return "refused";
      throw error;
    }
    ctx.signal.throwIfAborted();
    if (outcome.kind === "ok") return "ok";
    if (outcome.kind === "failed") {
      if (outcome.status === UNAVAILABLE) return "refused";
      await sleep(RETRY_DELAY_MS, ctx.signal);
    }
  }
  return "unreachable";
}

/**
 * Picks the server to test against: the candidates are warmed up in parallel; if more than one
 * answers, each gets a few timed probes, one at a time in turn so they don't queue behind each
 * other on a thin line, and the lowest median wins (ties by list order). If none is usable, the
 * fallback is used. Selection probes never count as latency samples or loss.
 */
export async function selectEndpoint(
  base: RunContext,
  candidates: readonly TestEndpoint[],
  fallback: TestEndpoint | undefined,
): Promise<Selection> {
  const until = Math.min(now() + base.profile.stallTimeoutMs, base.deadline);
  const contexts = candidates.map((endpoint) => ({ ...base, endpoint }));
  const warmed = await Promise.all(contexts.map((ctx) => warmUp(ctx, until)));
  const alive = contexts.filter((_, i) => warmed[i] === "ok");
  let refused = warmed.includes("refused");

  if (alive.length === 1 && alive[0]) return { endpoint: alive[0].endpoint, warmedUp: true };
  if (alive.length > 1) {
    const samples = alive.map((): number[] => []);
    const dropped = new Set<number>();
    rounds: for (let round = 0; round < SELECTION_PROBES; round++) {
      for (const [i, ctx] of alive.entries()) {
        if (dropped.has(i)) continue;
        const remaining = until - now();
        if (remaining <= 0) break rounds;
        const timeout = Math.min(base.profile.probeTimeoutMs, remaining);
        let outcome: ProbeOutcome;
        try {
          outcome = await probe(ctx, timeout, base.signal);
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
          dropped.add(i);
          continue;
        }
        base.signal.throwIfAborted();
        if (outcome.kind === "ok") samples[i]?.push(outcome.ms);
        else if (outcome.kind === "timeout" && timeout === base.profile.probeTimeoutMs) {
          samples[i]?.push(outcome.ms);
        } else if (outcome.kind === "failed" && outcome.status === UNAVAILABLE) dropped.add(i);
      }
    }
    if (dropped.size > 0) refused = true;
    const ranked = alive
      .map((ctx, i) => {
        const own = samples[i] ?? [];
        return { ctx, i, score: own.length > 0 ? median(own) : Infinity };
      })
      .filter(({ i }) => !dropped.has(i))
      .sort((a, b) => a.score - b.score || a.i - b.i);
    const best = ranked[0];
    if (best) return { endpoint: best.ctx.endpoint, warmedUp: true };
  }

  if (fallback) return { endpoint: fallback, warmedUp: false };
  // No answer at all looks like the visitor's own connection; refusals mean our servers.
  if (!refused) throw new EngineFailure("network-lost", "The connection was lost.");
  throw new EngineFailure("no-server", "No test server is available.");
}
