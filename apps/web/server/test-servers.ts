import { type TestServerConfig, parseTestServers } from "../lib/test-servers";
import { tokenKey } from "./token";

/** Ticket requests allowed per minute per process: a CPU guard far above real traffic, not a
 * budget guard (the test servers' daily slice is that). A low ceiling would let one script block
 * every visitor's test, so it is deliberately high. */
export const TICKETS_PER_MINUTE = 60_000;

export interface TestServerSetup {
  config: TestServerConfig;
  /** null when KILOMITA_SERVER_TICKET_SECRET is missing or malformed: no own servers then. */
  key: Uint8Array | null;
}

/** A fixed one-minute window counter. */
export class MinuteGuard {
  readonly #max: number;
  #minute = -1;
  #count = 0;

  constructor(max: number) {
    this.#max = max;
  }

  allow(now: number): boolean {
    const minute = Math.floor(now / 60_000);
    if (minute !== this.#minute) {
      this.#minute = minute;
      this.#count = 0;
    }
    this.#count++;
    return this.#count <= this.#max;
  }
}

/*
 * One copy per process, on globalThis: Next loads route handlers and pages as separate module
 * graphs (see stores.ts), and the env never changes while the process runs.
 */
const SETUP: unique symbol = Symbol.for("kilomita.test-servers");
const GUARD: unique symbol = Symbol.for("kilomita.ticket-guard");
const shared = globalThis as {
  [SETUP]?: { raw: string; setup: TestServerSetup } | undefined;
  [GUARD]?: MinuteGuard | undefined;
};

type Env = Record<string, string | undefined>;

export function testServerSetup(env: Env = process.env): TestServerSetup {
  const raw = [
    env.KILOMITA_TEST_SERVERS,
    env.KILOMITA_CLOUDFLARE_FALLBACK,
    env.KILOMITA_SERVER_TICKET_SECRET,
    env.NODE_ENV,
  ].join("\n");
  const cached = shared[SETUP];
  if (cached?.raw === raw) return cached.setup;

  const config = parseTestServers(env);
  const key = tokenKey(env.KILOMITA_SERVER_TICKET_SECRET);
  for (const warning of config.warnings) console.warn(warning);
  if (config.servers.length > 0 && !key) {
    console.warn(
      "KILOMITA_SERVER_TICKET_SECRET is missing or malformed: own test servers are off.",
    );
  }
  const setup = { config, key };
  shared[SETUP] = { raw, setup };
  return setup;
}

export function ticketGuard(): MinuteGuard {
  shared[GUARD] ??= new MinuteGuard(TICKETS_PER_MINUTE);
  return shared[GUARD];
}
