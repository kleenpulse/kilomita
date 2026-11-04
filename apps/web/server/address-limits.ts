import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { TIMED_OUT, withinBudget } from "./deadline";
import { errorCode, log } from "./http";
import { expandIpv6, normaliseIp } from "./ip-address";
import { type SaltStore, nextUtcMidnight, utcDay } from "./ip-hash";
import type { Kv } from "./kv";

/*
 * Per-address rate limits (Phase 7). They key on an HMAC of the connection's address under the
 * day's random salt (ip-hash.ts), domain-separated from the stored prefix hash, and live in Redis
 * only until their window ends (a day at most). Without CLIENT_IP_HEADER there is no address and
 * no per-address limit.
 *
 * IPv4: the full address. CGNAT puts many people behind one, so the numbers are generous.
 * IPv6: the /64 at these numbers, plus the /48 at WIDE_FACTOR times them. One home with a /56 holds
 * 256 /64s; mobile networks give each device a /64 from big pools, so the /48 tier must stay loose.
 * Neither tier stops a determined attacker with many addresses: these raise the cost, no more.
 *
 * Anyone holding Redis and the day's salt during that day could brute-force an IPv4 address back
 * (2^32 tries), so no copy may claim the key can't identify a connection.
 *
 * Fail open: if Redis fails, or takes longer than LIMIT_BUDGET_MS, the check is skipped (logged by
 * code, or as "timeout"), because a limiter that blocks every test when Redis is down or slow is
 * worse than any attack it stops.
 */

export const ADDRESS_LIMITS = Object.freeze({
  runsPerHour: 60,
  runsPerDay: 300,
  sharesPerDay: 20,
  correctionsPerMinute: 120,
  cardsPerMinute: 300,
  outcomesPerHour: 120,
});
export const WIDE_FACTOR = 10;

export interface AddressKey {
  tier: "addr" | "wide";
  hash: string;
}

function keyed(salt: Uint8Array, label: string): string {
  return createHmac("sha256", salt).update(`rl\0${label}`).digest("hex").slice(0, 32);
}

/** The keys an address counts under: one for IPv4, the /64 and the /48 for IPv6. */
export function addressKeys(raw: string, salt: Uint8Array): AddressKey[] {
  const ip = normaliseIp(raw);
  if (ip === null) throw new TypeError("Not an IP address");
  if (isIP(ip) === 4) return [{ tier: "addr", hash: keyed(salt, `4:${ip}`) }];
  const groups = expandIpv6(ip);
  return [
    { tier: "addr", hash: keyed(salt, `6/64:${groups.slice(0, 4).join(":")}`) },
    { tier: "wide", hash: keyed(salt, `6/48:${groups.slice(0, 3).join(":")}`) },
  ];
}

export type LimitWindow = "minute" | "hour" | "day";

export function windowOf(window: LimitWindow, now: number): { index: string; end: number } {
  if (window === "day") return { index: utcDay(now), end: nextUtcMidnight(now) };
  const size = window === "hour" ? 3_600_000 : 60_000;
  const index = Math.floor(now / size);
  return { index: String(index), end: (index + 1) * size };
}

/*
 * The salt costs two Redis calls; it changes only at UTC midnight, so each process keeps today's
 * copy. On globalThis, keyed by the store, because Next loads routes as separate module graphs.
 */
const SALTS: unique symbol = Symbol.for("kilomita.limit-salts");
const shared = globalThis as {
  [SALTS]?: WeakMap<SaltStore, { day: string; salt: Uint8Array }> | undefined;
};

async function todaysSalt(store: SaltStore, now: number): Promise<Uint8Array> {
  const memo = (shared[SALTS] ??= new WeakMap());
  const day = utcDay(now);
  const cached = memo.get(store);
  if (cached?.day === day) return cached.salt;
  const salt = await store.saltForToday();
  memo.set(store, { day, salt });
  return salt;
}

export interface LimitContext {
  kv: Kv;
  salt: SaltStore;
  /** null without CLIENT_IP_HEADER: no per-address limit applies. */
  ip: string | null;
  now: number;
}

/**
 * The longest a limit check may take. The Upstash client retries a failed call five times with
 * backoff (about 4.3 s) and never times out a hung connection, while the page gives up on the
 * server list after 3 s: without a budget, an Upstash outage would stop every test (mita-93's
 * checkpoint-1 FIX). Past the budget the check is skipped, logged as limit-skipped/timeout.
 */
export const LIMIT_BUDGET_MS = 500;

async function countAndCompare(
  context: LimitContext & { ip: string },
  name: string,
  max: number,
  window: LimitWindow,
): Promise<boolean> {
  const salt = await todaysSalt(context.salt, context.now);
  const { index, end } = windowOf(window, context.now);
  const keys = addressKeys(context.ip, salt);
  const counts = await Promise.all(
    keys.map((key) => context.kv.countInWindow(`rl:${name}:${key.tier}:${key.hash}:${index}`, end)),
  );
  return keys.every(
    (key, i) => (counts[i] ?? 0) <= (key.tier === "wide" ? max * WIDE_FACTOR : max),
  );
}

/**
 * True while every tier of this address is within max for the window; each call counts once.
 * Fails open, and within LIMIT_BUDGET_MS whatever Redis does.
 */
export async function withinAddressLimit(
  context: LimitContext | null,
  name: string,
  max: number,
  window: LimitWindow,
): Promise<boolean> {
  if (!context || context.ip === null) return true;
  try {
    const verdict = await withinBudget(
      countAndCompare({ ...context, ip: context.ip }, name, max, window),
      LIMIT_BUDGET_MS,
    );
    if (verdict === TIMED_OUT) {
      log("warn", "limit-skipped", { code: "timeout" });
      return true;
    }
    return verdict;
  } catch (error) {
    log("warn", "limit-skipped", { code: errorCode(error) });
    return true;
  }
}

/**
 * The run limits, per hour and per UTC day, for one route ("tokens" or "servers"). Both checks
 * run at once, so the worst case is one budget, not two.
 */
export async function withinRunLimits(context: LimitContext | null, route: string) {
  const [hour, day] = await Promise.all([
    withinAddressLimit(context, `${route}-h`, ADDRESS_LIMITS.runsPerHour, "hour"),
    withinAddressLimit(context, `${route}-d`, ADDRESS_LIMITS.runsPerDay, "day"),
  ]);
  return hour && day;
}

/** The context for a request's limits; null (no limits) when there are no stores. */
export function limitContext(
  stores: { kv: Kv; salt: SaltStore } | null,
  ip: string | null,
  now: number,
): LimitContext | null {
  return stores ? { kv: stores.kv, salt: stores.salt, ip, now } : null;
}
