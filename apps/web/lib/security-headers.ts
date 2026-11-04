/*
 * Security headers for every response, set statically in next.config.ts so prerendered pages stay
 * prerendered (nonces would need a proxy on every request and force dynamic rendering).
 *
 * The CSP keeps 'unsafe-inline' for scripts: Next streams its RSC payload in inline scripts that
 * carry no nonce or hash on static pages. So it is defence in depth (no foreign scripts, frames,
 * plugins, form targets or <base> hijack), not a guarantee against injected inline script.
 *
 * The speed test's dedicated Worker loads from /_next/static/ and, in Chromium, is governed by the
 * CSP of its own script response, not the page's (Phase 7 probe P1). Static files get no CSP, so
 * the Worker can reach the test servers configured at runtime while the page stays
 * connect-src 'self'.
 */

export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/**
 * Features no page here uses. web-share and clipboard-write must never be listed: the share row
 * needs both.
 */
export const DENIED_FEATURES = Object.freeze([
  "accelerometer",
  "autoplay",
  "bluetooth",
  "browsing-topics",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "hid",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "serial",
  "usb",
  "xr-spatial-tracking",
]);

export function permissionsPolicy(): string {
  return DENIED_FEATURES.map((feature) => `${feature}=()`).join(", ");
}

export function contentSecurityPolicy({ dev }: { dev: boolean }): string {
  return [
    "default-src 'self'",
    // next dev's React needs eval for its debugging features; production never does.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    // next dev injects <style> tags; production has only style attributes.
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The service worker fetches only its own origin's home page and static files. */
export const SERVICE_WORKER_CSP = "default-src 'self'";

export function securityHeaders({ dev }: { dev: boolean }): HeaderRule[] {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: permissionsPolicy() },
      ],
    },
    {
      // Everything but /_next/static/, which holds the Worker's script (see the header comment).
      source: "/((?!_next/static/).*)",
      headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy({ dev }) }],
    },
    {
      // Last, so it replaces the page policy for this path (the last matching rule wins).
      source: "/sw.js",
      headers: [{ key: "Content-Security-Policy", value: SERVICE_WORKER_CSP }],
    },
  ];
}
