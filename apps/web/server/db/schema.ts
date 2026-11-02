import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Shared results. No IP address: ip_hash is an HMAC of the /24 or /48 under that day's random salt,
 * wiped after about 48 hours. Values are checked by the shared zod schemas before they get here.
 */
export const results = pgTable(
  "results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Server time. Every aggregate uses this, never the client's clock. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** The client's own timestamp, kept as sent; not trusted. */
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),

    downloadMbps: doublePrecision("download_mbps").notNull(),
    uploadMbps: doublePrecision("upload_mbps").notNull(),
    idleMedianMs: doublePrecision("idle_median_ms").notNull(),
    idleP95Ms: doublePrecision("idle_p95_ms").notNull(),
    jitterMs: doublePrecision("jitter_ms").notNull(),
    requestLossPct: doublePrecision("request_loss_pct").notNull(),
    loadedDownloadMs: doublePrecision("loaded_download_ms").notNull(),
    loadedUploadMs: doublePrecision("loaded_upload_ms").notNull(),
    grade: text("grade").notNull(),
    bytesUsed: integer("bytes_used").notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    lowData: boolean("low_data").notNull(),
    engineVersion: text("engine_version").notNull(),
    serverId: text("server_id").notNull(),

    ispSlug: text("isp_slug").notNull(),
    stateSlug: text("state_slug"),
    lgaSlug: text("lga_slug"),
    networkType: text("network_type").notNull(),
    deviceClass: text("device_class").notNull(),

    /** SHA-256 of the test token's id: the unique insert is what makes a token one-time. */
    tokenHash: text("token_hash").notNull().unique(),
    /** SHA-256 of the result's own secret, which only the sharing browser holds. */
    ownerHash: text("owner_hash").notNull(),
    ipHash: text("ip_hash"),
    /** null, "duplicate" or "implausible": flagged rows are kept but never aggregated. */
    flag: text("flag"),
  },
  (table) => [
    index("results_created_at_idx").on(table.createdAt),
    index("results_isp_created_at_idx").on(table.ispSlug, table.createdAt),
    index("results_state_created_at_idx").on(table.stateSlug, table.createdAt),
    index("results_owner_hash_idx").on(table.ownerHash),
    index("results_ip_hash_created_at_idx")
      .on(table.ipHash, table.createdAt)
      .where(sql`${table.ipHash} is not null`),
  ],
);

export type ResultRow = typeof results.$inferSelect;
export type NewResultRow = typeof results.$inferInsert;
