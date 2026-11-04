import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { TIMED_OUT, withinBudget } from "./deadline";
import { errorCode, json, log } from "./http";
import { purgeHourly } from "./retention";
import type { Stores } from "./stores";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** Each store gets this long to answer before the check calls it degraded. */
export const HEALTH_BUDGET_MS = 3_000;

/*
 * A good database answer is reused for an hour, on globalThis (routes are separate module
 * graphs): the uptime check calls every 15 minutes, and a `select 1` each time would keep Neon's
 * compute from ever suspending (about 8 hours of compute a day). A failure is reused for only 5
 * minutes, so the check recovers soon after Neon does. Redis is checked on every call.
 */
const DB_CHECK: unique symbol = Symbol.for("kilomita.health-db");
const shared = globalThis as {
  [DB_CHECK]?: WeakMap<object, { at: number; ok: boolean }> | undefined;
};

/** True when the task settles within the budget; logs a failure by code, or as "timeout". */
async function answers(event: string, task: Promise<unknown>): Promise<boolean> {
  try {
    if ((await withinBudget(task, HEALTH_BUDGET_MS)) !== TIMED_OUT) return true;
    log("warn", event, { code: "timeout" });
  } catch (error) {
    log("warn", event, { code: errorCode(error) });
  }
  return false;
}

async function databaseOk(stores: Stores, now: number): Promise<boolean> {
  const memo = (shared[DB_CHECK] ??= new WeakMap());
  const cached = memo.get(stores.db);
  if (cached && now - cached.at < (cached.ok ? HOUR : 5 * MINUTE)) return cached.ok;
  const ok = await answers("health-db", stores.db.execute(sql`select 1`));
  memo.set(stores.db, { at: now, ok });
  return ok;
}

/** GET /api/health: "ok" or "degraded", nothing more. 503 when degraded, so a check can fail. */
export async function handleHealth(stores: Stores | null, now: number): Promise<Response> {
  if (!stores) return json(503, { status: "degraded" });
  const redisOk = await answers("health-redis", stores.kv.get("health"));
  const ok = redisOk && (await databaseOk(stores, now));
  return json(ok ? 200 : 503, { status: ok ? "ok" : "degraded" });
}

function sameSecret(given: string, expected: string): boolean {
  // Hash both, so the comparison is constant time whatever the lengths.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * GET /api/cron/purge: Vercel Cron's daily call, with "Authorization: Bearer $CRON_SECRET".
 * Without the secret configured it never runs. It closes the gap on an idle site, where the
 * purge otherwise runs only when someone asks for a token.
 */
export async function handleCronPurge(
  request: Request,
  stores: Stores | null,
  cronSecret: string | undefined,
  now: number,
): Promise<Response> {
  const secret = cronSecret?.trim();
  if (!secret) return json(503, { error: "unavailable" });
  const given = request.headers.get("authorization") ?? "";
  if (!sameSecret(given, `Bearer ${secret}`)) return json(401, { error: "unauthorised" });
  if (!stores) return json(503, { error: "unavailable" });
  await purgeHourly(stores.db, stores.kv, now);
  return json(200, { status: "done" });
}
