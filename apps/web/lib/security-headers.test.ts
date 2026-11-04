import { describe, expect, it } from "vitest";
import {
  DENIED_FEATURES,
  SERVICE_WORKER_CSP,
  contentSecurityPolicy,
  permissionsPolicy,
  securityHeaders,
} from "./security-headers";

const directives = (csp: string) =>
  new Map(
    csp.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values] as const;
    }),
  );

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy({ dev: false }));

  it("keeps the page on its own origin", () => {
    expect(production.get("default-src")).toEqual(["'self'"]);
    expect(production.get("connect-src")).toEqual(["'self'"]);
    expect(production.get("img-src")).toEqual(["'self'"]);
    expect(production.get("worker-src")).toEqual(["'self'"]);
  });

  it("blocks framing, plugins, <base> and foreign form targets", () => {
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'none'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
  });

  it("never allows eval or foreign scripts in production", () => {
    expect(production.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(production.get("style-src")).toEqual(["'self'"]);
    expect(production.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
  });

  it("adds eval and inline styles only for next dev", () => {
    const dev = directives(contentSecurityPolicy({ dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("style-src")).toContain("'unsafe-inline'");
  });
});

describe("permissionsPolicy", () => {
  it("never denies the features the share row needs", () => {
    expect(DENIED_FEATURES).not.toContain("web-share");
    expect(DENIED_FEATURES).not.toContain("clipboard-write");
    expect(permissionsPolicy()).not.toMatch(/web-share|clipboard-write/);
  });

  it("denies every listed feature to every origin", () => {
    for (const feature of DENIED_FEATURES) expect(permissionsPolicy()).toContain(`${feature}=()`);
    expect(permissionsPolicy()).toContain("camera=()");
  });
});

describe("securityHeaders", () => {
  const rules = securityHeaders({ dev: false });
  const sourceOf = (key: string) =>
    rules.filter((rule) => rule.headers.some((header) => header.key === key)).map((r) => r.source);

  it("sends the transport and sniffing headers everywhere", () => {
    for (const key of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(sourceOf(key)).toEqual(["/:path*"]);
    }
  });

  it("sends no Cross-Origin-Opener-Policy: it cost about 4 Lighthouse points", () => {
    expect(sourceOf("Cross-Origin-Opener-Policy")).toEqual([]);
  });

  it("gives static files no CSP, so the Worker's own policy is empty", () => {
    const pageRule = new RegExp(`^${sourceOf("Content-Security-Policy")[0] ?? ""}$`);
    expect(pageRule.test("/")).toBe(true);
    expect(pageRule.test("/isps/mtn")).toBe(true);
    expect(pageRule.test("/_next/static/chunks/turbopack-worker-abc.js")).toBe(false);
  });

  it("puts the service worker's own policy last, so it wins", () => {
    const last = rules.at(-1);
    expect(last?.source).toBe("/sw.js");
    expect(last?.headers).toEqual([{ key: "Content-Security-Policy", value: SERVICE_WORKER_CSP }]);
  });
});
