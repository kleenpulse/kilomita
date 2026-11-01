import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const STORE = join(ROOT, "node_modules", ".bun");
const WORKSPACE_DIRS = ["apps", "packages"];

const ALLOWED = new Set([
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-or-later",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
]);

// Data packages whose licence is not a software licence but is compatible with how we use them.
// Each exception is pinned to the exact licence it was reviewed under; a change fails the check.
const DATA_EXCEPTIONS: Record<string, { license: string; reason: string }> = {
  "caniuse-lite": {
    license: "CC-BY-4.0",
    reason: "browser-support data, consumed at build time by browserslist",
  },
};

export interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
}

export function readLicense(pkg: PackageJson): string | undefined {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  const legacy = pkg.licenses?.map((entry) => entry.type).filter(Boolean);
  if (legacy && legacy.length > 0) return legacy.join(" OR ");
  return undefined;
}

export function satisfies(expression: string): boolean {
  const tokens = expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/);
  let position = 0;

  const parseAtom = (): boolean => {
    const token = tokens[position++];
    if (token === "(") {
      const result = parseOr();
      if (tokens[position++] !== ")") return false;
      return result;
    }
    if (tokens[position] === "WITH") position += 2;
    return token !== undefined && ALLOWED.has(token.replace(/\+$/, "-or-later"));
  };

  const parseAnd = (): boolean => {
    let result = parseAtom();
    while (tokens[position] === "AND") {
      position++;
      result = parseAtom() && result;
    }
    return result;
  };

  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[position] === "OR") {
      position++;
      result = parseAnd() || result;
    }
    return result;
  };

  return parseOr() && position === tokens.length;
}

export function storeEntryToName(entry: string): string | undefined {
  const versionAt = entry.indexOf("@", entry.startsWith("@") ? 1 : 0);
  if (versionAt <= 0) return undefined;
  const raw = entry.slice(0, versionAt);
  return raw.startsWith("@") ? raw.replace("+", "/") : raw;
}

function collectManifests(): string[] {
  const manifests: string[] = [join(ROOT, "package.json")];
  if (existsSync(STORE)) {
    for (const entry of readdirSync(STORE)) {
      const name = storeEntryToName(entry);
      if (!name) continue;
      const manifest = join(STORE, entry, "node_modules", name, "package.json");
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  for (const dir of WORKSPACE_DIRS) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    for (const workspace of readdirSync(base)) {
      const manifest = join(base, workspace, "package.json");
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  return manifests;
}

function main(): void {
  const seen = new Set<string>();
  const failures: string[] = [];
  let exceptions = 0;

  for (const manifest of collectManifests()) {
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as PackageJson;
    const name = pkg.name ?? manifest;
    const id = `${name}@${pkg.version ?? "?"}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const license = readLicense(pkg);
    const exception = DATA_EXCEPTIONS[name];
    if (license === undefined) {
      failures.push(`${id}  (missing licence field)`);
    } else if (exception && exception.license === license) {
      exceptions++;
      console.log(`exception  ${id}  ${license}: ${exception.reason}`);
    } else if (exception) {
      failures.push(`${id}  ${license} (exception was reviewed for ${exception.license})`);
    } else if (!satisfies(license)) {
      failures.push(`${id}  ${license}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} package(s) outside the AGPL-3.0-compatible allowlist:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log(`\nLicences OK: ${seen.size} packages checked, ${exceptions} data exception(s).`);
}

if (import.meta.main) main();
