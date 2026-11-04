import type { Request } from "@playwright/test";
import { RUN_TIMEOUT, expect, setUp, test } from "./helpers";

// Phase 7: security headers, the browser features the share row needs, and the outcome counter.

const PAGES = [
  "/",
  "/privacy",
  "/methodology",
  "/isps",
  "/isps/mtn",
  "/status",
  "/r/d23_u5.1_l34_gB_imtn_slagos_t20261103",
];

test("every page sends the CSP and the hardening headers", async ({ request }) => {
  for (const path of PAGES) {
    const headers = (await request.get(path)).headers();
    const csp = headers["content-security-policy"] ?? "";
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("connect-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).toContain("object-src 'none'");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    // No COOP: it cost about 4 Lighthouse points for little gain here (CLAUDE.md, Phase 7).
    expect(headers["cross-origin-opener-policy"], path).toBeUndefined();
    expect(headers["strict-transport-security"], path).toBe("max-age=63072000");
    expect(headers["permissions-policy"], path).toContain("camera=()");
  }
  const api = (await request.get("/api/stats/isp")).headers();
  expect(api["content-security-policy"]).toContain("default-src 'self'");
  expect(api["x-content-type-options"]).toBe("nosniff");
  expect((await request.get("/sw.js")).headers()["content-security-policy"]).toBe(
    "default-src 'self'",
  );
});

test("static files carry no CSP, so the Worker's own policy can't block the test servers", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).src));
  const chunk = scripts.find((src) => src.includes("/_next/static/"));
  expect(chunk).toBeDefined();
  const headers = (await request.get(new URL(chunk ?? "/").pathname)).headers();
  expect(headers["content-security-policy"]).toBeUndefined();
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test("the share row's browser features stay as allowed as with no policy at all", async ({
  page,
}) => {
  const features = () =>
    page.evaluate(() => {
      const policy = (
        document as unknown as { featurePolicy?: { allowsFeature(feature: string): boolean } }
      ).featurePolicy;
      return {
        share: policy?.allowsFeature("web-share") ?? null,
        clipboard: policy?.allowsFeature("clipboard-write") ?? null,
        camera: policy?.allowsFeature("camera") ?? null,
      };
    });
  await page.goto("/");
  const ours = await features();

  // The same page with the Permissions-Policy header taken off: what the browser allows anyway.
  // Headless desktop Chromium has no Web Share, so web-share is false in both; the unit test on
  // lib/security-headers.ts is what keeps web-share=() out of the header.
  await page.route("/", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["permissions-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto("/");
  const none = await features();

  expect(none.clipboard).toBe(true);
  expect(ours.clipboard).toBe(true);
  expect(ours.share).toBe(none.share);
  expect(none.camera).toBe(true);
  expect(ours.camera).toBe(false);
});

test.describe("the outcome counter", () => {
  test.setTimeout(90_000);

  const outcomeRequests = (page: import("@playwright/test").Page) => {
    const seen: Request[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/outcomes") seen.push(request);
    });
    return seen;
  };

  test("sends exactly one report after a run ends, with exactly three fields", async ({ page }) => {
    await setUp(page, { downMbps: 20, upMbps: 10 });
    const seen = outcomeRequests(page);
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("status")).toHaveText(/Testing upload/, { timeout: RUN_TIMEOUT });
    // Never during a measurement.
    expect(seen).toHaveLength(0);
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect.poll(() => seen.length).toBe(1);
    const [report] = seen;
    expect(report?.method()).toBe("POST");
    expect(report?.postDataJSON()).toEqual({
      outcome: "complete",
      lowData: true,
      serverId: "lagos-e2e",
    });
    expect((await report?.response())?.status()).toBe(204);
    // Nothing more arrives later.
    await page.waitForTimeout(500);
    expect(seen).toHaveLength(1);
  });

  test("counts a stopped run as cancelled, and /status shows the runs", async ({ page }) => {
    await setUp(page, { downMbps: 2, upMbps: 1 });
    const seen = outcomeRequests(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("status")).toHaveText(/Testing download/, { timeout: RUN_TIMEOUT });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]?.postDataJSON()).toEqual({
      outcome: "cancelled",
      lowData: false,
      serverId: null,
    });

    // The counters land after the response, and /status reads them through a 60 s memo, so wait
    // for a fresh process view rather than an exact figure (other specs share this server).
    await expect
      .poll(
        async () => {
          await page.goto("/status");
          const row = page.getByRole("row", { name: /^Stopped by the visitor/ });
          return Number((await row.getByRole("cell").nth(1).textContent()) ?? "0");
        },
        { timeout: 75_000, intervals: [5_000] },
      )
      .toBeGreaterThan(0);
  });
});
