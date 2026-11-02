import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SHARING } from "@kilomita/shared";

/*
 * Test tokens: issued before a run, consumed by the one insert that stores its result (the jti's
 * hash is a unique column), so a token shares exactly one result. Issuing stores nothing.
 * Format: v1.<base64url JSON payload>.<base64url HMAC-SHA256 of "v1.<payload>">.
 */

export interface TokenClaims {
  /** 16 random bytes, base64url. */
  jti: string;
  /** Issued at, server time in ms. */
  iat: number;
  /** The run's low-data mode, fixed at Start. */
  low: boolean;
  /** The engine version the page was built with. */
  ev: string;
}

const KEY_BYTES = 32;
const PREFIX = "v1";
/** Tolerated clock difference between server instances. */
const SKEW_MS = 60_000;

/** The signing key from RESULT_TOKEN_SECRET (base64 of exactly 32 bytes), or null if unusable. */
export function tokenKey(raw: string | undefined): Uint8Array | null {
  const value = raw?.trim();
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.byteLength === KEY_BYTES ? new Uint8Array(key) : null;
}

function sign(key: Uint8Array, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function issueToken(
  key: Uint8Array,
  claims: Pick<TokenClaims, "low" | "ev">,
  now: number,
): { token: string; expiresAt: number } {
  const payload: TokenClaims = {
    jti: randomBytes(16).toString("base64url"),
    iat: now,
    low: claims.low,
    ev: claims.ev,
  };
  const body = `${PREFIX}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return { token: `${body}.${sign(key, body)}`, expiresAt: now + SHARING.tokenTtlMs };
}

export type TokenCheck =
  { ok: true; claims: TokenClaims } | { ok: false; reason: "invalid" | "expired" };

function isClaims(value: unknown): value is TokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.jti === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(claims.jti) &&
    typeof claims.iat === "number" &&
    Number.isFinite(claims.iat) &&
    typeof claims.low === "boolean" &&
    typeof claims.ev === "string"
  );
}

export function verifyToken(key: Uint8Array, token: string, now: number): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "invalid" };
  const [prefix, payload, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(key, `${prefix}.${payload}`));
  const given = Buffer.from(signature);
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!isClaims(claims) || claims.iat > now + SKEW_MS) return { ok: false, reason: "invalid" };
  if (now >= claims.iat + SHARING.tokenTtlMs) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

/** What the database stores to make a token one-time: never the jti itself. */
export function tokenHash(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}

/** A result's owner proof, as stored: SHA-256 of its secret. */
export function ownerHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
