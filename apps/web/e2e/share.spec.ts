import { APP_NAME } from "@kilomita/shared";
import type { Page } from "@playwright/test";
import {
  FONT_PASSES,
  RUN_TIMEOUT,
  expect,
  expectWideFont,
  forceWideFont,
  layoutShifts,
  mockNetwork,
  overflows,
  setUp,
  startButton,
  test,
} from "./helpers";

test.setTimeout(90_000);

const CODE = /\/r\/d[0-9.]+_u[0-9.]+_l\d+_g[A-F]_imtn_slagos_t\d{8}$/;

declare global {
  interface Window {
    shared: { title?: string; text?: string; url?: string }[];
    copied: string[];
    clipboardFails: boolean;
  }
}

/** Replaces the share sheet (or removes it) and the clipboard, recording what they were given. */
async function stubSharing(page: Page, withShareSheet: boolean): Promise<void> {
  await page.addInitScript((sheet) => {
    window.shared = [];
    window.copied = [];
    window.clipboardFails = false;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: sheet
        ? (data: { title?: string; text?: string; url?: string }) => {
            window.shared.push(data);
            return Promise.resolve();
          }
        : undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          if (window.clipboardFails) return Promise.reject(new Error("denied"));
          window.copied.push(text);
          return Promise.resolve();
        },
      },
    });
  }, withShareSheet);
}

async function finishRun(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("Low-data mode").click();
  await startButton(page).click();
  await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
}

const shareButton = (page: Page) => page.getByRole("button", { name: "Share result" });

test("shares a link to a card through the share sheet, with only what is on screen", async ({
  page,
}) => {
  await setUp(page);
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  await stubSharing(page, true);
  await finishRun(page);
  await expect(page.getByTestId("share-status")).toHaveText(
    "Shares a link with your speeds, latency, grade, network, state and the day.",
  );
  await shareButton(page).click();
  const shared = await page.evaluate(() => window.shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]?.url).toMatch(CODE);
  expect(shared[0]?.text).toMatch(/^My speed test: [0-9.]+ Mbps down, [0-9.]+ Mbps up on MTN\.$/);
  // A card shares nothing with our server: no new keys, no sharing consent needed.
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("kilomita.")),
  );
  expect(keys).toEqual(["kilomita.lowData"]);
  expect(await layoutShifts(page)).toEqual([]);
});

test("copies the link where there is no share sheet, and offers WhatsApp", async ({ page }) => {
  await setUp(page);
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  await stubSharing(page, false);
  await finishRun(page);
  await shareButton(page).click();
  await expect(page.getByTestId("share-status")).toHaveText("Link copied. Paste it anywhere.");
  const [copied] = await page.evaluate(() => window.copied);
  expect(copied).toMatch(CODE);
  const href = await page.getByRole("link", { name: "Send it on WhatsApp" }).getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/);
  expect(decodeURIComponent(href ?? "")).toContain(copied ?? "missing");
});

test("the card page shows the shared numbers, isn't indexed and calls no API", async ({
  page,
  request,
}) => {
  await setUp(page);
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  await stubSharing(page, true);
  await finishRun(page);
  await shareButton(page).click();
  const url = new URL((await page.evaluate(() => window.shared[0]?.url)) ?? "");

  const apiCalls: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/")) apiCalls.push(req.url());
  });
  await page.goto(url.pathname);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Mbps download on MTN$/);
  await expect(page.getByText(`Shared by a ${APP_NAME} user, not checked by us.`)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toMatch(/\/card\.png$/);
  expect(apiCalls).toEqual([]);

  const png = await request.get(`${url.pathname}/card.png`);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect(png.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  // Vercel's CDN keeps a Function's answer only with s-maxage or a targeted header (Phase 7).
  expect(png.headers()["vercel-cdn-cache-control"]).toBe("max-age=31536000");
  const bytes = await png.body();
  // PNG IHDR: width and height, big-endian, at bytes 16-23.
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
  expect(bytes.byteLength).toBeLessThan(300_000);
});

test("a code that isn't a card is a 404, and its image isn't cached", async ({ page, request }) => {
  const missing = await page.goto("/r/d23_u5.1_l34_gB_t20991231");
  expect(missing?.status()).toBe(404);
  const image = await request.get("/r/d023_u5.1_l34_gB_t20261103/card.png");
  expect(image.status()).toBe(404);
  expect(image.headers()["cache-control"]).toBe("no-store");
});

for (const font of FONT_PASSES) {
  test(`every share status fits the result area at every width${font.title}`, async ({ page }) => {
    test.setTimeout(150_000);
    await setUp(page);
    await mockNetwork(page, [{ isp: "tizeti", state: "fct" }]);
    await stubSharing(page, false);
    if (font.wide) await forceWideFont(page);
    await page.goto("/");
    if (font.wide) await expectWideFont(page);
    await page.getByText("Low-data mode").click();

    const widths = Array.from({ length: 71 }, (_, i) => 320 + i * 4);
    const area = page.getByTestId("result-area");
    const heights = async () => {
      const result: number[] = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        result.push(await area.evaluate((el) => el.getBoundingClientRect().height));
        expect(await overflows(page), `at ${String(width)} px`).toEqual([]);
      }
      await page.setViewportSize({ width: 412, height: 900 });
      return result;
    };

    const placeholder = await heights();
    await startButton(page).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(shareButton(page)).toBeEnabled();
    expect(await heights()).toEqual(placeholder);
    await shareButton(page).click();
    await expect(page.getByTestId("share-status")).toHaveText("Link copied. Paste it anywhere.");
    expect(await heights()).toEqual(placeholder);
    await page.evaluate(() => {
      window.clipboardFails = true;
    });
    await shareButton(page).click();
    await expect(page.getByTestId("share-status")).toHaveText(
      "Couldn't share from this browser. Try the WhatsApp link.",
    );
    // No layout-shift check here: the sweep's own resizes shift the page. The share-sheet test
    // above checks a steady window.
    expect(await heights()).toEqual(placeholder);
  });
}
