import { createHmac, randomBytes } from "node:crypto";
import { TEST_LIMITS } from "@kilomita/engine/limits";

/*
 * Run tickets for our test servers, which verify them (apps/server/ticket.ts) so they can't be
 * used as a free download sink. Format: k1.<base64url JSON {jti, exp, cap}>.<base64url
 * HMAC-SHA256 of "k1.<payload>">, keyed by KILOMITA_SERVER_TICKET_SECRET. The two sides share no
 * code; both test files pin the same fixed vector.
 */

export interface TicketClaims {
  jti: string;
  exp: number;
  cap: number;
}

/** Long enough for selection plus the longest run, short enough to be useless to hoard. */
export const TICKET_TTL_MS = 120_000;

export function signTicket(key: Uint8Array, claims: TicketClaims): string {
  const { jti, exp, cap } = claims;
  const body = `k1.${Buffer.from(JSON.stringify({ jti, exp, cap })).toString("base64url")}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

/** A fresh ticket for one run, capped at the profile's data cap. */
export function issueTicket(key: Uint8Array, lowData: boolean, now: number): string {
  return signTicket(key, {
    jti: randomBytes(16).toString("base64url"),
    exp: now + TICKET_TTL_MS,
    cap: (lowData ? TEST_LIMITS.lowData : TEST_LIMITS.standard).maxBytes,
  });
}
