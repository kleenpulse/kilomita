import { ENGINE_VERSION } from "@kilomita/engine";
import { TokenRequestSchema } from "@kilomita/shared";
import { json, logFailure, readJson, unavailable } from "./http";
import { LIMITS, allowPerMinute } from "./limits";
import { purgeHourly } from "./retention";
import type { SharingDeps } from "./stores";
import { issueToken } from "./token";

/**
 * POST /api/tokens: a signed one-time token, asked for before every run. Issuing stores nothing.
 * `schedule` runs work after the response (Next's after()); retention piggybacks on it.
 */
export async function handleTokenRequest(
  request: Request,
  { stores, key, now }: SharingDeps,
  schedule: (task: () => Promise<void>) => void,
): Promise<Response> {
  if (!stores || !key) return unavailable();
  const { memory, kv, db } = stores;
  const time = now();
  const body = await readJson(request, memory);
  if (!body.ok) return body.response;
  const parsed = TokenRequestSchema.safeParse(body.value);
  if (!parsed.success) return json(400, { error: "invalid" }, { memory });
  if (!(await allowPerMinute(kv, "tokens", LIMITS.tokensPerMinute, time))) {
    return json(429, { error: "busy" }, { memory });
  }
  // After the response, outside guarded(): it needs its own code-only catch.
  schedule(() =>
    purgeHourly(db, kv, time).catch((error: unknown) => {
      logFailure("Retention purge", error);
    }),
  );
  return json(200, issueToken(key, { low: parsed.data.lowData, ev: ENGINE_VERSION }, time), {
    memory,
  });
}
