import { type Page, expect, test } from "@playwright/test";
import {
  expectAllRouted,
  expectWideFont,
  fakeConnectionType,
  FONT_PASSES,
  forceWideFont,
  layoutShifts,
  longestNetworkContent,
  megabytes,
  mockNetwork,
  overflows,
  RUN_TIMEOUT,
  setUp,
  startButton,
  stat,
  watchConsole,
} from "./helpers";

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
    await expect(stat(page, "Loaded latency")).toContainText("grade A");
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

for (const font of FONT_PASSES) {
  test.describe(`at 320 px${font.title}`, () => {
    test.setTimeout(90_000);
    test.use({ viewport: { width: 320, height: 640 } });

    test("fits without horizontal scroll and doesn't shift through a run", async ({ page }) => {
      await setUp(page, { downMbps: 30, upMbps: 10 });
      if (font.wide) await forceWideFont(page);
      await page.goto("/");
      if (font.wide) await expectWideFont(page);
      await page.getByText("Low-data mode").click();
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page.getByText("Your net don finish test!")).toBeVisible({
        timeout: RUN_TIMEOUT,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      expect(await overflows(page)).toEqual([]);
      expect(await layoutShifts(page)).toEqual([]);
    });
  });
}

// The longest result the panel can show: grade F (bloat), failing rows and the low-data cap note.
// Space for it is reserved from the first paint, so the footer never moves when it appears.
for (const font of FONT_PASSES) {
  for (const [label, viewport, scroll] of [
    ["Pixel 7, scrolled down", null, true],
    ["320 px, scrolled down", { width: 320, height: 640 }, true],
    ["375 px, scrolled down", { width: 375, height: 667 }, true],
    ["a tall window", { width: 412, height: 1150 }, false],
  ] as const) {
    test.describe(`worst-case result in ${label}${font.title}`, () => {
      test.setTimeout(90_000);
      if (viewport) test.use({ viewport });

      test("reveals it without shifting the page", async ({ page }) => {
        await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
        await longestNetworkContent(page);
        if (font.wide) await forceWideFont(page);
        await page.goto("/");
        if (font.wide) await expectWideFont(page);
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
        await expect(stat(page, "Loaded latency")).toContainText("grade F");
        await expect(page.getByText(/Ended early to save data/)).toBeVisible();
        await expect(page.getByText("lags under load").first()).toBeVisible();
        await expect(page.getByTestId("network-note")).toContainText("Tizeti/Wifi.ng");
        await expect(page.getByTestId("connection-hint")).toContainText("MiFi");
        expect(await overflows(page)).toEqual([]);
        expect(await layoutShifts(page)).toEqual([]);
      });
    });
  }
}

for (const font of FONT_PASSES) {
  test.describe(`result panel height${font.title}`, () => {
    test.setTimeout(90_000);

    test("is the same for the longest result and the placeholder at every width", async ({
      page,
    }) => {
      await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
      if (font.wide) await forceWideFont(page);
      await page.goto("/");
      if (font.wide) await expectWideFont(page);
      await page.getByText("Low-data mode").click();
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page.getByText("Your net don finish test!")).toBeVisible({
        timeout: RUN_TIMEOUT,
      });
      await expect(stat(page, "Loaded latency")).toContainText("grade F");
      await expect(page.getByText(/Ended early to save data/)).toBeVisible();

      const widths = Array.from({ length: 71 }, (_, i) => 320 + i * 4);
      const panel = page.locator('section[aria-labelledby="results-heading"]');
      const heights = async () => {
        const result: number[] = [];
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          result.push(await panel.evaluate((el) => el.getBoundingClientRect().height));
          expect(await overflows(page), `at ${String(width)} px`).toEqual([]);
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
}

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

  test("shares nothing without consent or a network, and remembers the choice", async ({
    page,
  }) => {
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
    // Nothing is detected yet (no IP provider), so sharing waits for the user to pick a network.
    await expect(status).toHaveText("Pick your network above to share this result.");
    await expect(status).toBeFocused();

    await page.reload();
    await finishRun(page);
    await expect(status).toHaveText("Pick your network above to share this result.");
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
    await expect(status).toHaveText("Pick your network above to share this result.");

    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Stop sharing" }).dblclick();
    await expect(status).toHaveText("Your results aren't shared.");
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => localStorage.getItem("kilomita.consent"))).toBe("declined");
  });
});

for (const font of FONT_PASSES) {
  test.describe(`result area height${font.title}`, () => {
    test.setTimeout(120_000);

    test("is the same at every width for the placeholder, the longest content and each consent state", async ({
      page,
    }) => {
      await setUp(page, { downMbps: 60, upMbps: 20, bloatMs: 450 });
      await longestNetworkContent(page);
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
      await expect(page.getByText("Your net don finish test!")).toBeVisible({
        timeout: RUN_TIMEOUT,
      });
      await expect(stat(page, "Loaded latency")).toContainText("grade F");
      await expect(page.getByText(/Ended early to save data/)).toBeVisible();
      await expect(page.getByTestId("network-note")).toContainText("Tizeti/Wifi.ng");
      await expect(page.getByTestId("connection-hint")).toContainText("MiFi");
      expect(await heights()).toEqual(placeholder);

      // Tizeti is detected, so sharing sends at once: the real route, on the memory stores.
      const status = page.getByTestId("consent-status");
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await expect(status).toHaveText("Shared. Thank you!");
      expect(await heights()).toEqual(placeholder);
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "Stop sharing" }).click();
      await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
      expect(await heights()).toEqual(placeholder);
    });
  });
}
