import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findShell, TRIPWIRE_SCRIPT } from "./tripwire";

// Markers are assembled at runtime so the literal strings never exist in this repo.
const G = "glob" + "al";
const LOADER_SPELLINGS = [
  `${G}['!'] = '8-x';`,
  `${G}["!"] = 1;`,
  `${G}.! = 1;`,
  `${G}This [ '!' ] = 1;`,
  `${G}.i = 'A8-x';`,
  `${G}['i']='Ax';`,
  `const tag = "${"4738" + "-2"}";`,
];
const PLANTED = LOADER_SPELLINGS[0] ?? "";

const SHELL = findShell();
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kilomita-tripwire-"));
  tempDirs.push(dir);
  return dir;
}

function writeFixture(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function runTripwire(cwd: string, env: Record<string, string> = {}) {
  return spawnSync(SHELL, [TRIPWIRE_SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(cwd), ...env },
  });
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
}

const CLEAN_FILES = {
  "package.json": '{ "scripts": { "check": "node scripts/check.ts" } }\n',
  "lib/ok.ts": "export const fetcher = globalThis.fetch;\n",
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("tripwire.sh repository mode", { timeout: 30_000 }, () => {
  it("refuses to report clean outside a git work tree", () => {
    const dir = makeTempDir();
    writeFixture(dir, { ...CLEAN_FILES, "lib/planted.ts": `${PLANTED}\n` });

    const result = runTripwire(dir);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a git work tree");
    expect(result.stdout).not.toContain("tripwire: clean");
  });

  it("passes a clean repository", () => {
    const dir = makeTempDir();
    writeFixture(dir, CLEAN_FILES);
    gitInit(dir);

    const result = runTripwire(dir);

    expect(result.stdout).toContain("tripwire: clean");
    expect(result.status).toBe(0);
  });

  it("flags a planted loader in an untracked file", () => {
    const dir = makeTempDir();
    writeFixture(dir, { ...CLEAN_FILES, "lib/planted.ts": `${PLANTED}\n` });
    gitInit(dir);

    const result = runTripwire(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("lib/planted.ts");
  });

  it("flags JS files, node droppers and folder-open tasks", () => {
    const dir = makeTempDir();
    writeFixture(dir, {
      "package.json": '{"scripts":{"ok":"node scripts/a.ts","dev":"node ./public/font.woff2"}}\n',
      "dropper.js": "x\n",
      ".vscode/tasks.json": '{"tasks":[{"runOptions":{"runOn":"folder' + 'Open"}}]}\n',
    });
    gitInit(dir);

    const result = runTripwire(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("dropper.js");
    expect(result.stdout).toContain("public/font.woff2");
    expect(result.stdout).not.toContain("scripts/a.ts");
    expect(result.stdout).toContain("tasks.json");
  });

  it.each([
    ["a flag before a JavaScript file", "node --watch evil.js"],
    ["code loaded by a flag", "node --require ./x.cjs main.ts"],
    ["inline code", "node -e 0"],
    ["NODE_OPTIONS", "NODE_OPTIONS=--import=data:text/javascript,0 node main.ts"],
    ["a background command", "true & node evil.js"],
    ["a chained command", "true && node evil.js"],
    ["a piped command", "echo | node evil.js"],
    ["a second command on a new line", "true\\nnode evil.js"],
    ["two files", "node main.ts evil.js"],
    ["a command substitution", "echo $(node evil.js)"],
    ["a backtick substitution", "echo `node evil.js`"],
    ["a subshell", "sh -c (node evil.js)"],
    ["node.exe", "node.exe evil.js"],
  ])("flags %s in a package.json script", (_name, script) => {
    const dir = makeTempDir();
    writeFixture(dir, {
      ...CLEAN_FILES,
      "package.json": `{ "scripts": { "check": "node scripts/check.ts", "x": "${script}" } }\n`,
    });
    gitInit(dir);

    const result = runTripwire(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("anything but one TypeScript file");
  });

  it.each([
    ["the watch flag", "node --watch main.ts"],
    ["the experimental-warning flag", "node --disable-warning=ExperimentalWarning main.ts"],
    ["a chain of TypeScript runs", "node a.ts && node b.ts"],
    ["a TypeScript run in a command substitution", "echo $(node main.ts)"],
    ["the node engine field", ""],
  ])("passes %s", (_name, script) => {
    const dir = makeTempDir();
    const scripts = script ? `, "x": "${script}"` : "";
    writeFixture(dir, {
      ...CLEAN_FILES,
      "package.json": `{ "engines": { "node": ">=20.9" }, "devDependencies": { "@types/node": "^24" }, "scripts": { "check": "node scripts/check.ts"${scripts} } }\n`,
    });
    gitInit(dir);

    const result = runTripwire(dir);

    expect(result.stdout).toContain("tripwire: clean");
    expect(result.status).toBe(0);
  });

  it("exits 2 when a scan errors instead of reporting clean", () => {
    const dir = makeTempDir();
    writeFixture(dir, CLEAN_FILES);
    gitInit(dir);

    const result = runTripwire(dir, { TRIPWIRE_EXTRA_PATTERN: "(" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("scan failed");
  });
});

describe("findShell", () => {
  it.runIf(process.platform === "win32")(
    "ignores empty and relative PATH entries that point into the current folder",
    () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "sh.exe"), "decoy");
      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        const shell = findShell(`${delimiter}.${delimiter}${process.env.PATH ?? ""}`);
        expect(isAbsolute(shell)).toBe(true);
        expect(shell.startsWith(dir)).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    },
  );
});

describe("tripwire.sh target mode", { timeout: 30_000 }, () => {
  it("passes a clean directory", () => {
    const dir = makeTempDir();
    writeFixture(dir, CLEAN_FILES);

    expect(runTripwire(dir, { TRIPWIRE_TARGET: dir }).status).toBe(0);
  });

  it.each(LOADER_SPELLINGS)("flags %s", (line) => {
    const dir = makeTempDir();
    writeFixture(dir, { "planted.ts": `x\t\t\t${line}\n` });

    const result = runTripwire(dir, { TRIPWIRE_TARGET: dir });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("planted.ts");
  });

  it("exits 2 when the scan errors", () => {
    const dir = makeTempDir();
    writeFixture(dir, CLEAN_FILES);

    const result = runTripwire(dir, { TRIPWIRE_TARGET: dir, TRIPWIRE_EXTRA_PATTERN: "(" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("scan failed");
  });
});
