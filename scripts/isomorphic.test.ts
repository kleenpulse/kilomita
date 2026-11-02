import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// shared and engine must run in browsers as well as Node. These probes prove both guards hold:
// the package tsconfig rejects Node APIs at compile time, and the lint preset rejects them too.
const packageDir = (name: string) => join(import.meta.dirname, "..", "packages", name);

const ISOMORPHIC_PACKAGES = [
  {
    name: "shared",
    dir: packageDir("shared"),
    portable: "export const ok = JSON.stringify(globalThis.Math.max(1, 2));",
  },
  {
    // The engine gets the WebWorker lib: fetch, streams, abort and timers, but no DOM.
    name: "engine",
    dir: packageDir("engine"),
    portable: [
      "const controller = new AbortController();",
      'export const ok = fetch("https://example.com", { signal: controller.signal })',
      "  .then((response) => response.body?.getReader().read())",
      "  .then(() => performance.now() + Number(new ReadableStream().locked));",
    ].join("\n"),
  },
];

// The engine may run in a Web Worker (Phase 2), where the DOM doesn't exist.
const DOM_ACCESS_PROBES = [
  "export const a = document.title;",
  "export const b = window.location.href;",
  'export const c = localStorage.getItem("x");',
];

const NODE_ACCESS_PROBES = [
  "export const a = process.env.X;",
  "export const b = globalThis.process.env.Y;",
  "export const c = globalThis.Buffer.alloc(1);",
  'export const d = globalThis["process"];',
  "const { Buffer: e } = globalThis;\nexport { e };",
];

function typecheckProbe(packageDir: string, source: string): readonly ts.Diagnostic[] {
  const configPath = join(packageDir, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir);
  const probePath = join(packageDir, "__probe__.ts").replaceAll("\\", "/");

  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (path) => (path.replaceAll("\\", "/") === probePath ? source : readFile(path));
  host.fileExists = (path) => path.replaceAll("\\", "/") === probePath || fileExists(path);
  host.getSourceFile = (path, languageVersion) =>
    path.replaceAll("\\", "/") === probePath
      ? ts.createSourceFile(path, source, languageVersion)
      : getSourceFile(path, languageVersion);

  const program = ts.createProgram({ rootNames: [probePath], options: parsed.options, host });
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(probePath));
}

describe.each(ISOMORPHIC_PACKAGES)(
  "@kilomita/$name browser safety",
  { timeout: 60_000 },
  ({ dir, portable }) => {
    it("type-checks portable code", () => {
      expect(typecheckProbe(dir, portable)).toHaveLength(0);
    });

    it.each(NODE_ACCESS_PROBES)("rejects at compile time: %s", (probe) => {
      expect(typecheckProbe(dir, probe).length).toBeGreaterThan(0);
    });

    it("rejects every Node access in lint", async () => {
      const eslint = new ESLint({ cwd: dir });
      const source = [
        'import { readFileSync } from "node:fs";',
        'import path from "path";',
        ...NODE_ACCESS_PROBES,
        "export const keep = [readFileSync, path];",
      ].join("\n");

      const [result] = await eslint.lintText(source, { filePath: join(dir, "index.ts") });
      const restrictedLines = new Set(
        (result?.messages ?? [])
          .filter((message) => message.ruleId?.startsWith("no-restricted-"))
          .map((message) => message.line),
      );

      expect(restrictedLines).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    });
  },
);

describe("@kilomita/engine guards", { timeout: 60_000 }, () => {
  const dir = packageDir("engine");

  it.each(DOM_ACCESS_PROBES)("rejects DOM access at compile time: %s", (probe) => {
    expect(typecheckProbe(dir, probe).length).toBeGreaterThan(0);
  });

  it("lints its own rules: real-time timers and value imports from shared", async () => {
    const eslint = new ESLint({ cwd: dir });
    const source = [
      'import { SpeedTestResultSchema } from "@kilomita/shared";',
      'import { type SpeedTestResult } from "@kilomita/shared";',
      'import type { NigerianState } from "@kilomita/shared";',
      "export const a = AbortSignal.timeout(1);",
      "export const b = AbortSignal.any([]);",
      "export const keep = [SpeedTestResultSchema] as const;",
      "export type Keep = [SpeedTestResult, NigerianState];",
    ].join("\n");

    const [result] = await eslint.lintText(source, { filePath: join(dir, "index.ts") });
    const flagged = new Map(
      (result?.messages ?? [])
        .filter((message) =>
          [
            "@typescript-eslint/no-restricted-imports",
            "@typescript-eslint/no-import-type-side-effects",
            "no-restricted-properties",
          ].includes(message.ruleId ?? ""),
        )
        .map((message) => [message.line, message.ruleId]),
    );

    // Line 3, the fully erased `import type`, is allowed.
    expect(flagged).toEqual(
      new Map([
        [1, "@typescript-eslint/no-restricted-imports"],
        [2, "@typescript-eslint/no-import-type-side-effects"],
        [4, "no-restricted-properties"],
        [5, "no-restricted-properties"],
      ]),
    );
  });
});

describe("@kilomita/shared ./lists guard", { timeout: 60_000 }, () => {
  const dir = packageDir("shared");
  const source = [
    'import { readFileSync } from "node:fs";',
    'import { z } from "zod";',
    'import { NetworkTypeSchema } from "./schemas";',
    "export const keep = [readFileSync, z, NetworkTypeSchema];",
  ].join("\n");

  async function flagged(file: string) {
    const eslint = new ESLint({ cwd: dir });
    const [result] = await eslint.lintText(source, { filePath: join(dir, file) });
    return (result?.messages ?? [])
      .filter((message) => message.ruleId?.endsWith("no-restricted-imports"))
      .map((message) => `${String(message.line)} ${message.ruleId ?? ""}`)
      .sort();
  }

  // The zod ban must not replace the Node ban: both rules fire on the same file.
  it.each(["lists.ts", "isps.ts", "states.ts", "network-types.ts", "sharing.ts"])(
    "keeps %s free of Node and zod",
    async (file) => {
      expect(await flagged(file)).toEqual([
        "1 no-restricted-imports",
        "2 @typescript-eslint/no-restricted-imports",
        "3 @typescript-eslint/no-restricted-imports",
      ]);
    },
  );

  it("lets the rest of shared use zod, but still not Node", async () => {
    expect(await flagged("schemas.ts")).toEqual(["1 no-restricted-imports"]);
  });
});
