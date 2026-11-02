import { type Page, expect, test } from "@playwright/test";
import { type MockOptions, type MockStats, mockSpeedEndpoint } from "./mock-endpoint";

// A mocked run lasts at most the engine's deadline: 30 s standard, 15 s low-data.
const RUN_TIMEOUT = 60_000;

interface Shift {
  value: number;
  recent: boolean;
  nodes: string[];
}

declare global {
  interface Window {
    layoutShifts: Shift[];
  }
}

/** Records every layout shift, including those right after input, from the first paint on. */
async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.layoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: {
          node?: Node | null;
          previousRect: DOMRectReadOnly;
          currentRect: DOMRectReadOnly;
        }[];
      })[]) {
        window.layoutShifts.push({
          value: entry.value,
          recent: entry.hadRecentInput,
          nodes: (entry.sources ?? []).map((source) => {
            const node = source.node;
            if (!node) return "?";
            const element = node instanceof Element ? node : node.parentElement;
            const where = `${String(Math.round(source.previousRect.x))},${String(Math.round(source.previousRect.y))}→${String(Math.round(source.currentRect.x))},${String(Math.round(source.currentRect.y))}`;
            return `${node.nodeName}${element?.className ? `.${element.className.slice(0, 40)}` : ""} "${(node.textContent ?? "").slice(0, 30)}" ${where}`;
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function layoutShifts(page: Page): Promise<Shift[]> {
  return page.evaluate(() => window.layoutShifts);
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function setUp(page: Page, options: MockOptions = {}): Promise<MockStats> {
  const stats = await mockSpeedEndpoint(page.context(), options);
  await recordLayoutShifts(page);
  return stats;
}

interface NetworkMock {
  /** One entry per request to /api/network: the screen-reader status at the time. */
  calls: string[];
}

/** Answers /api/network with the given detections in turn (the last one repeats). */
async function mockNetwork(page: Page, answers: readonly object[]): Promise<NetworkMock> {
  const mock: NetworkMock = { calls: [] };
  await page.route("**/api/network", async (route) => {
    const status = await page
      .getByRole("status")
      .textContent()
      .catch(() => null);
    mock.calls.push(status ?? "");
    const answer = answers[Math.min(mock.calls.length - 1, answers.length - 1)];
    await route.fulfill({ json: answer, headers: { "cache-control": "no-store" } });
  });
  return mock;
}

/** What navigator.connection.type reports (Chromium on Android and ChromeOS only, in reality). */
async function fakeConnectionType(page: Page, type: string): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { type: value, saveData: false },
    });
  }, type);
}

/** The longest network note (Tizeti/Wifi.ng in the FCT) and hint (Wi-Fi) the page can show. */
async function longestNetworkContent(page: Page): Promise<NetworkMock> {
  await fakeConnectionType(page, "wifi");
  return mockNetwork(page, [{ isp: "tizeti", state: "fct" }]);
}

function startButton(page: Page) {
  return page.getByRole("button", { name: /^(Start|Test again)$/ });
}

/** Value text of a result row, found by its label. */
function stat(page: Page, label: string) {
  return page
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");
}

function megabytes(text: string): number {
  const match = /([\d.]+) MB/.exec(text);
  if (!match?.[1]) throw new Error(`No MB value in "${text}"`);
  return Number(match[1]);
}

function expectAllRouted(stats: MockStats): void {
  expect(stats.routed).toBeGreaterThan(0);
  expect(stats.issued).toBe(stats.routed);
  // The engine aborts a request that stays silent for 6 s; the mock must answer well before.
  expect(stats.maxDelayMs).toBeLessThan(5_000);
}

test.describe("speed test", () => {
  test.setTimeout(90_000);

  test("runs a full standard test against the mock and reveals the results", async ({ page }) => {
    const errors = watchConsole(page);
    const stats = await setUp(page, { downMbps: 8, upMbps: 2 });
    await page.goto("/");
    await expect(page.getByRole("switch", { name: "Low-data mode" })).not.toBeChecked();
    await expect(page.getByText("Uses up to 50 MB of data")).toBeVisible();

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Low-data mode" })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText(/Testing download/, { timeout: RUN_TIMEOUT });
    await expect(page.getByTestId("download-speed")).not.toHaveText("–", { timeout: RUN_TIMEOUT });
    await expect(page.getByRole("status")).toHaveText(/Testing upload/, { timeout: RUN_TIMEOUT });

    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(page.getByRole("button", { name: "Test again" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Test complete. Download");

    const download = Number(await page.getByTestId("download-speed").textContent());
    const upload = Number((await stat(page, "Upload").textContent())?.replace("Mbps", ""));
    // Loose on purpose: the mock delivers each body in one burst, and parallel workers share the
    // CPU that pushes those bodies through the DevTools protocol.
    expect(download).toBeGreaterThan(8 / 3);
    expect(download).toBeLessThan(8 * 3);
    expect(upload).toBeGreaterThan(2 / 3);
    expect(upload).toBeLessThan(2 * 3);
    expect(download).toBeGreaterThan(upload);

    await expect(stat(page, "Latency")).toHaveText(/^\d+ msidle$/);
    await expect(stat(page, "Jitter")).toHaveText(/^\d+ ms$/);
    await expect(stat(page, "Latency under load")).toContainText("grade A");
    const used = megabytes((await stat(page, "Data used").textContent()) ?? "");
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(50);
    await expect(page.getByText(/^(Good for|Fine for|Very slow)/)).toBeVisible();
    await expect(page.getByText("How we judge this")).toBeVisible();

    expect(await layoutShifts(page)).toEqual([]);
    expectAllRouted(stats);
    expect(errors).toEqual([]);
  });

  test("remembers low-data mode and keeps the run under its cap", async ({ page }) => {
    const stats = await setUp(page, { downMbps: 30, upMbps: 10 });
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await expect(page.getByRole("switch", { name: "Low-data mode" })).toBeChecked();
    await expect(page.getByText("Uses up to 10 MB of data")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("switch", { name: "Low-data mode" })).toBeChecked();

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(stat(page, "Data used")).toContainText("low-data");
    expect(megabytes((await stat(page, "Data used").textContent()) ?? "")).toBeLessThanOrEqual(10);
    expect(await layoutShifts(page)).toEqual([]);
    expectAllRouted(stats);
  });

  test("stops at once and sends nothing more", async ({ page }) => {
    const stats = await setUp(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("status")).toHaveText(/Testing download/, { timeout: RUN_TIMEOUT });

    // Wait for a live reading, so some data has been spent and the summary shows an amount.
    await expect(page.getByTestId("download-speed")).not.toHaveText("–", { timeout: RUN_TIMEOUT });
    await page.getByRole("button", { name: "Stop" }).click();
    const stoppedAt = Date.now();
    await expect(page.getByText("Test stopped.").first()).toBeVisible();
    await expect(page.getByText(/Data used before it stopped: about /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Test again" })).toBeEnabled();

    await page.waitForTimeout(1_500);
    expect(stats.lastArrivalAt).toBeLessThan(stoppedAt + 1_000);
    expect(await layoutShifts(page)).toEqual([]);
  });

  test("stops when the page is hidden mid-run, but not when idle", async ({ page }) => {
    const stats = await setUp(page);
    await page.goto("/");

    const hide = () =>
      page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    const show = () =>
      page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

    await hide();
    await show();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("status")).toHaveText(/Testing download/, { timeout: RUN_TIMEOUT });
    await hide();
    const hiddenAt = Date.now();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Test stopped because you left the page",
    );
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Data used before it stopped",
    );

    await page.waitForTimeout(1_500);
    expect(stats.lastArrivalAt).toBeLessThan(hiddenAt + 1_000);
  });

  for (const [name, options, copy] of [
    [
      "a rate limit",
      { status: { code: 429, on: ["probe", "download", "upload"] } },
      "busy right now",
    ],
    [
      "a refusal",
      { status: { code: 403, on: ["probe", "download", "upload"] } },
      "refused requests from your network",
    ],
    [
      "a server error",
      { status: { code: 503, on: ["probe", "download", "upload"] } },
      "server had a problem",
    ],
    ["a dropped connection", { fail: true }, "connection dropped"],
  ] as const) {
    test(`explains ${name}`, async ({ page }) => {
      const stats = await setUp(page, options);
      await page.goto("/");
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(copy, {
        timeout: RUN_TIMEOUT,
      });
      await expect(startButton(page)).toBeVisible();
      expect(await layoutShifts(page)).toEqual([]);
      expect(stats.routed).toBeGreaterThan(0);
    });
  }

  test("works by keyboard, and reveals without motion when asked", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const start = page.getByRole("button", { name: "Start" });
    for (let i = 0; i < 10 && !(await start.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(start).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop" })).toBeFocused();

    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    const durations = await page
      .locator("[data-reveal]")
      .evaluateAll((elements) => elements.map((el) => getComputedStyle(el).transitionDuration));
    expect(durations.length).toBeGreaterThan(0);
    for (const duration of durations) expect(duration).toBe("0s");
  });
});

test.describe("at 320 px", () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 320, height: 640 } });

  test("fits without horizontal scroll and doesn't shift through a run", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    expect(await layoutShifts(page)).toEqual([]);
  });
});

// The longest result the panel can show: grade F (bloat), failing rows and the low-data cap note.
// Space for it is reserved from the first paint, so the footer never moves when it appears.
for (const [label, viewport, scroll] of [
  ["Pixel 7, scrolled down", null, true],
  ["320 px, scrolled down", { width: 320, height: 640 }, true],
  ["375 px, scrolled down", { width: 375, height: 667 }, true],
  ["a tall window", { width: 412, height: 1150 }, false],
] as const) {
  test.describe(`worst-case result in ${label}`, () => {
    test.setTimeout(90_000);
    if (viewport) test.use({ viewport });

    test("reveals it without shifting the page", async ({ page }) => {
      await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
      await longestNetworkContent(page);
      await page.goto("/");
      await page.getByText("Low-data mode").click();
      await page.getByRole("button", { name: "Start" }).click();
      if (scroll) {
        await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
      }
      await expect(page.getByText("Your net don finish test!")).toBeVisible({
        timeout: RUN_TIMEOUT,
      });
      await expect(stat(page, "Latency under load")).toContainText("grade F");
      await expect(page.getByText(/Ended early to save data/)).toBeVisible();
      await expect(page.getByText("lags under load").first()).toBeVisible();
      await expect(page.getByTestId("network-note")).toContainText("Tizeti/Wifi.ng");
      await expect(page.getByTestId("connection-hint")).toContainText("MiFi");
      expect(await layoutShifts(page)).toEqual([]);
    });
  });
}

test.describe("result panel height", () => {
  test.setTimeout(90_000);

  test("is the same for the longest result and the placeholder at every width", async ({
    page,
  }) => {
    await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(stat(page, "Latency under load")).toContainText("grade F");
    await expect(page.getByText(/Ended early to save data/)).toBeVisible();

    const widths = Array.from({ length: 71 }, (_, i) => 320 + i * 4);
    const panel = page.locator('section[aria-labelledby="results-heading"]');
    const heights = async () => {
      const result: number[] = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        result.push(await panel.evaluate((el) => el.getBoundingClientRect().height));
      }
      return result;
    };

    const longest = await heights();
    await page.setViewportSize({ width: 412, height: 900 });
    await page.getByRole("button", { name: "Test again" }).click();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("Test stopped.").first()).toBeVisible();
    const placeholder = await heights();
    expect(longest).toEqual(placeholder);
  });
});

test.describe("network details and consent", () => {
  test.setTimeout(120_000);

  async function finishRun(page: Page): Promise<void> {
    await startButton(page).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
  }

  test("asks our server once per finished run, never on load or mid-run", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    const network = await mockNetwork(page, [{ isp: null, state: null }]);
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await page.waitForTimeout(500);
    expect(network.calls).toEqual([]);

    await startButton(page).click();
    await expect(page.getByRole("status")).toHaveText(/Testing upload/, { timeout: RUN_TIMEOUT });
    expect(network.calls).toEqual([]);
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(page.getByTestId("network-note")).toHaveText(
      "Choose your network and state so this result is labelled correctly.",
    );
    expect(network.calls).toHaveLength(1);
    expect(network.calls[0]).toContain("Test complete");

    // A stopped run detects nothing.
    await startButton(page).click();
    await expect(page.getByRole("status")).toHaveText(/Testing download/, { timeout: RUN_TIMEOUT });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("Test stopped.").first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(network.calls).toHaveLength(1);
  });

  test("prefills what it detected and keeps the user's corrections", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    await mockNetwork(page, [
      { isp: "mtn", state: "lagos" },
      { isp: "mtn", state: "kano" },
    ]);
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await finishRun(page);

    const isp = page.getByLabel("Network", { exact: true });
    const state = page.getByLabel("State", { exact: true });
    await expect(page.getByTestId("network-note")).toHaveText(
      "We think you're on MTN in Lagos. Not right? Correct it below.",
    );
    await expect(isp).toHaveValue("mtn");
    await expect(state).toHaveValue("lagos");
    await expect(page.getByLabel("Connection")).toHaveValue("unknown");
    await expect(state.locator("option")).toHaveCount(38);
    await expect(state.locator('option[value="fct"]')).toHaveText("Federal Capital Territory");

    await isp.selectOption("glo");
    await page.getByLabel("Connection").selectOption("4g");
    await finishRun(page);
    // The second detection says Kano: the untouched state follows it, the corrected ISP doesn't.
    await expect(state).toHaveValue("kano");
    await expect(isp).toHaveValue("glo");
    await expect(page.getByLabel("Connection")).toHaveValue("4g");
  });

  test("hints at the connection when the device says what it is", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    await fakeConnectionType(page, "cellular");
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await finishRun(page);
    await expect(page.getByTestId("connection-hint")).toHaveText("Your device says mobile data.");
  });

  test("shares nothing without consent, and remembers the choice", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    let resultRequests = 0;
    await page.route("**/api/results**", (route) => {
      resultRequests++;
      return route.abort();
    });
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await finishRun(page);

    const status = page.getByTestId("consent-status");
    await expect(status).toHaveText("Nothing is shared until you choose.");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(status).toHaveText("Sharing is on.");
    await expect(status).toBeFocused();

    await page.reload();
    await finishRun(page);
    await expect(status).toHaveText("Sharing is on.");
    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(status).toHaveText("Your results aren't shared.");
    await expect(status).toBeFocused();

    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("kilomita.")),
    );
    expect(keys.sort()).toEqual(["kilomita.consent", "kilomita.lowData"]);
    expect(await page.evaluate(() => localStorage.getItem("kilomita.consent"))).toBe("declined");
    expect(resultRequests).toBe(0);
  });

  test("a double press keeps the choice instead of undoing it", async ({ page }) => {
    await setUp(page, { downMbps: 30, upMbps: 10 });
    await page.goto("/");
    await page.getByText("Low-data mode").click();
    await finishRun(page);

    const status = page.getByTestId("consent-status");
    await page.getByRole("button", { name: "Share", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("Sharing is on.");

    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Stop sharing" }).dblclick();
    await expect(status).toHaveText("Your results aren't shared.");
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => localStorage.getItem("kilomita.consent"))).toBe("declined");
  });
});

test.describe("result area height", () => {
  test.setTimeout(120_000);

  test("is the same at every width for the placeholder, the longest content and each consent state", async ({
    page,
  }) => {
    await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
    await longestNetworkContent(page);
    await page.goto("/");
    await page.getByText("Low-data mode").click();

    const widths = Array.from({ length: 71 }, (_, i) => 320 + i * 4);
    const area = page.getByTestId("result-area");
    // A fixed-height row hides wrapped or spilled text from the height check, so the consent
    // card's buttons and status are also checked to stay one line, inside the card.
    const card = page.locator('section[aria-labelledby="consent-heading"]');
    const spills = () =>
      card.evaluate((section) => {
        const box = section.getBoundingClientRect();
        return [...section.querySelectorAll("button, [aria-live]")]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.right > box.right || el.scrollWidth > el.clientWidth + 1;
          })
          .map((el) => el.textContent);
      });
    const heights = async () => {
      const result: number[] = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        result.push(await area.evaluate((el) => el.getBoundingClientRect().height));
        expect(await spills(), `at ${String(width)} px`).toEqual([]);
      }
      await page.setViewportSize({ width: 412, height: 900 });
      return result;
    };

    const placeholder = await heights();
    await startButton(page).click();
    await expect(page.getByText("Your net don finish test!")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(stat(page, "Latency under load")).toContainText("grade F");
    await expect(page.getByText(/Ended early to save data/)).toBeVisible();
    await expect(page.getByTestId("network-note")).toContainText("Tizeti/Wifi.ng");
    await expect(page.getByTestId("connection-hint")).toContainText("MiFi");
    expect(await heights()).toEqual(placeholder);

    await page.getByRole("button", { name: "Share", exact: true }).click();
    expect(await heights()).toEqual(placeholder);
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Stop sharing" }).click();
    expect(await heights()).toEqual(placeholder);
  });
});
