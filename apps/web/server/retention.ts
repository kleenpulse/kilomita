import { SHARING } from "@kilomita/shared";
import { and, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./db/database";
import { results } from "./db/schema";
import type { Kv } from "./kv";

/** The IP-prefix hash is needed only for same-day duplicate checks. */
export const IP_HASH_RETENTION_MS = 48 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Deletes results past retention and wipes IP hashes past 48 hours. */
export async function purge(db: Db, now: number): Promise<{ deleted: number; unhashed: number }> {
  const deleted = await db
    .delete(results)
    .where(lt(results.createdAt, new Date(now - SHARING.retentionMs)))
    .returning({ id: results.id });
  const unhashed = await db
    .update(results)
    .set({ ipHash: null })
    .where(
      and(isNotNull(results.ipHash), lt(results.createdAt, new Date(now - IP_HASH_RETENTION_MS))),
    )
    .returning({ id: results.id });
  return { deleted: deleted.length, unhashed: unhashed.length };
}

/** Purges at most once an hour across every server process. */
export async function purgeHourly(db: Db, kv: Kv, now: number): Promise<void> {
  if (await kv.setIfAbsent("purge-lock", "1", now + HOUR)) await purge(db, now);
}
