import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TICKET_TTL_MS, issueTicket, signTicket } from "./ticket";
import { tokenKey } from "./token";

// The same vector is pinned in apps/server/ticket.test.ts, so this signer and the server's
// verifier can't drift apart without one of the two failing.
const VECTOR = {
  secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  claims: { jti: "AAAAAAAAAAAAAAAAAAAAAA", exp: 1_800_000_000_000, cap: 50_000_000 },
  ticket:
    "k1.eyJqdGkiOiJBQUFBQUFBQUFBQUFBQUFBQUFBQUFBIiwiZXhwIjoxODAwMDAwMDAwMDAwLCJjYXAiOjUwMDAwMDAwfQ.1tphoG47nnRpiI_so5WGYCGOHhUsBfYthhVnY-uYn14",
};

const key = tokenKey(VECTOR.secret);
if (!key) throw new Error("vector key");

function claimsOf(ticket: string): unknown {
  const [, payload] = ticket.split(".");
  return JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
}

describe("tickets", () => {
  it("signs the shared fixed vector", () => {
    expect(signTicket(key, VECTOR.claims)).toBe(VECTOR.ticket);
  });

  it.each([
    [false, 50_000_000],
    [true, 10_000_000],
  ])("issues a fresh ticket (low-data %s) capped at the profile's data cap", (lowData, cap) => {
    const now = 1_000_000;
    const ticket = issueTicket(key, lowData, now);
    const claims = claimsOf(ticket) as { jti: string; exp: number; cap: number };
    expect(claims.cap).toBe(cap);
    expect(claims.exp).toBe(now + TICKET_TTL_MS);
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const [prefix, payload, signature] = ticket.split(".");
    expect(prefix).toBe("k1");
    expect(signature).toBe(
      createHmac("sha256", key)
        .update(`k1.${payload ?? ""}`)
        .digest("base64url"),
    );
    expect(issueTicket(key, lowData, now)).not.toBe(ticket);
  });

  it("puts nothing in a ticket but its id, expiry and cap", () => {
    const claims = claimsOf(issueTicket(key, false, 0)) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(["cap", "exp", "jti"]);
  });
});
