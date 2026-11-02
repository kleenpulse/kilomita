import {
  CorrectResultSchema,
  DeleteResultsSchema,
  SHARING,
  SubmitResultSchema,
} from "@kilomita/shared";
import { and, eq, gt, inArray } from "drizzle-orm";
import { clientIp } from "./client-ip";
import { results } from "./db/schema";
import { json, readJson, unavailable } from "./http";
import { hashIpPrefix } from "./ip-hash";
import { LIMITS, allow, allowPerMinute } from "./limits";
import { impossibility, implausible } from "./plausibility";
import type { SharingDeps } from "./stores";
import { ownerHash, tokenHash, verifyToken } from "./token";

const DAY = 24 * 60 * 60 * 1000;

/**
 * POST /api/results: stores one shared result. The browser sends it only when mayShare(consent)
 * holds (lib/share.ts). The insert itself consumes the token (unique token_hash), so a failed
 * insert burns nothing, and a retry after a lost response gets the same id back.
 */
export async function handleSubmit(request: Request, deps: SharingDeps): Promise<Response> {
  const { stores, key, now, trustedHeader } = deps;
  if (!stores || !key) return unavailable();
  const { db, kv, salt, memory } = stores;
  const reply = (status: number, body: unknown) => json(status, body, { memory });
  const time = now();

  const body = await readJson(request, memory);
  if (!body.ok) return body.response;
  // The token first: nothing below may run, or create keys, for a forged one.
  const token = (body.value as { token?: unknown } | null)?.token;
  const check = verifyToken(key, typeof token === "string" ? token : "", time);
  if (!check.ok) return reply(check.reason === "expired" ? 410 : 401, { error: check.reason });
  const { claims } = check;
  const attemptsEnd = claims.iat + SHARING.tokenTtlMs;
  if (!(await allow(kv, `submit:${claims.jti}`, LIMITS.submitAttemptsPerToken, attemptsEnd))) {
    return reply(429, { error: "busy" });
  }

  const parsed = SubmitResultSchema.safeParse(body.value);
  if (!parsed.success) return reply(400, { error: "invalid" });
  const { result, secret } = parsed.data;
  const impossible = impossibility(result, claims, time);
  if (impossible) return reply(422, { error: impossible });

  const ip = clientIp(request.headers, trustedHeader);
  const ipHash = ip === null ? null : hashIpPrefix(ip, await salt.saltForToday());
  const duplicate =
    ipHash !== null &&
    (
      await db
        .select({ id: results.id })
        .from(results)
        .where(
          and(
            eq(results.ipHash, ipHash),
            gt(results.createdAt, new Date(time - DAY)),
            eq(results.downloadMbps, result.downloadMbps),
            eq(results.uploadMbps, result.uploadMbps),
            eq(results.idleMedianMs, result.latency.idleMedianMs),
            eq(results.bytesUsed, result.bytesUsed),
          ),
        )
        .limit(1)
    ).length > 0;

  const owner = ownerHash(secret);
  const consumed = tokenHash(claims.jti);
  const inserted = await db
    .insert(results)
    .values({
      createdAt: new Date(time),
      measuredAt: new Date(result.measuredAt),
      downloadMbps: result.downloadMbps,
      uploadMbps: result.uploadMbps,
      idleMedianMs: result.latency.idleMedianMs,
      idleP95Ms: result.latency.idleP95Ms,
      jitterMs: result.latency.jitterMs,
      requestLossPct: result.latency.requestLossPct,
      loadedDownloadMs: result.loadedLatency.downloadMs,
      loadedUploadMs: result.loadedLatency.uploadMs,
      grade: result.loadedLatency.grade,
      bytesUsed: result.bytesUsed,
      durationMs: result.durationMs,
      lowData: result.lowDataMode,
      engineVersion: result.engineVersion,
      serverId: result.serverId,
      ispSlug: result.ispSlug,
      stateSlug: result.stateSlug ?? null,
      lgaSlug: result.lgaSlug ?? null,
      networkType: result.networkType,
      deviceClass: result.deviceClass,
      tokenHash: consumed,
      ownerHash: owner,
      ipHash,
      flag: duplicate ? "duplicate" : implausible(result),
    })
    .onConflictDoNothing({ target: results.tokenHash })
    .returning({ id: results.id });
  const [row] = inserted;
  if (row) return reply(201, { id: row.id });

  // The token was used already. The same secret means a retry after a lost response.
  const [existing] = await db
    .select({ id: results.id, ownerHash: results.ownerHash })
    .from(results)
    .where(eq(results.tokenHash, consumed))
    .limit(1);
  if (existing?.ownerHash === owner) return reply(200, { id: existing.id });
  return reply(409, { error: "used" });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * PATCH /api/results/:id: the owner corrects network, state or connection type shortly after
 * sharing. Anything that isn't the owner's recent result is a 404, so ids can't be probed.
 */
export async function handleCorrect(
  request: Request,
  id: string,
  { stores, now }: SharingDeps,
): Promise<Response> {
  if (!stores) return unavailable();
  const { db, kv, memory } = stores;
  const reply = (status: number, body: unknown) => json(status, body, { memory });
  const time = now();
  const body = await readJson(request, memory);
  if (!body.ok) return body.response;
  const parsed = CorrectResultSchema.safeParse(body.value);
  if (!parsed.success) return reply(400, { error: "invalid" });
  if (!UUID.test(id)) return reply(404, { error: "not-found" });

  const owned = and(
    eq(results.id, id),
    eq(results.ownerHash, ownerHash(parsed.data.secret)),
    gt(results.createdAt, new Date(time - SHARING.correctionWindowMs)),
  );
  const [found] = await db.select({ id: results.id }).from(results).where(owned).limit(1);
  if (!found) return reply(404, { error: "not-found" });
  // Keyed on a result the caller proved it owns, so strangers can't create keys.
  const windowEnd = time + SHARING.correctionWindowMs;
  if (!(await allow(kv, `correct:${id}`, LIMITS.correctionsPerResult, windowEnd))) {
    return reply(429, { error: "busy" });
  }
  const { ispSlug, stateSlug, networkType } = parsed.data;
  await db
    .update(results)
    .set({
      ...(ispSlug === undefined ? {} : { ispSlug }),
      ...(stateSlug === undefined ? {} : { stateSlug }),
      ...(networkType === undefined ? {} : { networkType }),
      correctedAt: new Date(time),
    })
    .where(owned);
  return reply(200, { id });
}

/** DELETE /api/results: deletes every result whose secret the browser still holds. */
export async function handleDelete(
  request: Request,
  { stores, now }: SharingDeps,
): Promise<Response> {
  if (!stores) return unavailable();
  const { db, kv, memory } = stores;
  const reply = (status: number, body: unknown) => json(status, body, { memory });
  const body = await readJson(request, memory);
  if (!body.ok) return body.response;
  const parsed = DeleteResultsSchema.safeParse(body.value);
  if (!parsed.success) return reply(400, { error: "invalid" });
  if (!(await allowPerMinute(kv, "deletes", LIMITS.deletesPerMinute, now()))) {
    return reply(429, { error: "busy" });
  }
  const deleted = await db
    .delete(results)
    .where(inArray(results.ownerHash, parsed.data.secrets.map(ownerHash)))
    .returning({ id: results.id });
  return reply(200, { deleted: deleted.length });
}
