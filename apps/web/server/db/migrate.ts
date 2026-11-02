import { purge } from "../retention";
import { postgresDatabase, migrationsFolder } from "./database";

/*
 * `bun run db:migrate` applies pending migrations to DATABASE_URL, then purges expired data.
 * `bun run db:purge` only purges. Run by the maintainer (Bun loads .env.local), never by CI.
 */

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = await postgresDatabase(url);
if (!process.argv.includes("--purge-only")) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: migrationsFolder() });
  console.log("Migrations applied.");
}
const { deleted, unhashed } = await purge(db, Date.now());
console.log(`Purged ${String(deleted)} expired results and ${String(unhashed)} IP hashes.`);
process.exit(0);
