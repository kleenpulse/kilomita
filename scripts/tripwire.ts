import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export const TRIPWIRE_SCRIPT = join(import.meta.dirname, "tripwire.sh");

export function findShell(pathValue = process.env.PATH ?? ""): string {
  if (process.platform !== "win32") return "sh";

  // Only absolute PATH entries: an empty or relative entry would resolve inside the folder being scanned.
  const onPath = pathValue
    .split(delimiter)
    .filter((dir) => dir !== "" && isAbsolute(dir))
    .map((dir) => join(dir, "sh.exe"))
    .find((candidate) => existsSync(candidate));
  if (onPath) return onPath;

  // Git for Windows ships sh.exe three levels above its exec path (…/Git/mingw64/libexec/git-core).
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const bundled = join(execPath, "..", "..", "..", "bin", "sh.exe");
  if (existsSync(bundled)) return bundled;

  throw new Error("No POSIX sh found. Install Git for Windows or run from Git Bash.");
}

if (import.meta.main) {
  const result = spawnSync(findShell(), [TRIPWIRE_SCRIPT], { stdio: "inherit" });
  process.exit(result.status ?? 2);
}
