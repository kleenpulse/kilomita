import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { expandIpv6, normaliseIp } from "./ip-address";
import type { Kv } from "./kv";

/*
 * The hashed IP prefix stored with a shared result (Phase 4). An IPv4 /24 is usually shared by
 * many users (CGNAT), but an IPv6 /48 can be a single customer (RIPE-690 recommends a /48 per end
 * user), so within a day the hash can link one connection's results. The privacy page says so.
 *
 * The salt is random per UTC day. Nothing derives it, so once a day's salt is gone its hashes
 * can't be brute-forced back to a prefix (there are only 2^24 IPv4 /24s) or linked to another
 * day's. kvSaltStore's key expires at the next UTC midnight, so Redis deletes it when the day
 * ends (a 48 h TTL would not: the consent copy promises it can't be traced back after a day).
 * memorySaltStore only replaces it on the first use of a new day.
 */

const SALT_BYTES = 32;

/** IPv4 → /24, IPv6 → /48. IPv4-mapped IPv6 counts as IPv4. */
export function ipPrefix(raw: string): string {
  const ip = normaliseIp(raw);
  if (ip === null) throw new TypeError("Not an IP address");
  if (isIP(ip) === 4) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  return `${expandIpv6(ip).slice(0, 3).join(":")}::/48`;
}

export function hashIpPrefix(ip: string, salt: Uint8Array): string {
  if (salt.byteLength !== SALT_BYTES) {
    throw new RangeError(`The salt must be ${String(SALT_BYTES)} bytes`);
  }
  return createHmac("sha256", salt).update(ipPrefix(ip)).digest("hex");
}

export interface SaltStore {
  /** Today's salt (UTC), created at random on first use. There is no way to ask for another day. */
  saltForToday(): Promise<Uint8Array>;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Keeps only today's salt, in this process. For tests and a single dev server. */
export function memorySaltStore(now: () => number = Date.now): SaltStore {
  let current: { day: string; salt: Uint8Array } | null = null;
  return {
    saltForToday() {
      const day = utcDay(now());
      if (current?.day !== day) current = { day, salt: new Uint8Array(randomBytes(SALT_BYTES)) };
      return Promise.resolve(current.salt);
    },
  };
}

export function nextUtcMidnight(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** Today's salt in the shared store, so every server process hashes alike. */
export function kvSaltStore(kv: Kv, now: () => number = Date.now): SaltStore {
  return {
    async saltForToday() {
      // Twice at most: the key can expire between the two calls if they straddle midnight.
      for (let attempt = 0; attempt < 2; attempt++) {
        const time = now();
        const key = `salt:${utcDay(time)}`;
        const fresh = Buffer.from(randomBytes(SALT_BYTES)).toString("base64");
        // Whoever sets it first wins; everyone then reads the winner's salt.
        await kv.setIfAbsent(key, fresh, nextUtcMidnight(time));
        const stored = await kv.get(key);
        if (stored === null) continue;
        const salt = new Uint8Array(Buffer.from(stored, "base64"));
        if (salt.byteLength !== SALT_BYTES) throw new RangeError("The stored salt is malformed");
        return salt;
      }
      throw new Error("The salt store returned nothing");
    },
  };
}
