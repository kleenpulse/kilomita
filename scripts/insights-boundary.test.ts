import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Web's server-only boundary (apps/web/eslint.config.ts): only the insight pages may import
// server code, and only through @/server/insights. These probes lint real files' paths with the
// real config, so a "must pass" case can't pass because the file was never linted or parsed.
const web = join(import.meta.dirname, "..", "apps", "web");

async function restricted(file: string, specifier: string) {
  const eslint = new ESLint({ cwd: web });
  const [result] = await eslint.lintText(`import "${specifier}";\n`, {
    filePath: join(web, file),
  });
  expect(result?.fatalErrorCount, `${file} parsed`).toBe(0);
  expect(result?.messages.filter((message) => message.fatal === true)).toEqual([]);
  return (result?.messages ?? []).some((message) => message.ruleId === "no-restricted-imports");
}

describe("web's server-only boundary", { timeout: 120_000 }, () => {
  const deepPage = "app/(insights)/isps/[slug]/page.tsx";

  it.each([
    "../../../../server/db/database",
    "../../../../server",
    "@/server",
    "@/server/stores",
    "@/server/insightsx",
    "@/server/insights/extra",
  ])("bans %s in an insight page four folders deep", async (specifier) => {
    expect(await restricted(deepPage, specifier)).toBe(true);
  });

  it.each(["@/server/insights", "next/server"])(
    "allows %s in an insight page",
    async (specifier) => {
      expect(await restricted(deepPage, specifier)).toBe(false);
    },
  );

  it.each([
    ["app/(insights)/_components/cells.tsx", "@/server/insights"],
    ["app/(insights)/_components/cells.tsx", "../../../server/stats"],
    ["app/page.tsx", "@/server/insights"],
    ["app/page.tsx", "./server/stats"],
    ["components/consent-card.tsx", "@/server/insights"],
    ["components/consent-card.tsx", "../server/stats"],
  ])("bans server code in %s (%s)", async (file, specifier) => {
    expect(await restricted(file, specifier)).toBe(true);
  });
});
