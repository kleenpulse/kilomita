import { randomBytes } from "node:crypto";
import { SHARING } from "@kilomita/shared";
import { describe, expect, it } from "vitest";
import { issueToken, ownerHash, tokenHash, tokenKey, verifyToken } from "./token";

const RAW_KEY = randomBytes(32).toString("base64");
const KEY = tokenKey(RAW_KEY) ?? new Uint8Array();
const NOW = Date.UTC(2026, 10, 2, 12);
const claims = { low: true, ev: "0.3.0" };

describe("tokenKey", () => {
  it("takes base64 of exactly 32 bytes and refuses anything else", () => {
    expect(tokenKey(RAW_KEY)?.byteLength).toBe(32);
    expect(tokenKey(` ${RAW_KEY}\n`)?.byteLength).toBe(32);
    expect(tokenKey(undefined)).toBeNull();
    expect(tokenKey("")).toBeNull();
    expect(tokenKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(tokenKey(randomBytes(33).toString("base64"))).toBeNull();
    expect(tokenKey("not base64 at all!")).toBeNull();
    expect(tokenKey("changeme")).toBeNull();
  });
});

describe("issueToken and verifyToken", () => {
  it("round-trips the claims until the token expires", () => {
    const { token, expiresAt } = issueToken(KEY, claims, NOW);
    expect(expiresAt).toBe(NOW + SHARING.tokenTtlMs);
    const check = verifyToken(KEY, token, NOW + 1_000);
    expect(check.ok && check.claims).toMatchObject({ iat: NOW, low: true, ev: "0.3.0" });
    expect(verifyToken(KEY, token, expiresAt - 1).ok).toBe(true);
    expect(verifyToken(KEY, token, expiresAt)).toEqual({ ok: false, reason: "expired" });
  });

  it("gives every token its own id", () => {
    const a = verifyToken(KEY, issueToken(KEY, claims, NOW).token, NOW);
    const b = verifyToken(KEY, issueToken(KEY, claims, NOW).token, NOW);
    expect(a.ok && b.ok && a.claims.jti !== b.claims.jti).toBe(true);
  });

  it("rejects a token signed with another key", () => {
    const other = tokenKey(randomBytes(32).toString("base64")) ?? new Uint8Array();
    const { token } = issueToken(other, claims, NOW);
    expect(verifyToken(KEY, token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token whose claims were edited", () => {
    const { token } = issueToken(KEY, claims, NOW);
    const [prefix, payload, signature] = token.split(".") as [string, string, string];
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString()) as object;
    const forged = Buffer.from(JSON.stringify({ ...edited, low: false })).toString("base64url");
    expect(verifyToken(KEY, `${prefix}.${forged}.${signature}`, NOW).ok).toBe(false);
  });

  it("rejects junk and tokens from the future", () => {
    for (const junk of ["", "v1", "v1.a.b", "v2.a.b", "a.b.c.d", "v1..", "...."]) {
      expect(verifyToken(KEY, junk, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
    const { token } = issueToken(KEY, claims, NOW + 120_000);
    expect(verifyToken(KEY, token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("hashes", () => {
  it("stores neither the token id nor the secret, only their SHA-256", () => {
    expect(tokenHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash("abc")).not.toBe(ownerHash("abd"));
    expect(ownerHash("abc")).toBe(tokenHash("abc"));
  });
});
