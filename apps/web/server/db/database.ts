import { join } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Either driver: postgres.js against Neon in production, PGlite in tests and memory mode. */
export type Db = PgDatabase<PgQueryResultHKT>;

/**
 * Resolved from the working directory, not this file: under `next start` the compiled server code
 * lives in .next, away from the SQL. Every entry point (next, vitest, bun scripts) runs from
 * apps/web.
 */
export function migrationsFolder(): string {
  return join(process.cwd(), "server", "db", "migrations");
}

/** A fresh in-memory Postgres (WASM) with every migration applied. Never for production. */
export async function memoryDatabase(): Promise<Db> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

/** Postgres over TCP. prepare: false, because Neon's pooled endpoint (PgBouncer) can't keep them. */
export async function postgresDatabase(url: string) {
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  return drizzle({ client: postgres(url, { max: 5, prepare: false }) });
}
