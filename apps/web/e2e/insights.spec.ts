import { randomBytes } from "node:crypto";
import { ENGINE_VERSION } from "@kilomita/engine";
import { SOURCE_URL } from "@kilomita/shared";
import { type Page, expect, test } from "@playwright/test";
import {
  FONT_PASSES,
  expectWideFont,
  forceWideFont,
  layoutShifts,
  overflows,
  recordLayoutShifts,
} from "./helpers";

// The e2e server runs memory stores seeded with synthetic demo results (playwright.config.ts).

async function robots(page: Page): Promise<string | null> {
  const meta = page.locator('meta[name="robots"]');
  return (await meta.count()) > 0 ? meta.getAttribute("content") : null;
}
const canonical = (page: Page) => page.locator('link[rel="canonical"]').getAttribute("href");
const ranking = (page: Page) => page.getByRole("list", { name: "Ranking" });

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return scripts.map((text) => JSON.parse(text) as Record<string, unknown>);
}

test("the leaderboard ranks providers, shares places and hides small groups", async ({ page }) => {
  await recordLayoutShifts(page);
  const response = await page.goto("/isps");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ISP speeds in Nigeria");
  await expect(page.getByTestId("source-banner")).toContainText("Sample data.");

  const cards = ranking(page).getByTestId("cell-card");
  expect(await cards.count()).toBeGreaterThan(3);
  // Overlapping ranges share a place ("=2"), and every card has its ranges and a count band.
  await expect(
    ranking(page)
      .getByText(/^=\d+$/)
      .first(),
  ).toBeVisible();
  await expect(cards.first()).toContainText(/\d–\d/);
  await expect(cards.first()).toContainText(/\d[\d,]*(–\d[\d,]*|\+) results/);
  await expect(page.getByText("Few results, read with care").first()).toBeVisible();
  await expect(page.getByTestId("not-enough")).toContainText("ipNX");
  await expect(page.getByTestId("not-enough")).toContainText("FiberOne");

  expect(await canonical(page)).toMatch(/\/isps$/);
  expect(await robots(page)).toBeNull();
  const [dataset] = await jsonLd(page);
  expect(dataset).toMatchObject({ "@type": "Dataset", spatialCoverage: { name: "Nigeria" } });
  // No data licence has been chosen.
  expect(dataset).not.toHaveProperty("license");
  expect(await layoutShifts(page)).toEqual([]);
});

test("the filter form round-trips, and filtered views are not indexed", async ({ page }) => {
  await page.goto("/isps");
  await page.getByLabel("State").selectOption("lagos");
  await page.getByLabel("Period").selectOption("7");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/\/isps\?state=lagos&type=&window=7$/);
  await expect(page.getByText(/in Lagos, last 7 days/)).toBeVisible();
  await expect(page.getByLabel("State")).toHaveValue("lagos");
  expect(await robots(page)).toBe("noindex, follow");
  expect(await canonical(page)).toMatch(/\/isps$/);

  // Every select back on its default ("All", 30 days): empty values mean no filter.
  await page.getByLabel("State").selectOption("");
  await page.getByLabel("Period").selectOption("30");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/\/isps\?state=&type=&window=30$/);
  await expect(page.getByText(/across Nigeria, last 30 days/)).toBeVisible();
});

test("links with tracking parameters still work", async ({ page }) => {
  const response = await page.goto("/isps?fbclid=x&utm_source=whatsapp");
  expect(response?.status()).toBe(200);
  await expect(ranking(page)).toBeVisible();
  expect(await robots(page)).toBe("noindex, follow");
  expect(await canonical(page)).toMatch(/\/isps$/);
});

test("an ISP page shows its trend, time of day, states and connections", async ({ page }) => {
  await recordLayoutShifts(page);
  // A filter for the page's own dimension is ignored.
  expect((await page.goto("/isps/mtn?isp=glo"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("MTN speeds");
  await expect(page.getByTestId("cell-card")).toContainText("Download");
  const charts = page.locator("main").getByRole("img");
  await expect(charts).toHaveCount(2);
  await expect(charts.first()).toHaveAttribute(
    "aria-label",
    /^Download over time: median download/,
  );

  // Before any click: opening a table moves what is below it, as the reader asked.
  expect(await layoutShifts(page)).toEqual([]);
  await page.getByText("Show the numbers").nth(1).click();
  await expect(page.getByRole("rowheader", { name: "18:00–21:00" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lagos" })).toHaveAttribute("href", "/states/lagos");
  await expect(page.getByRole("rowheader", { name: "Satellite" })).toBeVisible();

  const types = (await jsonLd(page)).map((data) => data["@type"]);
  expect(types).toEqual(["Dataset", "BreadcrumbList"]);
});

test("an ISP with too few results says so in every section", async ({ page }) => {
  await page.goto("/isps/fiberone");
  await expect(page.getByText("Not enough results for FiberOne here yet.")).toBeVisible();
  await expect(page.getByText("Not enough results yet to draw this.")).toHaveCount(2);
  await expect(page.getByText("No state has enough results yet.")).toBeVisible();
});

test("every chart takes the same fixed room, drawn or empty", async ({ page }) => {
  const heights = async (path: string) => {
    await page.goto(path);
    return page
      .locator("main")
      .getByRole("img")
      .evaluateAll((charts) => charts.map((chart) => chart.getBoundingClientRect().height));
  };
  // The chart, and the plot inside it: a collapsed plot would leave the chart's box standing.
  const plots = () =>
    page
      .getByTestId("plot")
      .evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect().height));
  expect(await heights("/isps/mtn")).toEqual([164, 164]);
  expect(await plots()).toEqual([128, 128]);
  expect(await heights("/isps/fiberone")).toEqual([164, 164]);
  expect(await plots()).toEqual([128, 128]);
});

test("a result shared through the API reaches the pages (one store per process)", async ({
  page,
  request,
}) => {
  // Next loads route handlers and pages as separate module graphs; with a store per graph, results
  // shared through the API would never show here. ipNX in Sokoto on 2G has no seeded results.
  const tokens = await Promise.all(
    Array.from({ length: 30 }, async () => {
      const response = await request.post("/api/tokens", { data: { lowData: true } });
      return ((await response.json()) as { token: string }).token;
    }),
  );
  await page.waitForTimeout(1_600);
  const statuses = await Promise.all(
    tokens.map(async (token, i) => {
      const response = await request.post("/api/results", {
        data: {
          token,
          secret: randomBytes(32).toString("base64url"),
          result: {
            downloadMbps: 10 + i / 10,
            uploadMbps: 3,
            latency: { idleMedianMs: 50, idleP95Ms: 62, jitterMs: 4, requestLossPct: 0 },
            loadedLatency: { downloadMs: 70, uploadMs: 64, grade: "A" },
            bytesUsed: 9_000_000,
            durationMs: 1_500,
            lowDataMode: true,
            engineVersion: ENGINE_VERSION,
            serverId: "cloudflare",
            measuredAt: new Date().toISOString(),
            ispSlug: "ipnx",
            stateSlug: "sokoto",
            networkType: "2g",
            deviceClass: "mobile",
          },
        },
      });
      return response.status();
    }),
  );
  expect(statuses).toEqual(Array<number>(30).fill(201));
  await page.goto("/isps?state=sokoto&type=2g&window=7");
  await expect(ranking(page).getByRole("link", { name: "ipNX" })).toBeVisible();
});

test("a state page ranks the providers there", async ({ page }) => {
  // Neither the page's own state nor an ISP filter applies on a state page.
  expect((await page.goto("/states/lagos?state=kano&isp=glo"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Internet speeds in Lagos");
  expect(await ranking(page).getByTestId("cell-card").count()).toBeGreaterThan(1);
  await expect(page.getByLabel("State")).toHaveCount(0);

  await page.goto("/states");
  await expect(page.getByRole("heading", { name: "South West" })).toBeVisible();
  await page.getByRole("link", { name: "Lagos" }).click();
  await expect(page).toHaveURL(/\/states\/lagos$/);
});

test("unknown pages and invalid filters are 404s", async ({ request }) => {
  for (const path of [
    "/isps/other",
    "/isps/nope",
    "/states/atlantis",
    "/isps?state=atlantis",
    "/isps?window=14",
    "/states/lagos?type=6g",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("the sitemap lists every page, and robots points to it", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of [
    "/isps",
    "/isps/mtn",
    "/isps/fiberone",
    "/states",
    "/states/fct",
    "/methodology",
    "/privacy",
  ]) {
    expect(sitemap, path).toContain(`${path}</loc>`);
  }
  expect(sitemap).not.toContain("/isps/other");
  const robotsTxt = await (await request.get("/robots.txt")).text();
  expect(robotsTxt).toContain("Sitemap: ");
  expect(robotsTxt).toContain("Disallow: /api/");
  expect(robotsTxt).toContain("Allow: /api/stats/");
});

test("every page links to its source code (AGPL)", async ({ page }) => {
  for (const path of [
    "/",
    "/privacy",
    "/isps",
    "/isps/mtn",
    "/states",
    "/states/lagos",
    "/methodology",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Source code" }), path).toHaveAttribute(
      "href",
      SOURCE_URL,
    );
  }
});

test("privacy and methodology describe the rounding honestly", async ({ page }) => {
  for (const path of ["/privacy", "/methodology"]) {
    await page.goto(path);
    await expect(page.getByText(/Counts appear only as bands/), path).toBeVisible();
    await expect(
      page.getByText(/one real result rounded to 2 significant figures/),
      path,
    ).toBeVisible();
    // The insertion attack: a sender knows how many made-up results they added.
    await expect(
      page.getByText(/most easily by someone who shares made-up results/),
      path,
    ).toBeVisible();
    for (const claim of [
      /never a single result/i,
      /can.t be worked out/i,
      /cannot be worked out/i,
      /impossible/i,
      /never identifies/i,
      /can.t tell how many/i,
    ]) {
      await expect(page.getByText(claim), `${path}: ${String(claim)}`).toHaveCount(0);
    }
  }
  await expect(page.getByText(/not lost network packets \(ICMP\)/)).toBeVisible();
  // Duplicates are caught only when the host gives us the address (CLIENT_IP_HEADER).
  await expect(page.getByText(/where our host tells us the connection.s address/)).toBeVisible();
  await expect(
    page.getByText(/at least 95 times in 100, if the shared results are typical/),
  ).toBeVisible();
});

for (const font of FONT_PASSES) {
  for (const path of ["/isps", "/isps/mtn", "/states/lagos"]) {
    test(`${path} fits at every width, details open or closed${font.title}`, async ({ page }) => {
      await recordLayoutShifts(page);
      if (font.wide) await forceWideFont(page);
      await page.goto(path);
      if (font.wide) await expectWideFont(page);
      expect(await layoutShifts(page)).toEqual([]);
      const main = page.locator("main");
      const sweep = async (state: string) => {
        for (let width = 320; width <= 600; width += 4) {
          await page.setViewportSize({ width, height: 900 });
          expect(await overflows(page, main), `${state} at ${String(width)} px`).toEqual([]);
        }
      };
      await sweep("details closed");
      await page.evaluate(() => {
        for (const details of document.querySelectorAll("details")) details.open = true;
      });
      await sweep("details open");
    });
  }
}
