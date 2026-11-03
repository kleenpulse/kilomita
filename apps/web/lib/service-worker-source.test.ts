import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVICE_WORKER_SOURCE } from "./service-worker-source";

/*
 * Runs the real service worker source in a sandbox with fake caches, fetch and clock, and drives
 * its events the way a browser would.
 */

const ORIGIN = "https://kilomita.test";
const HTML_A = `<html><script src="/_next/static/chunks/a.js"></script><link href="/_next/static/css/a.css" rel="stylesheet"></html>`;
const HTML_B = `<html><script src="/_next/static/chunks/b.js"></script><link href="/_next/static/css/a.css" rel="stylesheet"></html>`;

type Handler = (url: string) => Promise<Response>;

function basic(body: string): Response {
  const response = new Response(body);
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

const keyOf = (input: Request | string | { url: string }) =>
  new URL(typeof input === "string" ? input : input.url, ORIGIN).href;

class FakeCache {
  readonly entries = new Map<string, Response>();
  match(input: Request | string) {
    return Promise.resolve(this.entries.get(keyOf(input))?.clone());
  }
  put(input: Request | string, response: Response) {
    this.entries.set(keyOf(input), response);
    return Promise.resolve();
  }
  keys() {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(url)));
  }
  delete(input: Request | string) {
    return Promise.resolve(this.entries.delete(keyOf(input)));
  }
}

function sandbox(handler: { current: Handler }) {
  const stores = new Map<string, FakeCache>();
  const caches = {
    open: (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return Promise.resolve(stores.get(name));
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    match: async (input: Request | string) => {
      for (const cache of stores.values()) {
        const hit = await cache.match(input);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const fetched: string[] = [];
  runInNewContext(SERVICE_WORKER_SOURCE, {
    self,
    caches,
    URL,
    Promise,
    Set,
    Error,
    fetch: (input: Request | string | { url: string }) => {
      const url = keyOf(input);
      fetched.push(url);
      return handler.current(url);
    },
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  });

  async function install() {
    const waits: Promise<unknown>[] = [];
    listeners.get("install")?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  async function activate() {
    const waits: Promise<unknown>[] = [];
    listeners.get("activate")?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  /** Dispatches a fetch; null when the worker left it to the network. */
  function request(url: string, init: { method?: string; mode?: string } = {}) {
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.get("fetch")?.({
      request: {
        url: new URL(url, ORIGIN).href,
        method: init.method ?? "GET",
        mode: init.mode ?? "cors",
      },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    return { responded: responded as Promise<Response> | null, settled: () => Promise.all(waits) };
  }

  const cached = () =>
    [...stores.values()].flatMap((cache) =>
      [...cache.entries.keys()].map((url) => url.replace(ORIGIN, "")),
    );

  return { install, activate, request, cached, stores, fetched };
}

/** A site that answers from a table; anything else fails like a network error. */
function site(table: Record<string, () => Response>): Handler {
  return (url) => {
    const path = url.replace(ORIGIN, "");
    const make = table[path];
    return make ? Promise.resolve(make()) : Promise.reject(new TypeError("Failed to fetch"));
  };
}

const offline: Handler = () => Promise.reject(new TypeError("Failed to fetch"));

const SITE_A = {
  "/": () => basic(HTML_A),
  "/_next/static/chunks/a.js": () => basic("a"),
  "/_next/static/css/a.css": () => basic("css"),
};

describe("service worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores the home page and exactly the static files it uses on install", async () => {
    const sw = sandbox({ current: site(SITE_A) });
    await sw.install();
    expect(sw.cached().sort()).toEqual([
      "/",
      "/_next/static/chunks/a.js",
      "/_next/static/css/a.css",
    ]);
  });

  it("leaves everything else to the network, untouched", () => {
    const sw = sandbox({ current: site(SITE_A) });
    for (const [url, init] of [
      ["https://lagos-1.kilomita.ng/down?bytes=1000&t=x", {}],
      ["https://speed.cloudflare.com/__down?bytes=0", {}],
      // Paths and modes it does handle on its own origin, from somewhere else.
      ["https://cdn.example.ng/_next/static/chunks/a.js", {}],
      ["https://lagos-1.kilomita.ng/", { mode: "navigate" }],
      ["/api/test-servers", { method: "POST" }],
      ["/api/stats/isp", {}],
      ["/api/results", { method: "POST" }],
      ["/r/d23_u5.1_l34_gB_t20261103/card.png", {}],
      ["/sw.js", {}],
      ["/manifest.webmanifest", {}],
      ["/_next/static/chunks/a.js", { method: "POST" }],
    ] as const) {
      expect(sw.request(url, init).responded).toBeNull();
    }
  });

  it("serves the home page from the network when it answers, and refreshes the copy", async () => {
    const handler = { current: site(SITE_A) };
    const sw = sandbox(handler);
    await sw.install();
    handler.current = site({
      "/?source=pwa": () => basic(HTML_B),
      "/_next/static/chunks/b.js": () => basic("b"),
    });
    const visit = sw.request("/?source=pwa", { mode: "navigate" });
    expect(await (await visit.responded)?.text()).toBe(HTML_B);
    await visit.settled();
    // The new page's files are stored, and the old build's chunk is pruned.
    expect(sw.cached().sort()).toEqual([
      "/",
      "/_next/static/chunks/b.js",
      "/_next/static/css/a.css",
    ]);
  });

  it("keeps the working copy when a file of the new page can't be fetched", async () => {
    const handler = { current: site(SITE_A) };
    const sw = sandbox(handler);
    await sw.install();
    const before = sw.cached().sort();
    // A deploy landed between the page and its files: the new chunk answers 404.
    handler.current = site({
      "/?source=pwa": () => basic(HTML_B),
      "/_next/static/chunks/b.js": () => new Response("missing", { status: 404 }),
    });
    const visit = sw.request("/?source=pwa", { mode: "navigate" });
    expect(await (await visit.responded)?.text()).toBe(HTML_B);
    await visit.settled();
    expect(sw.cached().sort()).toEqual(before);
    const shell = await sw.stores.get("kilomita-shell-v1")?.match("/");
    expect(await shell?.text()).toBe(HTML_A);
  });

  it("serves the stored home page for the app's start URL when offline", async () => {
    const handler = { current: site(SITE_A) };
    const sw = sandbox(handler);
    await sw.install();
    handler.current = offline;
    const visit = sw.request("/?source=pwa", { mode: "navigate" });
    expect(await (await visit.responded)?.text()).toBe(HTML_A);
    const chunk = sw.request("/_next/static/chunks/a.js");
    expect(await (await chunk.responded)?.text()).toBe("a");
  });

  it("falls back to the stored copy after 4 s, then refreshes it once the slow answer lands", async () => {
    const handler = { current: site(SITE_A) };
    const sw = sandbox(handler);
    await sw.install();
    let land: (response: Response) => void = () => undefined;
    handler.current = (url) =>
      url.endsWith("/?source=pwa")
        ? new Promise<Response>((resolve) => {
            land = resolve;
          })
        : site({ "/_next/static/chunks/b.js": () => basic("b") })(url);
    const visit = sw.request("/?source=pwa", { mode: "navigate" });
    let served = "";
    void visit.responded?.then(async (response) => {
      served = await response.text();
    });
    await vi.advanceTimersByTimeAsync(3_900);
    expect(served).toBe("");
    await vi.advanceTimersByTimeAsync(200);
    expect(served).toBe(HTML_A);
    land(basic(HTML_B));
    await visit.settled();
    const shell = await sw.stores.get("kilomita-shell-v1")?.match("/");
    expect(await shell?.text()).toBe(HTML_B);
  });

  it("serves static files from the store first", async () => {
    const handler = { current: site(SITE_A) };
    const sw = sandbox(handler);
    await sw.install();
    const before = sw.fetched.length;
    const chunk = sw.request("/_next/static/chunks/a.js");
    expect(await (await chunk.responded)?.text()).toBe("a");
    expect(sw.fetched.length).toBe(before);
  });

  it("never stores anything but the home page and its static files", async () => {
    const handler = {
      current: site({
        ...SITE_A,
        "/?source=pwa": () => basic(HTML_A),
        "/_next/static/chunks/other.js": () => basic("o"),
      }),
    };
    const sw = sandbox(handler);
    await sw.install();
    await sw.request("/?source=pwa", { mode: "navigate" }).settled();
    await sw.request("/_next/static/chunks/other.js").responded;
    sw.request("/api/stats/isp");
    sw.request("https://lagos-1.kilomita.ng/ping?t=x");
    for (const path of sw.cached())
      expect(path === "/" || path.startsWith("/_next/static/")).toBe(true);
    expect(sw.cached()).not.toContain("/_next/static/chunks/other.js");
  });

  it("drops caches from older versions on activate", async () => {
    const sw = sandbox({ current: site(SITE_A) });
    await sw.install();
    sw.stores.set("kilomita-shell-v0", new FakeCache());
    await sw.activate();
    expect([...sw.stores.keys()]).toEqual(["kilomita-shell-v1"]);
  });

  it("still installs when the home page can't be fetched", async () => {
    const sw = sandbox({ current: offline });
    await expect(sw.install()).resolves.toBeUndefined();
    expect(sw.cached()).toEqual([]);
  });
});
