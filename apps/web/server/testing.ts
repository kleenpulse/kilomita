import { randomBytes } from "node:crypto";
import type { SpeedTestResult } from "@kilomita/shared";
import { type Db, memoryDatabase } from "./db/database";
import { type NewResultRow, results } from "./db/schema";
import { GENUINE_RESULT } from "./fixtures";
import { kvSaltStore } from "./ip-hash";
import { memoryKv } from "./kv";
import type { SharingDeps, Stores } from "./stores";
import { tokenKey } from "./token";

let database: Promise<Db> | undefined;

/**
 * Integration-test stores: real Postgres (PGlite) with the real migrations, on a test clock. One
 * database per test file (starting PGlite takes seconds), emptied for every test; a fresh Redis
 * twin each time.
 */
export async function testStores(now: () => number): Promise<Stores> {
  database ??= memoryDatabase();
  const db = await database;
  await db.delete(results);
  const kv = memoryKv(now);
  return { db, kv, salt: kvSaltStore(kv, now), memory: false, seeded: false };
}

export const TEST_KEY = tokenKey(randomBytes(32).toString("base64")) ?? new Uint8Array();

export function testDeps(stores: Stores, now: () => number, trustedHeader?: string): SharingDeps {
  return { stores, key: TEST_KEY, trustedHeader, knownServers: new Set(["cloudflare"]), now };
}

export const secret = () => randomBytes(32).toString("base64url");

export function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A stored row, for aggregate and retention tests that don't need the whole submit path. */
export function resultRow(overrides: Partial<NewResultRow> = {}): NewResultRow {
  const result: SpeedTestResult = GENUINE_RESULT;
  return {
    createdAt: new Date(Date.UTC(2026, 10, 2, 12)),
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
    ispSlug: "mtn",
    stateSlug: "lagos",
    networkType: "4g",
    deviceClass: "mobile",
    tokenHash: randomBytes(32).toString("hex"),
    ownerHash: randomBytes(32).toString("hex"),
    ...overrides,
  };
}
