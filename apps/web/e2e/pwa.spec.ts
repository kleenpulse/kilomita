import { APP_NAME } from "@kilomita/shared";
import type { Page } from "@playwright/test";
import {
  RUN_TIMEOUT,
  expect,
  expectAllRouted,
  layoutShifts,
  setUp,
  startButton,
  test,
} from "./helpers";

/*
 * The service worker registers in production builds only (CI mode, `next start`), and only when
 * the installed app is open (/?source=pwa). Its scope is "/?", so the speed test's Worker is never
 * behind it.
 */

const production = Boolean(process.env.CI);

test("serves a manifest Chrome can install from, with real PNG icons", async ({
  page,
  request,
}) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(body).toMatchObject({
    name: APP_NAME,
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
  });
  for (const icon of body.icons) {
    const png = await request.get(icon.src);
    expect(png.headers()["content-type"]).toBe("image/png");
    const bytes = await png.body();
    const [width] = icon.sizes.split("x").map(Number);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([width, width]);
  }
  expect(body.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
  expect(body.icons[2]?.purpose).toBe("maskable");

  // Chrome's own installability check: the same signal Lighthouse's old PWA audit read.
  await page.goto("/");
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: unknown[];
  };
  expect(installabilityErrors).toEqual([]);

  // The installed app's start URL points search engines at the bare home page.
  await page.goto("/?source=pwa");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(new URL(canonical ?? "x:").search).toBe("");
  expect(new URL(canonical ?? "x:").pathname).toBe("/");
});

test("says the update needs a reload when the page's test code is gone", async ({ page }) => {
  await setUp(page);
  // What a stale offline copy meets after a deploy: the old build's Worker file no longer exists.
  await page.route(/turbopack-worker|speed-test\.worker/, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/");
  await startButton(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "KiloMita was updated. Reload to run the test.",
    { timeout: RUN_TIMEOUT },
  );
});

test("says the test needs a connection when offline, without sending anything", async ({
  page,
  context,
}) => {
  const stats = await setUp(page);
  await page.goto("/");
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) asked.push(request.url());
  });
  await context.setOffline(true);
  await startButton(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "You're offline. The test needs an internet connection.",
  );
  // Not even a token or the server list: the page knows it's offline and asks nothing.
  expect(asked).toEqual([]);
  expect(stats.issued).toBe(0);
  expect(await layoutShifts(page)).toEqual([]);
  await context.setOffline(false);
});

test.describe("with the service worker allowed", () => {
  test.skip(!production, "the service worker registers in production builds only");
  test.use({ serviceWorkers: "allow" });
  test.setTimeout(90_000);

  const registrations = (page: Page) =>
    page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  const cached = (page: Page) =>
    page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) {
          urls.push(new URL(request.url).pathname);
        }
      }
      return urls;
    });

  test("a plain visit installs no service worker and stores nothing", async ({ page }) => {
    await page.goto("/");
    // Registration would happen once the page is idle (within 5 s); wait past that.
    await page.waitForTimeout(6_000);
    expect(await registrations(page)).toBe(0);
    expect(await cached(page)).toEqual([]);
  });

  test("the installed app opens offline, and stores only the home page and its files", async ({
    page,
    context,
  }) => {
    const stats = await setUp(page);
    await page.goto("/?source=pwa");
    await expect.poll(() => registrations(page), { timeout: 15_000 }).toBe(1);
    // Installing (which stores the home page) can take a moment; wait until the worker is active.
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await navigator.serviceWorker.getRegistrations())[0]?.active?.state,
          ),
        { timeout: 15_000 },
      )
      .toBe("activated");
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    // A full run with the worker in charge of the page: every test request still reaches the
    // mocks, and nothing of the run is stored.
    await page.getByText("Low-data mode").click();
    await startButton(page).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    expectAllRouted(stats);
    const stored = await cached(page);
    expect(stored).toContain("/");
    for (const path of stored) expect(path === "/" || path.startsWith("/_next/static/")).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(APP_NAME);
    await startButton(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "You're offline. The test needs an internet connection.",
    );
    expect(await layoutShifts(page)).toEqual([]);
    await context.setOffline(false);
  });
});
