import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The insight pages may import server code (eslint.config.ts), which is safe only while they are
// server components: a "use client" file there would put server code in a client bundle. The
// shared server-only components live in app/_components; keep them server-side too.
const DIRS = ["(insights)", "_components"].map((dir) => join(import.meta.dirname, dir));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("insight pages", () => {
  it("are all server components", () => {
    const files = DIRS.flatMap(sources);
    expect(files.length).toBeGreaterThan(10);
    const client = files.filter((file) =>
      /^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
    );
    expect(client.map((file) => relative(import.meta.dirname, file))).toEqual([]);
  });
});
