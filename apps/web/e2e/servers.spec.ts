import type { Page } from "@playwright/test";
import { CLOUDFLARE_HOST, OUR_HOST, REAL_SERVER } from "./mock-endpoint";
import {
  RUN_TIMEOUT,
  expect,
  expectAllRouted,
  layoutShifts,
  mockNetwork,
  setUp,
  startButton,
  test,
} from "./helpers";

/*
 * Server selection end to end. playwright.config.ts offers two servers of ours (the mocked
 * lagos-e2e and the real apps/server on 127.0.0.1:3945) plus the mocked Cloudflare fallback.
 */

test.setTimeout(90_000);

/** Grants sharing and detects a network, so the result is POSTed; returns its serverId. */
async function sharedServerId(page: Page): Promise<() => string | null> {
  let serverId: string | null = null;
  await page.addInitScript(() => {
    localStorage.setItem("kilomita.consent", "granted");
  });
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  await page.route("**/api/results", async (route) => {
    const body = route.request().postDataJSON() as { result: { serverId: string } };
    serverId = body.result.serverId;
    await route.fulfill({ status: 201, json: { id: "00000000-0000-4000-8000-000000000000" } });
  });
  return () => serverId;
}

/** Answers the server list as the deployment would with the Cloudflare fallback switched off. */
async function withoutFallback(page: Page): Promise<void> {
  await page.route("**/api/test-servers", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, fallback: false } });
  });
}

async function run(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page.getByText("Low-data mode").click();
  await startButton(page).click();
}

test("tests against our own server when it answers", async ({ page }) => {
  const stats = await setUp(page);
  const serverId = await sharedServerId(page);
  await run(page);
  await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect.poll(serverId).toBe("lagos-e2e");
  expect(stats.byHost[OUR_HOST]).toBeGreaterThan(0);
  expect(stats.byHost[CLOUDFLARE_HOST]).toBeUndefined();
  expectAllRouted(stats);
});

for (const code of [503, 403]) {
  test(`falls back to Cloudflare when our servers answer ${String(code)}`, async ({ page }) => {
    const stats = await setUp(page, {
      ours: { status: { code, on: ["probe", "download", "upload"] } },
    });
    const serverId = await sharedServerId(page);
    await run(page);
    await expect(page.getByText("Your net don finish test!")).toBeVisible({
      timeout: RUN_TIMEOUT,
    });
    await expect.poll(serverId).toBe("cloudflare");
    expect(stats.byHost[CLOUDFLARE_HOST]).toBeGreaterThan(0);
    expectAllRouted(stats);
  });
}

test("says so when no server answers and there is no fallback", async ({ page }) => {
  const stats = await setUp(page, { ours: { status: { code: 503, on: ["probe"] } } });
  await withoutFallback(page);
  await run(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No test server is reachable right now. Try again later.",
    { timeout: RUN_TIMEOUT },
  );
  expect(stats.byHost[CLOUDFLARE_HOST]).toBeUndefined();
  expect(await layoutShifts(page)).toEqual([]);
});

test("completes a run in the browser against the real test server", async ({ page }) => {
  const stats = await setUp(page, {
    realServer: true,
    ours: { status: { code: 503, on: ["probe"] } },
  });
  const serverId = await sharedServerId(page);
  await run(page);
  await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
  // CORS, the exposed Server-Timing header and the ticket all worked from the Worker.
  await expect.poll(serverId).toBe("local");
  expect(stats.byHost[REAL_SERVER]).toBeGreaterThan(5);
  expect(stats.byHost[CLOUDFLARE_HOST]).toBeUndefined();
});

test("a page on another origin gets nothing from the real server", async ({ page, baseURL }) => {
  // `next dev` blocks its own assets for origins other than localhost (allowedDevOrigins), so the
  // page wouldn't even hydrate there. Production builds (CI mode) are what this checks.
  test.skip(!process.env.CI, "next dev serves its assets to localhost only");
  const stats = await setUp(page, {
    realServer: true,
    ours: { status: { code: 503, on: ["probe"] } },
  });
  await withoutFallback(page);
  // Same app, other origin: the server allows only http://localhost:<port>.
  await run(page, (baseURL ?? "").replace("localhost", "127.0.0.1"));
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No test server is reachable right now.",
    { timeout: RUN_TIMEOUT },
  );
  // The requests did reach the real server; the browser kept the answers from the page.
  expect(stats.byHost[REAL_SERVER]).toBeGreaterThan(0);
});
