import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    launchOptions: {
      // Fence: the speed test host never resolves, so a request the e2e mock doesn't route fails
      // instead of reaching Cloudflare (dev/manual use only; see CLAUDE.md, launch blocker).
      args: ["--host-resolver-rules=MAP speed.cloudflare.com ~NOTFOUND"],
    },
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: isCI ? "bun run start" : "bun run dev",
    // Ready only once the sharing stores are up: the first request loads PGlite (WASM) and runs
    // the migrations, which can outlast the page's 3 s token timeout.
    url: `${baseURL}/api/stats/isp`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      // Shared results go to PGlite and an in-memory Redis twin in the server process: e2e never
      // reaches Neon or Upstash. A throwaway signing key per run, so no secret is committed.
      KILOMITA_STORES: "memory",
      RESULT_TOKEN_SECRET: randomBytes(32).toString("base64"),
    },
  },
});
