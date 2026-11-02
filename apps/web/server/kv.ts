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
  };
}

export type UpstashClient = Pick<Redis, "set" | "get" | "pipeline">;

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
  };
}
