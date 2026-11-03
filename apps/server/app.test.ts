import { request as h1Request, type IncomingMessage } from "node:http";
import { connect } from "node:http2";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES } from "./app.ts";
import { Budget } from "./budget.ts";
import type { ServerOptions } from "./app.ts";
import type { ServerConfig } from "./config.ts";
import { freshTicket, startServer, WEB_ORIGIN } from "./testing.ts";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function serve(overrides: Partial<ServerConfig> = {}, options: ServerOptions = {}) {
  const server = await startServer(overrides, options);
  close = server.close;
  return server;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A raw HTTP/1.1 request that hands back the response without reading its body. */
function open(
  port: number,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): {
  response: Promise<IncomingMessage>;
  write: (chunk: Buffer) => boolean;
  drained: () => Promise<void>;
  end: () => void;
} {
  const req = h1Request({
    host: "127.0.0.1",
    port,
    path,
    method: init.method ?? "GET",
    headers: init.headers,
  });
  req.on("error", () => undefined);
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    req.once("response", resolve);
    req.once("error", reject);
  });
  if ((init.method ?? "GET") === "GET") req.end();
  return {
    response,
    write: (chunk) => req.write(chunk),
    // Also settles if the request dies, so a pump never waits forever.
    drained: () =>
      new Promise((resolve) => {
        const done = () => {
          req.off("drain", done);
          req.off("close", done);
          resolve();
        };
        req.once("drain", done);
        req.once("close", done);
      }),
    end: () => req.end(),
  };
}

/** Resolves once the response is cut off or ends. */
function closed(response: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    response.once("close", () => {
      resolve();
    });
  });
}

async function upload(
  port: number,
  ticket: string,
  bytes: number,
  chunked: boolean,
): Promise<number> {
  const headers: Record<string, string> = chunked
    ? { "transfer-encoding": "chunked" }
    : { "content-length": String(bytes) };
  const req = open(port, `/up?t=${ticket}`, { method: "POST", headers });
  const piece = Buffer.alloc(64 * 1024, 7);
  let left = bytes;
  const pump = async () => {
    while (left > 0) {
      const size = Math.min(piece.byteLength, left);
      left -= size;
      if (!req.write(piece.subarray(0, size))) await req.drained();
    }
    req.end();
  };
  void pump().catch(() => undefined);
  const response = await req.response;
  response.resume();
  return response.statusCode ?? 0;
}

describe("routes", () => {
  it("answers /ping with an empty, uncached, timed response", async () => {
    const { origin } = await serve();
    const response = await fetch(`${origin}/ping?t=${freshTicket()}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("server-timing")).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });

  it.each([0, 1, 1024 * 1024 + 1, MAX_DOWNLOAD_BYTES])("serves exactly %i bytes", async (bytes) => {
    const { origin } = await serve();
    const response = await fetch(`${origin}/down?bytes=${bytes}&t=${freshTicket()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-length")).toBe(String(bytes));
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect((await response.arrayBuffer()).byteLength).toBe(bytes);
  });

  it("serves incompressible bytes", async () => {
    const { origin } = await serve();
    const response = await fetch(`${origin}/down?bytes=${1024 * 1024 + 1}&t=${freshTicket()}`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(gzipSync(body).byteLength / body.byteLength).toBeGreaterThan(0.99);
  });

  it.each(["", "abc", "-1", "1.5", "1e6", String(MAX_DOWNLOAD_BYTES + 1), "9999999999"])(
    "refuses bytes=%j",
    async (bytes) => {
      const { origin } = await serve();
      const response = await fetch(`${origin}/down?bytes=${bytes}&t=${freshTicket()}`);
      expect(response.status).toBe(400);
    },
  );

  it("drains an upload and answers after the last byte", async () => {
    const { origin } = await serve();
    const response = await fetch(`${origin}/up?t=${freshTicket()}`, {
      method: "POST",
      body: new Uint8Array(1_000_000),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/^app;dur=/);
  });

  it.each([false, true])(
    "accepts %s-chunked uploads of exactly the limit and refuses one byte more with 413",
    async (chunked) => {
      const { port } = await serve();
      expect(await upload(port, freshTicket(), MAX_UPLOAD_BYTES, chunked)).toBe(200);
      expect(await upload(port, freshTicket(), MAX_UPLOAD_BYTES + 1, chunked)).toBe(413);
    },
    // 16 MB through loopback; under turbo's parallel load it can pass 5 s.
    30_000,
  );

  it("reports health without a ticket and with no counts", async () => {
    const { origin } = await serve();
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("tickets", () => {
  it("refuses requests without a valid ticket, so a bare curl loop gets nothing", async () => {
    const { origin } = await serve();
    for (const path of ["/ping", "/down?bytes=1000", "/down?bytes=1000&t=junk"]) {
      expect((await fetch(`${origin}${path}`)).status).toBe(403);
    }
    expect((await fetch(`${origin}/up`, { method: "POST", body: "x" })).status).toBe(403);
    const expired = freshTicket(50_000_000, Date.now() - 200_000);
    expect((await fetch(`${origin}/ping?t=${expired}`)).status).toBe(403);
  });

  it("caps the bytes a ticket may move, uploads included", async () => {
    const { origin } = await serve();
    const ticket = freshTicket(1_000);
    const first = await fetch(`${origin}/down?bytes=600&t=${ticket}`);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    expect((await fetch(`${origin}/down?bytes=600&t=${ticket}`)).status).toBe(403);
    const up = await fetch(`${origin}/up?t=${ticket}`, {
      method: "POST",
      body: new Uint8Array(500),
    });
    expect(up.status).toBe(403);
  });
});

describe("budget", () => {
  it("refuses a download that doesn't fit before sending a byte, and reports it", async () => {
    // The last day of the month, when the day's slice is all that is left.
    const budget = new Budget(1_000, () => Date.parse("2026-11-30T12:00:00Z"));
    const { origin } = await serve({}, { budget });
    expect((await fetch(`${origin}/down?bytes=2000&t=${freshTicket()}`)).status).toBe(503);
    expect(budget.snapshot().monthBytes).toBe(0);
    const ok = await fetch(`${origin}/down?bytes=1000&t=${freshTicket()}`);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    await sleep(50);
    expect((await fetch(`${origin}/ping?t=${freshTicket()}`)).status).toBe(503);
    expect((await fetch(`${origin}/down?bytes=1&t=${freshTicket()}`)).status).toBe(503);
    const up = await fetch(`${origin}/up?t=${freshTicket()}`, { method: "POST", body: "x" });
    expect(up.status).toBe(503);
    expect(await (await fetch(`${origin}/health`)).json()).toEqual({ status: "over-budget" });
  });
});

describe("cors", () => {
  it("lets only the web origin read responses, and exposes Server-Timing", async () => {
    const { origin } = await serve();
    const allowed = await fetch(`${origin}/ping?t=${freshTicket()}`, {
      headers: { origin: WEB_ORIGIN },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(allowed.headers.get("access-control-expose-headers")).toBe("Server-Timing");
    expect(allowed.headers.get("timing-allow-origin")).toBe(WEB_ORIGIN);

    const other = await fetch(`${origin}/ping?t=${freshTicket()}`, {
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(other.headers.get("timing-allow-origin")).toBeNull();
  });

  it("answers preflights for the web origin only", async () => {
    const { origin } = await serve();
    const preflight = await fetch(`${origin}/up`, {
      method: "OPTIONS",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST");
    expect(preflight.headers.get("access-control-max-age")).toBe("7200");
    const other = await fetch(`${origin}/up`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(other.headers.get("access-control-allow-methods")).toBeNull();
  });
});

describe("slots and slow clients", () => {
  it("refuses transfers past the cap with 503", async () => {
    const { port } = await serve({}, { maxTransfers: 1 });
    const slow = open(port, `/down?bytes=${MAX_DOWNLOAD_BYTES}&t=${freshTicket()}`);
    const response = await slow.response;
    response.pause();
    const second = await fetch(`http://127.0.0.1:${port}/down?bytes=10&t=${freshTicket()}`);
    expect(second.status).toBe(503);
    response.destroy();
  });

  it("cuts off a reader that stops reading and frees its slot", async () => {
    const { port } = await serve({}, { maxTransfers: 1, stallMs: 300 });
    const slow = open(port, `/down?bytes=${MAX_DOWNLOAD_BYTES}&t=${freshTicket()}`);
    const response = await slow.response;
    response.once("data", () => response.pause());
    // A paused client can't see the close until it reads again, so check the server's side: the
    // only slot is free again once the stall timeout has passed.
    await sleep(800);
    const next = await fetch(`http://127.0.0.1:${port}/down?bytes=10&t=${freshTicket()}`);
    expect(next.status).toBe(200);
    const ended = closed(response);
    response.resume();
    await ended;
    expect(response.complete).toBe(false);
  });

  it("cuts off an uploader that stops sending and frees its slot", async () => {
    const { port } = await serve({}, { maxTransfers: 1, stallMs: 300 });
    const req = open(port, `/up?t=${freshTicket()}`, {
      method: "POST",
      headers: { "content-length": "100000" },
    });
    req.write(Buffer.alloc(1_000));
    await expect(req.response).rejects.toThrow();
    await sleep(50);
    const next = await fetch(`http://127.0.0.1:${port}/ping?t=${freshTicket()}`);
    expect(next.status).toBe(200);
    const up = await fetch(`http://127.0.0.1:${port}/up?t=${freshTicket()}`, {
      method: "POST",
      body: new Uint8Array(10),
    });
    expect(up.status).toBe(200);
  });

  it("cuts off a transfer that keeps trickling past the deadline", async () => {
    const { port } = await serve({}, { stallMs: 10_000, deadlineMs: 500 });
    const slow = open(port, `/down?bytes=${MAX_DOWNLOAD_BYTES}&t=${freshTicket()}`);
    const response = await slow.response;
    const started = Date.now();
    response.on("data", () => {
      response.pause();
      setTimeout(() => response.resume(), 20);
    });
    await closed(response);
    expect(response.complete).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("HTTP/2 (h2c)", () => {
  function h2(port: number, path: string, body?: Buffer) {
    return new Promise<{ status: number; bytes: number }>((resolve, reject) => {
      const session = connect(`http://127.0.0.1:${port}`);
      session.on("error", reject);
      const stream = session.request({
        ":method": body ? "POST" : "GET",
        ":path": path,
      });
      let status = 0;
      let bytes = 0;
      stream.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
      });
      const done = () => {
        session.close();
        resolve({ status, bytes });
      };
      stream.on("end", done);
      stream.on("close", done);
      stream.on("error", () => undefined);
      if (body) {
        let offset = 0;
        const pump = () => {
          while (offset < body.byteLength) {
            const next = body.subarray(offset, offset + 64 * 1024);
            offset += next.byteLength;
            if (!stream.write(next)) {
              stream.once("drain", pump);
              return;
            }
          }
          stream.end();
        };
        pump();
      } else {
        stream.end();
      }
    });
  }

  it("cuts off a stalled stream without dropping the shared session", async () => {
    const { port } = await serve({ protocol: "h2c" }, { stallMs: 300 });
    const session = connect(`http://127.0.0.1:${port}`);
    try {
      const slow = session.request({
        ":path": `/down?bytes=${MAX_DOWNLOAD_BYTES}&t=${freshTicket()}`,
      });
      slow.once("data", () => slow.pause());
      slow.on("error", () => undefined);
      await new Promise((resolve) => slow.once("close", resolve));
      expect(slow.rstCode).not.toBe(0);
      expect(session.destroyed).toBe(false);
      const status = await new Promise<number>((resolve) => {
        const ping = session.request({ ":path": `/ping?t=${freshTicket()}` });
        ping.on("response", (headers) => {
          resolve(Number(headers[":status"]));
        });
        ping.resume();
        ping.end();
      });
      expect(status).toBe(200);
    } finally {
      session.close();
    }
  });

  it("serves ping, download and upload, and refuses an oversized upload", async () => {
    const { port } = await serve({ protocol: "h2c" });
    expect((await h2(port, `/ping?t=${freshTicket()}`)).status).toBe(200);
    expect(await h2(port, `/down?bytes=100000&t=${freshTicket()}`)).toEqual({
      status: 200,
      bytes: 100_000,
    });
    expect((await h2(port, `/up?t=${freshTicket()}`, Buffer.alloc(1_000_000))).status).toBe(200);
    expect(
      (await h2(port, `/up?t=${freshTicket()}`, Buffer.alloc(MAX_UPLOAD_BYTES + 1))).status,
    ).toBe(413);
  }, 30_000);
});

describe("privacy", () => {
  it("never writes the client's address anywhere, even on errors", async () => {
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const out = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(capture);
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(" "));
      }),
    );
    try {
      const { origin, port } = await serve({}, { maxTransfers: 2, stallMs: 300 });
      const headers = { "x-forwarded-for": "203.0.113.77", origin: "https://evil.example" };
      await (await fetch(`${origin}/ping?t=${freshTicket()}`, { headers })).text();
      await (await fetch(`${origin}/down?bytes=1000&t=${freshTicket()}`, { headers })).text();
      await (await fetch(`${origin}/down?bytes=abc&t=${freshTicket()}`, { headers })).text();
      await (await fetch(`${origin}/ping?t=bad`, { headers })).text();
      await (await fetch(`${origin}/nowhere`, { headers })).text();
      expect(await upload(port, freshTicket(), MAX_UPLOAD_BYTES + 1, true)).toBe(413);
      const aborted = open(port, `/down?bytes=${MAX_DOWNLOAD_BYTES}&t=${freshTicket()}`, {
        headers,
      });
      (await aborted.response).destroy();
      await sleep(400);
    } finally {
      out.mockRestore();
      err.mockRestore();
      for (const spy of consoles) spy.mockRestore();
    }
    const all = written.join("\n");
    expect(all).not.toContain("203.0.113.77");
    expect(all).not.toContain("127.0.0.1");
  }, 30_000);
});
