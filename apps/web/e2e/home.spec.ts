import { APP_NAME, SOURCE_URL } from "@kilomita/shared";
import { expect, test } from "@playwright/test";

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
test("launches the browser with the speed test host fenced off", () => {
  expect(test.info().project.use.launchOptions?.args).toContain(
    "--host-resolver-rules=MAP speed.cloudflare.com ~NOTFOUND",
  );
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
  await expect(page.getByText(/never identifies/)).toHaveCount(0);
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
