import { SHARING } from "@kilomita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { results } from "./db/schema";
import { IP_HASH_RETENTION_MS, purge } from "./retention";
import type { Stores } from "./stores";
import { resultRow, testStores } from "./testing";

const NOW = Date.UTC(2026, 10, 2, 12);
let stores: Stores;

beforeEach(async () => {
  stores = await testStores(() => NOW);
});

describe("purge", () => {
  it("deletes results past retention and wipes IP hashes past 48 hours", async () => {
    const { db } = stores;
    const at = (ms: number) => new Date(NOW - ms);
    // The promises made on the privacy page, in their own numbers: 48 hours, 12 months.
    const HOUR = 60 * 60 * 1000;
    expect(IP_HASH_RETENTION_MS).toBe(48 * HOUR);
    expect(SHARING.retentionMs).toBe(365 * 24 * HOUR);
    await db
      .insert(results)
      .values([
        resultRow({ ispSlug: "old", createdAt: at(SHARING.retentionMs + 1) }),
        resultRow({ ispSlug: "kept", createdAt: at(SHARING.retentionMs - 1), ipHash: "a" }),
        resultRow({ ispSlug: "recent", createdAt: at(48 * HOUR - 1), ipHash: "b" }),
        resultRow({ ispSlug: "two-days", createdAt: at(48 * HOUR + 1), ipHash: "c" }),
      ]);
    expect(await purge(db, NOW)).toEqual({ deleted: 1, unhashed: 2 });
    const rows = await db.select().from(results).orderBy(results.ispSlug);
    expect(rows.map((row) => [row.ispSlug, row.ipHash])).toEqual([
      ["kept", null],
      ["recent", "b"],
      ["two-days", null],
    ]);
    expect(await purge(db, NOW)).toEqual({ deleted: 0, unhashed: 0 });
  });
});
