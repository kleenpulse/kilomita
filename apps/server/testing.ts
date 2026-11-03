import { createHmac, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildServer, type ServerOptions } from "./app.ts";
import type { ServerConfig } from "./config.ts";
import type { TicketClaims } from "./ticket.ts";

/* Test helpers only. */

export const TEST_KEY = new Uint8Array(randomBytes(32));
export const WEB_ORIGIN = "https://kilomita.test";

export function signTicket(key: Uint8Array, claims: TicketClaims): string {
  const body = `k1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function freshTicket(cap = 50_000_000, now = Date.now()): string {
  return signTicket(TEST_KEY, {
    jti: randomBytes(16).toString("base64url"),
    exp: now + 120_000,
    cap,
  });
}

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    origins: new Set([WEB_ORIGIN]),
    ticketKey: TEST_KEY,
    protocol: "h1",
    budgetBytes: null,
    stateDir: null,
    ...overrides,
  };
}

export async function startServer(
  overrides: Partial<ServerConfig> = {},
  options: ServerOptions = {},
): Promise<{ origin: string; port: number; close: () => Promise<void> }> {
  const app = buildServer(testConfig(overrides), options);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      await app.close();
    },
  };
}
