import { defineConfig } from "vitest/config";

// Unit tests only: Playwright's e2e files throw under Vitest.
export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
