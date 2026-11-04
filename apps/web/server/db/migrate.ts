import { errorCode } from "../http";
import { purge } from "../retention";
import { postgresDatabase, migrationsFolder } from "./database";

/*
 * `bun run db:migrate` applies pending migrations to DATABASE_URL, then purges expired data.
 * `bun run db:purge` only purges. Run by the maintainer (Bun loads .env.local), never by CI.
 * A failure prints its code only: driver errors carry the database's host and port.
 */

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

try {
  const db = await postgresDatabase(url);
  if (!process.argv.includes("--purge-only")) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder: migrationsFolder() });
    console.log("Migrations applied.");
  }
  const { deleted, unhashed } = await purge(db, Date.now());
  console.log(`Purged ${String(deleted)} expired results and ${String(unhashed)} IP hashes.`);
  process.exit(0);
} catch (error) {
  console.error(`Failed (${errorCode(error)}).`);
  process.exit(1);
}
