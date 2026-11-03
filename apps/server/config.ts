import { ticketKey } from "./ticket.ts";

export type Protocol = "h1" | "h2c";

export interface ServerConfig {
  port: number;
  host: string;
  /** Exact web origins allowed to read responses (CORS). */
  origins: ReadonlySet<string>;
  ticketKey: Uint8Array;
  protocol: Protocol;
  /** Monthly payload budget in bytes, or null for none. */
  budgetBytes: number | null;
  /** Where the budget counter is saved, or null to keep it in memory only. */
  stateDir: string | null;
}

export class ConfigError extends Error {}

function parseOrigins(raw: string | undefined): Set<string> {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new ConfigError("KILOMITA_SERVER_ORIGINS is required.");
  const origins = new Set<string>();
  entries.forEach((entry, index) => {
    let url: URL | null = null;
    try {
      url = new URL(entry);
    } catch {
      url = null;
    }
    const valid =
      url !== null &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === entry;
    if (!valid) {
      throw new ConfigError(`KILOMITA_SERVER_ORIGINS entry ${index + 1} is not an exact origin.`);
    }
    origins.add(entry);
  });
  return origins;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 3940;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ConfigError("PORT must be an integer from 0 to 65535.");
  }
  return port;
}

function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) {
    throw new ConfigError("KILOMITA_EGRESS_BUDGET_GB must be a positive number.");
  }
  return Math.floor(gb * 1e9);
}

/** Reads the server's settings. Throws ConfigError, whose message never includes a secret. */
export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  const key = ticketKey(env.KILOMITA_SERVER_TICKET_SECRET);
  if (!key) {
    throw new ConfigError(
      "KILOMITA_SERVER_TICKET_SECRET must be base64 of exactly 32 random bytes.",
    );
  }
  const protocol = env.KILOMITA_SERVER_PROTOCOL ?? "h1";
  if (protocol !== "h1" && protocol !== "h2c") {
    throw new ConfigError("KILOMITA_SERVER_PROTOCOL must be h1 or h2c.");
  }
  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || "127.0.0.1",
    origins: parseOrigins(env.KILOMITA_SERVER_ORIGINS),
    ticketKey: key,
    protocol,
    budgetBytes: parseBudget(env.KILOMITA_EGRESS_BUDGET_GB),
    stateDir: env.KILOMITA_STATE_DIR?.trim() || null,
  };
}
