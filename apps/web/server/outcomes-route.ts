import { ADDRESS_LIMITS, limitContext, withinAddressLimit } from "./address-limits";
import { clientIp } from "./client-ip";
import { json, readJson } from "./http";
import type { SaltStore } from "./ip-hash";
import type { Kv } from "./kv";
import { OUTCOMES, type Outcome, type Recorder, profileOf } from "./metrics";

export interface OutcomeDeps {
  stores: { kv: Kv; salt: SaltStore; memory: boolean } | null;
  trustedHeader: string | undefined;
  /** Configured server ids, plus "cloudflare" while the fallback is on. */
  knownServers: ReadonlySet<string>;
  record: Recorder;
  now: () => number;
}

interface OutcomeReport {
  outcome: Outcome;
  lowData: boolean;
  serverId: string | null;
}

/** Exactly { outcome, lowData, serverId }, nothing more. */
export function parseOutcome(value: unknown): OutcomeReport | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "lowData,outcome,serverId") return null;
  const { outcome, lowData, serverId } = value as Record<string, unknown>;
  if (typeof outcome !== "string" || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return null;
  }
  if (typeof lowData !== "boolean") return null;
  if (serverId !== null && (typeof serverId !== "string" || serverId.length > 32)) return null;
  return { outcome: outcome as Outcome, lowData, serverId };
}

/**
 * POST /api/outcomes: how one run ended, sent once after it ends. It adds one to an hourly and a
 * daily counter (run:<outcome>:<profile>:<server>) and stores nothing else: no row, no IP hash,
 * no numbers from the test. The answer is 204 whether or not the write lands (it happens after
 * the response), so the page never waits on Redis.
 */
export async function handleOutcome(request: Request, deps: OutcomeDeps): Promise<Response> {
  const memory = deps.stores?.memory ?? false;
  const body = await readJson(request, memory);
  if (!body.ok) return body.response;
  const report = parseOutcome(body.value);
  if (!report) return json(400, { error: "invalid" }, { memory });
  const limits = limitContext(
    deps.stores,
    clientIp(request.headers, deps.trustedHeader),
    deps.now(),
  );
  const allowed = await withinAddressLimit(
    limits,
    "outcomes",
    ADDRESS_LIMITS.outcomesPerHour,
    "hour",
  );
  if (!allowed) return json(429, { error: "rate-limited" }, { memory });
  // Only ids we know, so a forged report can't create new counter names.
  const server =
    report.serverId !== null && deps.knownServers.has(report.serverId) ? report.serverId : "none";
  deps.record([`run:${report.outcome}:${profileOf(report.lowData)}:${server}`]);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
