import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// shared and engine must run in browsers as well as Node. These probes prove both guards hold:
// the package tsconfig rejects Node APIs at compile time, and the lint preset rejects them too.
const ISOMORPHIC_PACKAGES = ["shared", "engine"].map((name) => ({
  name,
  dir: join(import.meta.dirname, "..", "packages", name),
}));

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
  ({ dir }) => {
    it("type-checks plain portable code", () => {
      expect(
        typecheckProbe(dir, "export const ok = JSON.stringify(globalThis.Math.max(1, 2));"),
      ).toHaveLength(0);
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
