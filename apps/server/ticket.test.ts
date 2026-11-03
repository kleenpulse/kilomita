import { describe, expect, it } from "vitest";
import { signTicket } from "./testing.ts";
import { TicketLedger, ticketKey, verifyTicket } from "./ticket.ts";

// The same vector is pinned in apps/web/server/ticket.test.ts, so the signer and this verifier
// can't drift apart without one of the two failing.
const VECTOR = {
  secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  claims: { jti: "AAAAAAAAAAAAAAAAAAAAAA", exp: 1_800_000_000_000, cap: 50_000_000 },
  ticket:
    "k1.eyJqdGkiOiJBQUFBQUFBQUFBQUFBQUFBQUFBQUFBIiwiZXhwIjoxODAwMDAwMDAwMDAwLCJjYXAiOjUwMDAwMDAwfQ.1tphoG47nnRpiI_so5WGYCGOHhUsBfYthhVnY-uYn14",
};

const key = ticketKey(VECTOR.secret);
if (!key) throw new Error("vector key");
const before = VECTOR.claims.exp - 1;

describe("ticketKey", () => {
  it("accepts exactly 32 bytes of base64", () => {
    expect(ticketKey(VECTOR.secret)).toHaveLength(32);
    expect(ticketKey(undefined)).toBeNull();
    expect(ticketKey("")).toBeNull();
    expect(ticketKey(Buffer.alloc(31).toString("base64"))).toBeNull();
    expect(ticketKey(Buffer.alloc(33).toString("base64"))).toBeNull();
    expect(ticketKey("not base64!")).toBeNull();
  });
});

describe("verifyTicket", () => {
  it("verifies the shared fixed vector", () => {
    expect(signTicket(key, VECTOR.claims)).toBe(VECTOR.ticket);
    expect(verifyTicket(key, VECTOR.ticket, before)).toEqual(VECTOR.claims);
  });

  it("refuses an expired ticket", () => {
    expect(verifyTicket(key, VECTOR.ticket, VECTOR.claims.exp)).toBeNull();
  });

  it("refuses a ticket signed with another key", () => {
    const other = new Uint8Array(32).fill(7);
    expect(verifyTicket(other, VECTOR.ticket, before)).toBeNull();
  });

  it("refuses tampered tickets", () => {
    const [prefix, payload, signature] = VECTOR.ticket.split(".") as [string, string, string];
    const bigger = Buffer.from(JSON.stringify({ ...VECTOR.claims, cap: 1e12 })).toString(
      "base64url",
    );
    expect(verifyTicket(key, `${prefix}.${bigger}.${signature}`, before)).toBeNull();
    expect(verifyTicket(key, `v1.${payload}.${signature}`, before)).toBeNull();
    expect(verifyTicket(key, `${prefix}.${payload}.${signature.slice(1)}`, before)).toBeNull();
    expect(verifyTicket(key, `${prefix}.${payload}`, before)).toBeNull();
    expect(verifyTicket(key, "", before)).toBeNull();
  });

  it("refuses well-signed payloads that aren't claims", () => {
    for (const claims of [
      { ...VECTOR.claims, jti: "short" },
      { ...VECTOR.claims, cap: 0 },
      { ...VECTOR.claims, cap: 1.5 },
      { jti: VECTOR.claims.jti, exp: VECTOR.claims.exp },
    ]) {
      expect(verifyTicket(key, signTicket(key, claims as never), before)).toBeNull();
    }
  });
});

describe("TicketLedger", () => {
  const claims = { jti: "BBBBBBBBBBBBBBBBBBBBBB", exp: 1_000, cap: 100 };

  it("enforces the cap across requests and refunds unsent bytes", () => {
    const ledger = new TicketLedger();
    expect(ledger.charge(claims, 60)).toBe(true);
    expect(ledger.charge(claims, 41)).toBe(false);
    expect(ledger.charge(claims, 40)).toBe(true);
    expect(ledger.charge(claims, 1)).toBe(false);
    ledger.refund(claims, 30);
    expect(ledger.charge(claims, 30)).toBe(true);
  });

  it("forgets expired tickets", () => {
    const ledger = new TicketLedger();
    ledger.charge(claims, 1);
    ledger.prune(999);
    expect(ledger.size).toBe(1);
    ledger.prune(1_000);
    expect(ledger.size).toBe(0);
  });
});
