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
