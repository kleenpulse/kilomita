import { type Db, memoryDatabase, postgresDatabase } from "./db/database";
import { log, logFailure } from "./http";
import { type SaltStore, kvSaltStore } from "./ip-hash";
import { type Kv, memoryKv, upstashKv } from "./kv";
import { knownServerIds } from "../lib/test-servers";
import { testServerSetup } from "./test-servers";
import { tokenKey } from "./token";

export interface Stores {
  db: Db;
  kv: Kv;
  salt: SaltStore;
  /** PGlite and an in-process Redis twin: everything is lost on restart. Dev and e2e only. */
  memory: boolean;
  /** Memory stores filled with synthetic demo results (KILOMITA_SEED=demo). */
  seeded: boolean;
}

export interface SharingDeps {
  /** null when the services aren't configured: sharing answers 503, the test still works. */
  stores: Stores | null;
  /** null when RESULT_TOKEN_SECRET is missing or malformed. */
  key: Uint8Array | null;
  trustedHeader: string | undefined;
  /** The server ids a result may name (lib/test-servers.ts). */
  knownServers: ReadonlySet<string>;
  now: () => number;
}

type Env = Record<string, string | undefined>;

/** Exported for tests; the app goes through getStores(). */
export async function createStores(env: Env): Promise<Stores | null> {
  if (env.KILOMITA_STORES === "memory") {
    log("warn", "stores-memory", {
      note: "KILOMITA_STORES=memory: shared results live in this process and vanish on restart. Never use it in production.",
    });
    const kv = memoryKv();
    const db = await memoryDatabase();
    // Synthetic rows exist only here: no path writes them to a real database.
    const seeded = env.KILOMITA_SEED === "demo";
    if (seeded) {
      const { seedDemo } = await import("./db/seed");
      log("warn", "stores-seeded", { count: await seedDemo(db, Date.now()) });
    }
    return { db, kv, salt: kvSaltStore(kv), memory: true, seeded };
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
  return {
    db: await postgresDatabase(url),
    kv,
    salt: kvSaltStore(kv),
    memory: false,
    seeded: false,
  };
}

/*
 * Next loads route handlers and pages as separate module graphs, so a module-level variable here
 * would exist twice: two PGlites in memory mode (a result shared through the API would never reach
 * the insight pages), two connection pools in production. The process-wide global is the one copy.
 */
const STORES: unique symbol = Symbol.for("kilomita.stores");
const shared = globalThis as { [STORES]?: Promise<Stores | null> | undefined };

/** One set of stores per process, created on first use. Nothing connects at import time. */
export function getStores(env: Env = process.env): Promise<Stores | null> {
  shared[STORES] ??= createStores(env).catch((error: unknown) => {
    shared[STORES] = undefined;
    logFailure("stores-start", error);
    return null;
  });
  return shared[STORES];
}

export async function sharingDeps(env: Env = process.env): Promise<SharingDeps> {
  return {
    stores: await getStores(env),
    key: tokenKey(env.RESULT_TOKEN_SECRET),
    trustedHeader: env.CLIENT_IP_HEADER,
    knownServers: knownServerIds(testServerSetup(env).config),
    now: Date.now,
  };
}
