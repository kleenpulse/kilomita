import { type Db, memoryDatabase, postgresDatabase } from "./db/database";
import { logFailure } from "./http";
import { type SaltStore, kvSaltStore } from "./ip-hash";
import { type Kv, memoryKv, upstashKv } from "./kv";
import { tokenKey } from "./token";

export interface Stores {
  db: Db;
  kv: Kv;
  salt: SaltStore;
  /** PGlite and an in-process Redis twin: everything is lost on restart. Dev and e2e only. */
  memory: boolean;
}

export interface SharingDeps {
  /** null when the services aren't configured: sharing answers 503, the test still works. */
  stores: Stores | null;
  /** null when RESULT_TOKEN_SECRET is missing or malformed. */
  key: Uint8Array | null;
  trustedHeader: string | undefined;
  now: () => number;
}

type Env = Record<string, string | undefined>;

async function createStores(env: Env): Promise<Stores | null> {
  if (env.KILOMITA_STORES === "memory") {
    console.warn(
      "KILOMITA_STORES=memory: shared results live in this process and vanish on restart. Never use it in production.",
    );
    const kv = memoryKv();
    return { db: await memoryDatabase(), kv, salt: kvSaltStore(kv), memory: true };
  }
  const url = env.DATABASE_URL?.trim();
  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !redisUrl || !redisToken) return null;
  const { Redis } = await import("@upstash/redis");
  const kv = upstashKv(
    new Redis({
      url: redisUrl,
      token: redisToken,
      // Salts are base64 strings; never let the client parse them as JSON.
      automaticDeserialization: false,
      enableTelemetry: false,
    }),
  );
  return { db: await postgresDatabase(url), kv, salt: kvSaltStore(kv), memory: false };
}

let pending: Promise<Stores | null> | undefined;

/** One set of stores per process, created on first use. Nothing connects at import time. */
export function getStores(env: Env = process.env): Promise<Stores | null> {
  pending ??= createStores(env).catch((error: unknown) => {
    pending = undefined;
    logFailure("Starting the sharing stores", error);
    return null;
  });
  return pending;
}

export async function sharingDeps(env: Env = process.env): Promise<SharingDeps> {
  return {
    stores: await getStores(env),
    key: tokenKey(env.RESULT_TOKEN_SECRET),
    trustedHeader: env.CLIENT_IP_HEADER,
    now: Date.now,
  };
}
