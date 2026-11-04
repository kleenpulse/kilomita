import { type Locator, type Page, test as base, expect } from "@playwright/test";
import { type MockOptions, type MockStats, mockSpeedEndpoint } from "./mock-endpoint";

export { expect };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Every spec runs behind a fence: a catch-all route, registered before any mock (later routes take
 * priority), lets this machine through and aborts and records everything else. DNS fails for every
 * hostname anyway (playwright.config.ts); this also covers IP literals, which skip DNS.
 */
export const test = base.extend<{ unrouted: string[]; cspViolations: string[] }>({
  /**
   * The CSP watch: every page reports each Content-Security-Policy violation through a binding
   * (which survives navigation), and any test that saw one fails. A blocked Worker shows up as a
   * failed run instead: its violations fire in the Worker, where no init script runs.
   */
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      await context.exposeBinding("__kilomitaCsp", (_source, report: string) => {
        violations.push(report);
      });
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const report = `${event.violatedDirective} ${event.blockedURI} on ${location.pathname}`;
          (window as unknown as { __kilomitaCsp: (r: string) => void }).__kilomitaCsp(report);
        });
      });
      await use(violations);
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
  unrouted: [
    async ({ context }, use) => {
      const unrouted: string[] = [];
      await context.route("**", async (route) => {
        const url = new URL(route.request().url());
        if (LOCAL_HOSTS.has(url.hostname)) {
          await route.continue();
          return;
        }
        unrouted.push(url.origin);
        await route.abort("blockedbyclient");
      });
      await use(unrouted);
      expect(unrouted, "requests to hosts that no mock answers").toEqual([]);
    },
    { auto: true },
  ],
});

// A mocked run lasts at most the engine's deadline: 30 s standard, 15 s low-data.
export const RUN_TIMEOUT = 60_000;

export interface Shift {
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
export async function recordLayoutShifts(page: Page): Promise<void> {
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

export async function layoutShifts(page: Page): Promise<Shift[]> {
  return page.evaluate(() => window.layoutShifts);
}

export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

export async function setUp(page: Page, options: MockOptions = {}): Promise<MockStats> {
  const stats = await mockSpeedEndpoint(page.context(), options);
  await recordLayoutShifts(page);
  return stats;
}

export interface NetworkMock {
  /** One entry per request to /api/network: the screen-reader status at the time. */
  calls: string[];
}

/** Answers /api/network with the given detections in turn (the last one repeats). */
export async function mockNetwork(page: Page, answers: readonly object[]): Promise<NetworkMock> {
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
export async function fakeConnectionType(page: Page, type: string): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { type: value, saveData: false },
    });
  }, type);
}

/** The longest network note (Tizeti/Wifi.ng in the FCT) and hint (Wi-Fi) the page can show. */
export async function longestNetworkContent(page: Page): Promise<NetworkMock> {
  await fakeConnectionType(page, "wifi");
  return mockNetwork(page, [{ isp: "tizeti", state: "fct" }]);
}

export function startButton(page: Page) {
  return page.getByRole("button", { name: /^(Start|Test again)$/ });
}

/** Value text of a result row, found by its label. */
export function stat(page: Page, label: string) {
  return page
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");
}

export function megabytes(text: string): number {
  const match = /([\d.]+) MB/.exec(text);
  if (!match?.[1]) throw new Error(`No MB value in "${text}"`);
  return Number(match[1]);
}

export function expectAllRouted(stats: MockStats): void {
  expect(stats.routed).toBeGreaterThan(0);
  expect(stats.issued).toBe(stats.routed);
  // The engine aborts a request that stays silent for 6 s; the mock must answer well before.
  expect(stats.maxDelayMs).toBeLessThan(5_000);
}

// Fixed heights are only as safe as the widest font a visitor might get. Verdana (Windows) and
// DejaVu Sans (CI's Linux) are wider than Segoe UI and Roboto, so every layout test also runs in
// one of them.
export const WIDE_FONTS = ["Verdana", "DejaVu Sans"] as const;
export const FONT_PASSES = [
  { wide: false, title: "" },
  { wide: true, title: " (wide font)" },
] as const;

/** Forces the wide font from the first paint on. Call before page.goto, then expectWideFont. */
export async function forceWideFont(page: Page): Promise<void> {
  await page.addInitScript((fonts) => {
    const sheet = new CSSStyleSheet();
    const stack = fonts.map((font) => `"${font}"`).join(", ");
    sheet.replaceSync(`body, body * { font-family: ${stack}, sans-serif !important; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, WIDE_FONTS);
}

/**
 * Fails unless a wide font is installed and in use: otherwise the "wide" pass would quietly test
 * the normal font. document.fonts.check() says true for a missing local font, so this measures:
 * a font is present only if it changes a probe's width against two different generic fallbacks.
 */
export async function expectWideFont(page: Page): Promise<void> {
  const state = await page.evaluate((fonts) => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return { present: [], body: "" };
    const width = (font: string) => {
      context.font = `32px ${font}`;
      return context.measureText("mmmmmmmmmmlli WW 0123456789").width;
    };
    const present = fonts.filter((font) =>
      ["monospace", "serif"].every((generic) => width(`"${font}", ${generic}`) !== width(generic)),
    );
    return { present, body: getComputedStyle(document.body).fontFamily };
  }, WIDE_FONTS);
  expect(state.present, "a wide font is installed").not.toEqual([]);
  expect(state.body).toMatch(/^"?Verdana"?, "?DejaVu Sans"?/);
}

/**
 * Everything in an area (the result area by default) that overflows its own box, sideways or
 * downwards, or crosses the area's edges. A fixed-height box hides wrapped or spilled text from a
 * height check, so this catches what heights can't.
 * Selects clip long names on purpose; sr-only text is a 1 px clipped box by design. Hidden
 * reveals sit 4 px lower (translate) and slide up when shown; a transform never moves layout but
 * does stretch scrollHeight, so transforms are switched off while measuring. If anything in the
 * result area is ever positioned with a transform, this measures it untransformed: revisit.
 */
export async function overflows(
  page: Page,
  area: Locator = page.getByTestId("result-area"),
): Promise<string[]> {
  return area.evaluate((area) => {
    const still = new CSSStyleSheet();
    still.replaceSync(
      "* { translate: none !important; transform: none !important; transition: none !important; }",
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
    try {
      const box = area.getBoundingClientRect();
      return [...area.querySelectorAll<HTMLElement>("*")]
        .filter((el) => el.tagName !== "SELECT" && !el.closest("select, .sr-only"))
        .flatMap((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return [];
          const outside = rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
          const overflowing =
            el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
          if (!outside && !overflowing) return [];
          const size = `${String(el.scrollWidth)}x${String(el.scrollHeight)} in ${String(el.clientWidth)}x${String(el.clientHeight)}`;
          const where = `x ${String(Math.round(rect.left))}..${String(Math.round(rect.right))} of ${String(Math.round(box.left))}..${String(Math.round(box.right))}`;
          return [`${el.tagName.toLowerCase()} "${el.textContent.slice(0, 40)}" ${size}, ${where}`];
        });
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== still);
    }
  });
}
