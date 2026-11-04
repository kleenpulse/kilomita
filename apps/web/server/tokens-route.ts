import { ENGINE_VERSION } from "@kilomita/engine";
import { TokenRequestSchema } from "@kilomita/shared";
import { limitContext, withinRunLimits } from "./address-limits";
import { clientIp } from "./client-ip";
import { json, logFailure, readJson, unavailable } from "./http";
import { LIMITS, allowPerMinute } from "./limits";
import { type Recorder, noRecorder, profileOf } from "./metrics";
import { purgeHourly } from "./retention";
import type { SharingDeps } from "./stores";
import { issueToken } from "./token";

/**
 * POST /api/tokens: a signed one-time token, asked for before every run. Issuing stores nothing.
 * `schedule` runs work after the response (Next's after()); retention piggybacks on it.
 */
export async function handleTokenRequest(
  request: Request,
  { stores, key, now, trustedHeader }: SharingDeps,
  schedule: (task: () => Promise<void>) => void,
  record: Recorder = noRecorder,
): Promise<Response> {
  if (!stores || !key) return unavailable();
  const { memory, kv, db } = stores;
  const time = now();
  const body = await readJson(request, memory);
  if (!body.ok) return body.response;
  const parsed = TokenRequestSchema.safeParse(body.value);
  if (!parsed.success) return json(400, { error: "invalid" }, { memory });
  // Per address first: a refused abuser then never eats into everyone's global ceiling.
  const limits = limitContext(stores, clientIp(request.headers, trustedHeader), time);
  if (!(await withinRunLimits(limits, "tokens"))) {
    record(["limited:tokens"]);
    return json(429, { error: "rate-limited" }, { memory });
  }
  if (!(await allowPerMinute(kv, "tokens", LIMITS.tokensPerMinute, time))) {
    record(["busy:tokens"]);
    return json(429, { error: "busy" }, { memory });
  }
  // After the response, outside guarded(): it needs its own code-only catch.
  schedule(() =>
    purgeHourly(db, kv, time).catch((error: unknown) => {
      logFailure("retention-purge", error);
    }),
  );
  record([`token:${profileOf(parsed.data.lowData)}`]);
  return json(200, issueToken(key, { low: parsed.data.lowData, ev: ENGINE_VERSION }, time), {
    memory,
  });
}
