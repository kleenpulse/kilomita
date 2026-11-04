import type { Redis } from "@upstash/redis";

/**
 * The little Redis we need: one-time markers, the day's salt and fixed-window counters. Every key
 * carries an absolute expiry, so nothing accumulates. memoryKv is the twin for tests, dev and e2e.
 */
export interface Kv {
  /** Sets the key only if it is absent; true when this call set it. */
  setIfAbsent(key: string, value: string, expiresAtMs: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  /** Adds one to a counter that disappears at windowEndMs, and returns the new count. */
  countInWindow(key: string, windowEndMs: number): Promise<number>;
  /** Adds one to each field of a hash that disappears at expiresAtMs. */
  incrementFields(key: string, fields: readonly string[], expiresAtMs: number): Promise<void>;
  /** Every field of a hash and its count; empty when the hash is absent. */
  readFields(key: string): Promise<Record<string, number>>;
}

export function memoryKv(now: () => number = Date.now): Kv {
  const entries = new Map<string, { value: string; expiresAtMs: number }>();
  const live = (key: string) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAtMs <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };
  const hashes = new Map<string, { fields: Map<string, number>; expiresAtMs: number }>();
  const liveHash = (key: string) => {
    const hash = hashes.get(key);
    if (hash && hash.expiresAtMs <= now()) {
      hashes.delete(key);
      return undefined;
    }
    return hash;
  };
  return {
    setIfAbsent(key, value, expiresAtMs) {
      if (live(key)) return Promise.resolve(false);
      entries.set(key, { value, expiresAtMs });
      return Promise.resolve(true);
    },
    get(key) {
      return Promise.resolve(live(key)?.value ?? null);
    },
    countInWindow(key, windowEndMs) {
      const count = Number(live(key)?.value ?? 0) + 1;
      entries.set(key, { value: String(count), expiresAtMs: windowEndMs });
      return Promise.resolve(count);
    },
    incrementFields(key, names, expiresAtMs) {
      const fields = liveHash(key)?.fields ?? new Map<string, number>();
      for (const name of names) fields.set(name, (fields.get(name) ?? 0) + 1);
      hashes.set(key, { fields, expiresAtMs });
      return Promise.resolve();
    },
    readFields(key) {
      return Promise.resolve(Object.fromEntries(liveHash(key)?.fields ?? []));
    },
  };
}

export type UpstashClient = Pick<Redis, "set" | "get" | "pipeline" | "hgetall">;

/** The client must be created with automaticDeserialization: false, so values stay strings. */
export function upstashKv(redis: UpstashClient): Kv {
  return {
    async setIfAbsent(key, value, expiresAtMs) {
      return (await redis.set(key, value, { nx: true, pxat: expiresAtMs })) === "OK";
    },
    async get(key) {
      const value = await redis.get<string>(key);
      return value ?? null;
    },
    async countInWindow(key, windowEndMs) {
      const [count] = await redis
        .pipeline()
        .incr(key)
        .pexpireat(key, windowEndMs)
        .exec<[number, number]>();
      return count;
    },
    async incrementFields(key, names, expiresAtMs) {
      if (names.length === 0) return;
      const pipeline = redis.pipeline();
      for (const name of names) pipeline.hincrby(key, name, 1);
      await pipeline.pexpireat(key, expiresAtMs).exec();
    },
    async readFields(key) {
      // With automaticDeserialization off the counts come back as strings.
      const raw = await redis.hgetall<Record<string, string | number>>(key);
      return Object.fromEntries(
        Object.entries(raw ?? {}).map(([name, value]) => [name, Number(value)]),
      );
    },
  };
}
