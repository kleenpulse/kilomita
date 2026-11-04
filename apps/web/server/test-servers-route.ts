import { TokenRequestSchema } from "@kilomita/shared";
import { limitContext, withinRunLimits } from "./address-limits";
import { clientIp } from "./client-ip";
import { json, readJson } from "./http";
import type { Kv } from "./kv";
import type { SaltStore } from "./ip-hash";
import { type Recorder, noRecorder, profileOf } from "./metrics";
import type { MinuteGuard, TestServerSetup } from "./test-servers";
import { issueTicket } from "./ticket";

export interface TestServerDeps extends TestServerSetup {
  guard: MinuteGuard;
  now: () => number;
  /** For the per-address limits; null (no limits, nothing counted) without the sharing stores. */
  stores: { kv: Kv; salt: SaltStore } | null;
  trustedHeader: string | undefined;
  record?: Recorder;
}

/**
 * POST /api/test-servers: the servers to choose from for one run, whether the Cloudflare fallback
 * may be used, and a fresh ticket for our servers. Asked for after Start, never on page load.
 * Every test needs this answer, so nothing here may depend on Redis being up: the per-address
 * limits fail open and the counters are written after the response.
 */
export async function handleTestServers(request: Request, deps: TestServerDeps): Promise<Response> {
  const record = deps.record ?? noRecorder;
  const body = await readJson(request, false);
  if (!body.ok) return body.response;
  const parsed = TokenRequestSchema.safeParse(body.value);
  if (!parsed.success) return json(400, { error: "invalid" });
  const time = deps.now();
  const limits = limitContext(deps.stores, clientIp(request.headers, deps.trustedHeader), time);
  if (!(await withinRunLimits(limits, "servers"))) {
    record(["limited:servers"]);
    return json(429, { error: "rate-limited" });
  }
  if (!deps.guard.allow(time)) {
    record(["busy:servers"]);
    return json(429, { error: "busy" });
  }

  // Without the ticket secret our servers would refuse every request, so none is offered.
  const servers = deps.key ? deps.config.servers : [];
  const ticket =
    deps.key && servers.length > 0 ? issueTicket(deps.key, parsed.data.lowData, time) : null;
  record([`start:${profileOf(parsed.data.lowData)}`]);
  return json(200, { servers, fallback: deps.config.fallback, ticket });
}
