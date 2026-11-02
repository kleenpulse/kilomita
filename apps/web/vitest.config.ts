import { defineConfig } from "vitest/config";

// Unit tests only: Playwright's e2e files throw under Vitest.
export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    // Integration tests start PGlite (Postgres in WASM) in a hook, once per file. Under turbo's
    // parallel load that alone can take several seconds.
    hookTimeout: 30_000,
  },
});
