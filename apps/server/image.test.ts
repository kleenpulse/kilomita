import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The Docker image copies a fixed list of server files. A new module that main.ts or healthcheck.ts
 * imports but the list leaves out makes the container fail at start (ERR_MODULE_NOT_FOUND), and
 * only Linux CI can build the image (Phase 7: apps/server/log.ts was missed). This test walks the
 * imports and checks the list, on any machine.
 */

const HERE = import.meta.dirname;
const ENTRIES = ["main.ts", "healthcheck.ts"];

/** The apps/server files the Dockerfile's runtime stage copies, as names relative to apps/server. */
export function copiedFiles(dockerfile: string): Set<string> {
  // Join continuation lines, then read each COPY that doesn't come from another stage.
  const lines = dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  const copied = new Set<string>();
  for (const line of lines) {
    const match = /^COPY\s+(?!--from)(.*)$/.exec(line.trim());
    if (!match) continue;
    const parts = (match[1] ?? "").trim().split(/\s+/).slice(0, -1);
    for (const part of parts) {
      if (part.startsWith("apps/server/")) copied.add(part.slice("apps/server/".length));
    }
  }
  return copied;
}

/** Every relative module reached from the entries, transitively. */
export function reachedFiles(
  read: (file: string) => string,
  entries: readonly string[],
): Set<string> {
  const reached = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift() ?? "";
    if (reached.has(file)) continue;
    reached.add(file);
    for (const [, specifier = ""] of read(file).matchAll(/from\s+"\.\/([^"]+\.ts)"/g)) {
      queue.push(specifier);
    }
    for (const [, specifier = ""] of read(file).matchAll(/import\(\s*"\.\/([^"]+\.ts)"\s*\)/g)) {
      queue.push(specifier);
    }
  }
  return reached;
}

describe("the Docker image", () => {
  const dockerfile = readFileSync(join(HERE, "deploy", "Dockerfile"), "utf8");
  const read = (file: string) => readFileSync(join(HERE, file), "utf8");

  it("copies every module the server and its health check import", () => {
    const copied = copiedFiles(dockerfile);
    const missing = [...reachedFiles(read, ENTRIES)].filter((file) => !copied.has(file));
    expect(missing).toEqual([]);
  });

  it("copies no test file or test helper", () => {
    const copied = [...copiedFiles(dockerfile)];
    expect(copied.filter((file) => /\.test\.ts$|^testing\.ts$/.test(file))).toEqual([]);
  });

  it("finds a missing file (the test can fail)", () => {
    const withoutLog = dockerfile.replace(" apps/server/log.ts", "");
    const copied = copiedFiles(withoutLog);
    const missing = [...reachedFiles(read, ENTRIES)].filter((file) => !copied.has(file));
    expect(missing).toEqual(["log.ts"]);
  });
});
