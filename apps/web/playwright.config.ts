import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
/** The real apps/server, started below. e2e/mock-endpoint.ts answers it with 503 by default. */
const serverPort = 3945;
// Throwaway keys per run, so no secret is committed. The web app signs run tickets with the same
// key the e2e test server checks them with.
const ticketSecret = randomBytes(32).toString("base64");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Most specs run without a service worker; e2e/pwa.spec.ts allows it where it is the subject.
    serviceWorkers: "block",
    launchOptions: {
      // Fence: nothing resolves except this machine, so a request that no e2e mock routes fails
      // instead of reaching Cloudflare, a future test server or anything else. The rules match
      // IP literals too (127.0.0.1 fails without its EXCLUDE). The fence fixture in
      // e2e/helpers.ts also aborts and records anything that isn't this machine.
      args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
    },
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: isCI ? "bun run start" : "bun run dev",
      // Ready only once the sharing stores are up: the first request loads PGlite (WASM) and
      // runs the migrations, which can outlast the page's 3 s token timeout.
      url: `${baseURL}/api/stats/isp`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        // Shared results go to PGlite and an in-memory Redis twin in the server process: e2e
        // never reaches Neon or Upstash.
        KILOMITA_STORES: "memory",
        // Synthetic demo results (memory mode only), so the insight pages have every case to show.
        KILOMITA_SEED: "demo",
        RESULT_TOKEN_SECRET: randomBytes(32).toString("base64"),
        // Our mocked server first, the real local one second (503 unless a test lets it through),
        // and the mocked Cloudflare fallback.
        KILOMITA_TEST_SERVERS: `lagos-e2e=https://lagos-e2e.kilomita.test,local=http://127.0.0.1:${String(serverPort)}`,
        KILOMITA_CLOUDFLARE_FALLBACK: "on",
        KILOMITA_SERVER_TICKET_SECRET: ticketSecret,
      },
    },
    {
      command: "bun --filter @kilomita/server start",
      url: `http://127.0.0.1:${String(serverPort)}/health`,
      // Never reused: an older server would hold another run's ticket key.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(serverPort),
        KILOMITA_SERVER_ORIGINS: baseURL,
        KILOMITA_SERVER_TICKET_SECRET: ticketSecret,
      },
    },
  ],
});
