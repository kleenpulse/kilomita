import { APP_NAME, SOURCE_URL } from "@kilomita/shared";
import { expect, test } from "./helpers";

test("home page renders the brand and links to the source", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(APP_NAME);
  await expect(page.getByRole("link", { name: "Source code" })).toHaveAttribute("href", SOURCE_URL);
  expect(consoleErrors).toEqual([]);
});

// The DNS fence is the backstop if a route is ever missing; checked here without any network use.
test("launches the browser with every hostname but localhost fenced off", () => {
  expect(test.info().project.use.launchOptions?.args).toContain(
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  );
});

test("records and refuses a request to a host no mock answers", async ({ page, unrouted }) => {
  await page.goto("/");
  const outcome = await page.evaluate(() =>
    fetch("http://203.0.113.9/").then(
      () => "answered",
      () => "refused",
    ),
  );
  expect(outcome).toBe("refused");
  expect(unrouted).toEqual(["http://203.0.113.9"]);
  // The fixture would fail this test for it; it was expected here.
  unrouted.length = 0;
});

test("links to the privacy page and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  await expect(page.getByText(/Nothing from your test is stored on our servers/)).toBeVisible();
  await expect(page.getByText(/receives your IP address with every request/)).toBeVisible();
  // An IPv6 /48 can be one home or office: the page must not claim the code never identifies.
  await expect(page.getByText(/can belong to a single home or office/)).toBeVisible();
  // The NDPA notice lists everything a shared result keeps, its time included.
  await expect(page.getByText(/when the test ran/)).toBeVisible();
  await expect(page.getByText(/never identifies/)).toHaveCount(0);
  // Phase 6: each claim below is backed by a test (server logs, share links, the offline copy).
  await expect(
    page.getByText(/Our test servers don.t keep a record of your IP address/),
  ).toBeVisible();
  await expect(page.getByText(/The company hosting them carries the traffic/)).toBeVisible();
  await expect(page.getByText(/may use Cloudflare.s speed test servers instead/)).toBeVisible();
  await expect(
    page.getByText(
      /The link itself carries the numbers, network and state shown on your result, and the day of the test/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Visiting the website without installing it stores no such copy/),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Back to the test" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});

test("/api/network detects nothing and trusts no header by default", async ({ request }) => {
  const response = await request.get("/api/network", {
    headers: { "x-forwarded-for": "102.88.85.10", "x-real-ip": "102.88.85.10" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ isp: null, state: null });
});
