/*
 * Which test servers a deployment uses, read at runtime (not baked into the build):
 * KILOMITA_TEST_SERVERS ("id=origin,id=origin") and KILOMITA_CLOUDFLARE_FALLBACK ("on" / "off").
 * Pure and import-free, so the server-list route and plausibility read them the same way.
 */

export interface TestServer {
  id: string;
  /** e.g. https://lagos-1.example.ng, without a path. */
  origin: string;
}

export interface TestServerConfig {
  servers: TestServer[];
  /**
   * Whether Cloudflare's endpoints may be used when no server of ours answers. Off in production
   * unless set: Cloudflare hasn't given written permission (CLAUDE.md, launch blockers).
   */
  fallback: boolean;
  /** Problems to log once. They name an entry's position, never its value. */
  warnings: string[];
}

const ID = /^[a-z0-9-]{1,32}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function originOf(raw: string): { origin: string; local: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== raw) return null;
  if (url.protocol === "https:") return { origin: raw, local: LOCAL_HOSTS.has(url.hostname) };
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
    return { origin: raw, local: true };
  return null;
}

export function parseTestServers(env: Record<string, string | undefined>): TestServerConfig {
  const production = env.NODE_ENV === "production";
  const warnings: string[] = [];
  const servers: TestServer[] = [];
  const entries = (env.KILOMITA_TEST_SERVERS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  entries.forEach((entry, index) => {
    const at = entry.indexOf("=");
    const id = entry.slice(0, at);
    const parsed = at > 0 ? originOf(entry.slice(at + 1)) : null;
    const position = `KILOMITA_TEST_SERVERS entry ${String(index + 1)}`;
    if (!parsed || !ID.test(id) || id === "cloudflare") {
      warnings.push(`${position} is not id=origin; it is ignored.`);
      return;
    }
    if (servers.some((server) => server.id === id)) {
      warnings.push(`${position} repeats an id; it is ignored.`);
      return;
    }
    if (parsed.local && production) warnings.push(`${position} points at this machine.`);
    servers.push({ id, origin: parsed.origin });
  });

  const flag = env.KILOMITA_CLOUDFLARE_FALLBACK?.trim();
  const fallback = flag === "on" || (flag !== "off" && env.NODE_ENV === "development");
  return { servers, fallback, warnings };
}

/** The server ids a result may name: ours, plus Cloudflare only while the fallback is on. */
export function knownServerIds(config: TestServerConfig): ReadonlySet<string> {
  const ids = new Set(config.servers.map((server) => server.id));
  if (config.fallback) ids.add("cloudflare");
  return ids;
}
