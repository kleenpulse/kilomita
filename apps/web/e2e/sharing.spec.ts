import { type Page, type Request, expect, test } from "@playwright/test";
import {
  FONT_PASSES,
  RUN_TIMEOUT,
  expectWideFont,
  forceWideFont,
  layoutShifts,
  mockNetwork,
  overflows,
  setUp,
  startButton,
} from "./helpers";

/*
 * Sharing against the real routes: the e2e server runs with KILOMITA_STORES=memory (PGlite and an
 * in-memory Redis twin), so nothing here reaches Neon or Upstash.
 */

test.setTimeout(120_000);

interface Calls {
  tokens: number;
  posts: number;
  patches: number;
  deletes: number;
  statuses: number[];
}

/** Counts every sharing request the page sends, and the statuses that came back. */
function track(page: Page): Calls {
  const calls: Calls = { tokens: 0, posts: 0, patches: 0, deletes: 0, statuses: [] };
  const path = (request: Request) => new URL(request.url()).pathname;
  page.on("request", (request) => {
    const where = path(request);
    if (where === "/api/tokens") calls.tokens++;
    if (!where.startsWith("/api/results")) return;
    const method = request.method();
    if (method === "POST") calls.posts++;
    if (method === "PATCH") calls.patches++;
    if (method === "DELETE") calls.deletes++;
  });
  page.on("response", (response) => {
    if (path(response.request()).startsWith("/api/results")) calls.statuses.push(response.status());
  });
  return calls;
}

async function finishRun(page: Page): Promise<void> {
  await startButton(page).click();
  await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
}

async function open(page: Page, consent?: "granted"): Promise<void> {
  if (consent) {
    await page.addInitScript((value) => {
      localStorage.setItem("kilomita.consent", value);
    }, consent);
  }
  await page.goto("/");
  await page.getByText("Low-data mode").click();
}

interface Entry {
  id: string | null;
  secret: string;
  at: number;
}

const storedShared = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("kilomita.shared") ?? "[]") as Entry[]);

const status = (page: Page) => page.getByTestId("consent-status");

test("sends nothing without consent, and reuses an unsent token for the next run", async ({
  page,
}) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  const calls = track(page);
  await open(page);
  await finishRun(page);
  await finishRun(page);
  await page.waitForTimeout(500);
  expect(calls.posts + calls.patches + calls.deletes).toBe(0);
  // "Test again" reused the first run's token: it was never sent.
  expect(calls.tokens).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("kilomita.shared"))).toBeNull();
});

test("sends once a network is picked, then corrects it", async ({ page }) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  const calls = track(page);
  await open(page, "granted");
  await finishRun(page);
  await expect(status(page)).toHaveText("Pick your network above to share this result.");
  await page.waitForTimeout(500);
  expect(calls.posts).toBe(0);

  await page.getByLabel("Network", { exact: true }).selectOption("mtn");
  await expect(status(page)).toHaveText("Shared. Thank you!");
  expect(calls.posts).toBe(1);
  expect(calls.statuses).toEqual([201]);
  const [entry] = await storedShared(page);
  expect(entry?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(entry?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const patched = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.status() === 200,
  );
  await page.getByLabel("State", { exact: true }).selectOption("kano");
  await patched;
  await page.waitForTimeout(1_500);
  expect(calls.patches).toBe(1);
  expect(calls.posts).toBe(1);
});

test("shares the result on screen when consent comes after it", async ({ page }) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  await mockNetwork(page, [{ isp: "airtel", state: "kano" }]);
  const calls = track(page);
  await open(page);
  await finishRun(page);
  await expect(page.getByTestId("network-note")).toContainText("Airtel");
  expect(calls.posts).toBe(0);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(status(page)).toHaveText("Shared. Thank you!");
  expect(calls.posts).toBe(1);
});

test("deletes what this browser shared, from the privacy page", async ({ page }) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  await mockNetwork(page, [{ isp: "glo", state: "oyo" }]);
  await open(page, "granted");
  await finishRun(page);
  await expect(status(page)).toHaveText("Shared. Thank you!");
  const [entry] = await storedShared(page);

  await page.getByRole("link", { name: "How we handle data, or delete it" }).click();
  await expect(page).toHaveURL(/\/privacy#delete$/);
  await expect(page.getByTestId("shared-count")).toHaveText("Results shared from this browser: 1");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete them" }).click();
  await expect(page.getByTestId("delete-status")).toHaveText("Deleted 1 result.");
  await expect(page.getByTestId("shared-count")).toHaveText("Results shared from this browser: 0");
  expect(await storedShared(page)).toEqual([]);
  // The count and the status have fixed boxes: the page never moves.
  expect(await layoutShifts(page)).toEqual([]);

  // The row itself is gone: its secret matches nothing now.
  const again = await page.request.delete("/api/results", { data: { secrets: [entry?.secret] } });
  expect(await again.json()).toEqual({ deleted: 0 });
});

test("a result stored behind lost responses stays deletable, and the next run still shares", async ({
  page,
}) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  const calls = track(page);
  let lose = true;
  let handled = 0;
  await page.route("**/api/results", async (route) => {
    if (route.request().method() !== "POST" || !lose) return route.fallback();
    // The server stores it; the answer never reaches the page.
    await route.fetch();
    handled++;
    await route.abort("connectionreset");
  });
  await open(page, "granted");
  await finishRun(page);
  await expect(status(page)).toHaveText("Couldn't share this result.", { timeout: 10_000 });
  // The send and its one retry, same token and secret: the server stored it once.
  expect(handled).toBe(2);
  expect(await storedShared(page)).toEqual([expect.objectContaining({ id: null })]);

  lose = false;
  await finishRun(page);
  await expect(status(page)).toHaveText("Shared. Thank you!");
  // The first token was sent, so it counts as spent: a new one, and no 409.
  expect(calls.tokens).toBe(2);
  expect(calls.statuses).not.toContain(409);
  expect(calls.statuses.at(-1)).toBe(201);

  await page.goto("/privacy");
  await expect(page.getByTestId("shared-count")).toHaveText("Results shared from this browser: 2");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete them" }).click();
  await expect(page.getByTestId("delete-status")).toHaveText("Deleted 2 results.");
});

// Found by the reviewer (mita-fd): the answer to run 1's POST lands while run 2 is "Starting…".
test("a late answer for the previous result never marks the next one shared", async ({ page }) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  const calls = track(page);
  let posts = 0;
  let tokens = 0;
  let releasePost: () => void = () => undefined;
  const postHeld = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  let releaseToken: () => void = () => undefined;
  const tokenHeld = new Promise<void>((resolve) => {
    releaseToken = resolve;
  });
  await page.route("**/api/results", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts++;
    if (posts === 1) await postHeld;
    return route.fallback();
  });
  await page.route("**/api/tokens", async (route) => {
    tokens++;
    if (tokens === 2) await tokenHeld;
    return route.fallback();
  });
  await open(page, "granted");
  await finishRun(page);
  await expect(status(page)).toHaveText("Sharing…");

  await startButton(page).click();
  await expect(page.getByText("Starting…")).toBeVisible();
  releasePost();
  // Run 1's 201 lands while run 2 is still waiting for its token.
  await expect.poll(() => calls.statuses).toEqual([201]);
  releaseToken();

  await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(status(page)).toHaveText("Shared. Thank you!");
  // Run 2 was sent itself, not dressed in run 1's answer.
  expect(posts).toBe(2);
  expect(calls.statuses).toEqual([201, 201]);
  expect((await storedShared(page)).map((entry) => entry.id !== null)).toEqual([true, true]);
});

test("a refused result leaves no secret behind", async ({ page }) => {
  await setUp(page, { downMbps: 30, upMbps: 10 });
  await mockNetwork(page, [{ isp: "mtn", state: "lagos" }]);
  await page.route("**/api/results", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 422, json: { error: "grade-mismatch" } })
      : route.fallback(),
  );
  await open(page, "granted");
  await finishRun(page);
  await expect(status(page)).toHaveText("Couldn't share this result.");
  expect(await storedShared(page)).toEqual([]);
});

/** A plausible low-data result, as the engine would send it. */
const SEED_RESULT = {
  downloadMbps: 19.88,
  uploadMbps: 4.95,
  latency: { idleMedianMs: 50, idleP95Ms: 62, jitterMs: 4, requestLossPct: 0 },
  loadedLatency: { downloadMs: 70, uploadMs: 64, grade: "A" },
  bytesUsed: 9_015_511,
  durationMs: 1_500,
  lowDataMode: true,
  engineVersion: "0.3.0",
  serverId: "cloudflare",
  measuredAt: "2026-11-02T12:00:00.000Z",
  ispSlug: "mtn",
  networkType: "4g",
  deviceClass: "mobile",
};

test("deletes 250 shared results in batches of 100", async ({ page }) => {
  const count = 250;
  const tokens: string[] = [];
  for (let i = 0; i < count; i++) {
    const response = await page.request.post("/api/tokens", { data: { lowData: true } });
    tokens.push(((await response.json()) as { token: string }).token);
  }
  // A run can't outlast its token: let 1.5 s pass, the seed result's duration.
  await page.waitForTimeout(1_600);
  const secrets = tokens.map((_, i) => `seed${String(i).padStart(39, "0")}`);
  for (let i = 0; i < count; i += 25) {
    const statuses = await Promise.all(
      tokens.slice(i, i + 25).map(async (token, j) => {
        const secret = secrets[i + j];
        const response = await page.request.post("/api/results", {
          data: { token, secret, result: SEED_RESULT },
        });
        return response.status();
      }),
    );
    expect(statuses.every((code) => code === 201)).toBe(true);
  }

  const calls = track(page);
  await page.goto("/privacy");
  await page.evaluate((list) => {
    const at = Date.now();
    localStorage.setItem(
      "kilomita.shared",
      JSON.stringify(list.map((secret) => ({ id: null, secret, at }))),
    );
  }, secrets);
  await page.reload();
  await expect(page.getByTestId("shared-count")).toHaveText(
    `Results shared from this browser: ${String(count)}`,
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete them" }).click();
  await expect(page.getByTestId("delete-status")).toHaveText(`Deleted ${String(count)} results.`);
  expect(calls.deletes).toBe(3);
  expect(await storedShared(page)).toEqual([]);
});

test("shows Starting… while it gets a token, and a tap then stops before any measurement", async ({
  page,
}) => {
  const mock = await setUp(page, { downMbps: 30, upMbps: 10 });
  await page.route("**/api/tokens", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fallback();
  });
  await open(page);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Starting…")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Test stopped.").first()).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(mock.issued).toBe(0);

  await finishRun(page);
  expect(await layoutShifts(page)).toEqual([]);
});

for (const font of FONT_PASSES) {
  test(`every share status fits its card at every width${font.title}`, async ({ page }) => {
    await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
    await mockNetwork(page, [{ isp: null, state: null }]);
    if (font.wide) await forceWideFont(page);
    await page.route("**/api/tokens", (route) => route.fulfill({ status: 503, json: {} }));
    await open(page, "granted");
    if (font.wide) await expectWideFont(page);

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

    await finishRun(page);
    await expect(status(page)).toHaveText("Sharing isn't available right now.");
    expect(await heights()).toEqual(placeholder);

    await page.unroute("**/api/tokens");
    await finishRun(page);
    await expect(status(page)).toHaveText("Pick your network above to share this result.");
    expect(await heights()).toEqual(placeholder);

    await page.route("**/api/results", (route) => route.fulfill({ status: 422, json: {} }));
    await page.getByLabel("Network", { exact: true }).selectOption("tizeti");
    await expect(status(page)).toHaveText("Couldn't share this result.");
    expect(await heights()).toEqual(placeholder);
  });
}
