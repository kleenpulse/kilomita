import { TokenRequestSchema } from "@kilomita/shared";
import { json, readJson } from "./http";
import type { MinuteGuard, TestServerSetup } from "./test-servers";
import { issueTicket } from "./ticket";

export interface TestServerDeps extends TestServerSetup {
  guard: MinuteGuard;
  now: () => number;
}

/**
 * POST /api/test-servers: the servers to choose from for one run, whether the Cloudflare fallback
 * may be used, and a fresh ticket for our servers. Asked for after Start, never on page load.
 */
export async function handleTestServers(request: Request, deps: TestServerDeps): Promise<Response> {
  const body = await readJson(request, false);
  if (!body.ok) return body.response;
  const parsed = TokenRequestSchema.safeParse(body.value);
  if (!parsed.success) return json(400, { error: "invalid" });
  const time = deps.now();
  if (!deps.guard.allow(time)) return json(429, { error: "busy" });

  // Without the ticket secret our servers would refuse every request, so none is offered.
  const servers = deps.key ? deps.config.servers : [];
  const ticket =
    deps.key && servers.length > 0 ? issueTicket(deps.key, parsed.data.lowData, time) : null;
  return json(200, { servers, fallback: deps.config.fallback, ticket });
}
