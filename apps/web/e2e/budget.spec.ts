import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "./helpers";

/*
 * The performance budget (Phase 7), enforced in CI: the gzip-9 size of every JS chunk a page's
 * HTML references, the noModule polyfill excluded, measured on the production build that CI mode
 * serves (`next start`). Lighthouse scores move a few points between runs on one machine, so the
 * bytes are budgeted, not the score. Phase 6 baselines: / 144.6 KiB, /privacy 138.0, every
 * dashboard page and /r/<code> 132.4. Raise a budget only on purpose, and say why in CLAUDE.md.
 */

const KIB = 1024;
const SHARE = "/r/d23_u5.1_l34_gB_imtn_slagos_t20261103";
const BUDGETS: readonly (readonly [string, number])[] = [
  ["/", 146.0],
  ["/privacy", 139.0],
  ["/isps", 133.5],
  ["/isps/mtn", 133.5],
  ["/states", 133.5],
  ["/states/lagos", 133.5],
  ["/methodology", 133.5],
  ["/status", 133.5],
  [SHARE, 133.5],
];

/** Strings that must never reach a first download: server code, and the lazily loaded parts. */
const FORBIDDEN = [
  "drizzle",
  "pglite",
  "PGlite",
  "@upstash",
  "postgres://",
  "percentile_cont",
  "array_agg",
  "ZodError",
  "createHash",
  "kilomita.stores",
  "wa.me",
  "My speed test:",
  "kilomita-shell-v1",
  "updateViaCache",
];

const WEB = join(import.meta.dirname, "..");

test.describe("performance budget", () => {
  test.skip(!process.env.CI, "production build only: run with CI=1 (next start)");

  for (const [path, budget] of BUDGETS) {
    test(`${path} ships at most ${String(budget)} KiB of JS`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      const sources = [
        ...new Set(
          [...html.matchAll(/<script\b[^>]*>/g)]
            .map(([tag]) => tag)
            .filter((tag) => !/nomodule/i.test(tag))
            .flatMap((tag) => /src="([^"]+\.js)"/.exec(tag)?.[1] ?? []),
        ),
      ];
      expect(sources.length, "chunks found").toBeGreaterThan(0);
      let bytes = 0;
      const found = new Set<string>();
      for (const source of sources) {
        const relative = decodeURIComponent(source.replace(/^\/_next\//, "").split("?")[0] ?? "");
        const code = readFileSync(join(WEB, ".next", relative));
        bytes += gzipSync(code, { level: 9 }).length;
        const text = code.toString("utf8");
        for (const needle of FORBIDDEN) if (text.includes(needle)) found.add(needle);
      }
      console.log(`${path}: ${(bytes / KIB).toFixed(1)} KiB in ${String(sources.length)} chunks`);
      expect([...found], "forbidden strings").toEqual([]);
      expect(bytes / KIB).toBeLessThanOrEqual(budget);
    });
  }
});
