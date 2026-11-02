import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from the schema, offline: `bun run db:generate` never connects to a
// database. Migrations are applied by `bun run db:migrate` (server/db/migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
});
