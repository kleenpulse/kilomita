import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Run tickets. The web app signs one per run (apps/web/server/ticket.ts); a test server only
 * verifies them, so a bare curl loop or another site can't use it as a free download sink.
 * Format: k1.<base64url JSON {jti, exp, cap}>.<base64url HMAC-SHA256 of "k1.<payload>">.
 * The two sides share no code; both test files pin the same fixed vector.
 */

export interface TicketClaims {
  /** 16 random bytes, base64url. */
  jti: string;
  /** Expiry, ms since the epoch. */
  exp: number;
  /** Payload bytes this ticket may move, both directions together. */
  cap: number;
}

const KEY_BYTES = 32;
const PREFIX = "k1";

/** The key from KILOMITA_SERVER_TICKET_SECRET (base64 of exactly 32 bytes), or null. */
export function ticketKey(raw: string | undefined): Uint8Array | null {
  const value = raw?.trim();
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.byteLength === KEY_BYTES ? new Uint8Array(key) : null;
}

function isClaims(value: unknown): value is TicketClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.jti === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(claims.jti) &&
    Number.isSafeInteger(claims.exp) &&
    Number.isSafeInteger(claims.cap) &&
    (claims.cap as number) > 0
  );
}

/** The ticket's claims if it is signed with `key` and not yet expired, otherwise null. */
export function verifyTicket(key: Uint8Array, ticket: string, now: number): TicketClaims | null {
  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [prefix, payload, signature] = parts as [string, string, string];
  const expected = Buffer.from(
    createHmac("sha256", key).update(`${prefix}.${payload}`).digest("base64url"),
  );
  const given = Buffer.from(signature);
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isClaims(claims) || now >= claims.exp) return null;
  return claims;
}

/** Bytes moved per ticket, in memory only, forgotten once the ticket has expired. */
export class TicketLedger {
  readonly #used = new Map<string, { bytes: number; exp: number }>();

  /** Adds `bytes` to the ticket's count if that stays within its cap. */
  charge(claims: TicketClaims, bytes: number): boolean {
    const entry = this.#used.get(claims.jti) ?? { bytes: 0, exp: claims.exp };
    if (entry.bytes + bytes > claims.cap) return false;
    entry.bytes += bytes;
    this.#used.set(claims.jti, entry);
    return true;
  }

  refund(claims: TicketClaims, bytes: number): void {
    const entry = this.#used.get(claims.jti);
    if (entry) entry.bytes = Math.max(0, entry.bytes - bytes);
  }

  prune(now: number): void {
    for (const [jti, entry] of this.#used) if (now >= entry.exp) this.#used.delete(jti);
  }

  get size(): number {
    return this.#used.size;
  }
}
