import { createSpeedTest, selfHostedEndpoint, type FetchFn } from "@kilomita/engine";
import { SpeedTestResultSchema } from "@kilomita/shared";
import { afterEach, describe, expect, it } from "vitest";
import { freshTicket, startServer } from "./testing.ts";

/*
 * The FRD's acceptance: the real engine measures against the real server, over loopback only.
 * Node's fetch speaks HTTP/1.1 here; browsers go through Caddy with HTTP/2 or 3.
 */

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

function recording(): { fetch: FetchFn; contentTypes: (string | null)[]; posts: number } {
  const seen = { contentTypes: [] as (string | null)[], posts: 0 };
  const fetch: FetchFn = (input, init) => {
    if (init.method === "POST") {
      seen.posts++;
      seen.contentTypes.push(new Request(input, init).headers.get("content-type"));
    }
    return globalThis.fetch(input, init);
  };
  return {
    fetch,
    get contentTypes() {
      return seen.contentTypes;
    },
    get posts() {
      return seen.posts;
    },
  };
}

describe("engine against the real server", () => {
  it.each([false, true])(
    "completes a run (low-data: %s)",
    async (lowData) => {
      const server = await startServer();
      close = server.close;
      const transport = recording();
      const test = createSpeedTest({
        endpoints: [
          selfHostedEndpoint({ id: "local", origin: server.origin, ticket: freshTicket() }),
        ],
        lowData,
        fetch: transport.fetch,
      });
      const outcome = await test.start();
      if (outcome.status !== "complete") throw new Error(JSON.stringify(outcome.error));
      const { result } = outcome;
      expect(result.serverId).toBe("local");
      expect(result.downloadMbps).toBeGreaterThan(0);
      expect(result.uploadMbps).toBeGreaterThan(0);
      expect(result.bytesUsed).toBeLessThanOrEqual(lowData ? 10_000_000 : 50_000_000);
      expect(
        SpeedTestResultSchema.pick({
          downloadMbps: true,
          uploadMbps: true,
          latency: true,
          loadedLatency: true,
          bytesUsed: true,
          durationMs: true,
          lowDataMode: true,
          engineVersion: true,
          serverId: true,
          measuredAt: true,
        }).safeParse(result).success,
      ).toBe(true);
      // CORS-simple uploads: no Content-Type, so browsers send no preflight.
      expect(transport.posts).toBeGreaterThan(0);
      expect(transport.contentTypes.every((type) => type === null)).toBe(true);
    },
    60_000,
  );

  it("ends the run when the ticket's byte cap is used up", async () => {
    const server = await startServer();
    close = server.close;
    const test = createSpeedTest({
      endpoints: [
        selfHostedEndpoint({ id: "local", origin: server.origin, ticket: freshTicket(2_000_000) }),
      ],
    });
    const outcome = await test.start();
    expect(outcome).toMatchObject({
      status: "error",
      error: { code: "endpoint-error", status: 403 },
    });
  }, 60_000);
});
