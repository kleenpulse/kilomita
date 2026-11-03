import { randomBytes } from "node:crypto";
import { constants as http2Constants, Http2ServerRequest } from "node:http2";
import { Readable } from "node:stream";
import { fastify, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Budget } from "./budget.ts";
import type { ServerConfig } from "./config.ts";
import { corsHeaders, PREFLIGHT_HEADERS } from "./cors.ts";
import { TicketLedger, verifyTicket, type TicketClaims } from "./ticket.ts";

/** The engine's largest single download and upload requests (standard profile). */
export const MAX_DOWNLOAD_BYTES = 25_000_000;
export const MAX_UPLOAD_BYTES = 8_000_000;

const PAYLOAD_BYTES = 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

export interface ServerOptions {
  now?: () => number;
  budget?: Budget;
  /** Open transfers allowed at once; more get 503. */
  maxTransfers?: number;
  /** A transfer that moves no byte for this long is cut off. */
  stallMs?: number;
  /** No transfer may last longer than this. */
  deadlineMs?: number;
}

/**
 * The measurement server: /ping, /down, /up and /health. Every piece of state lives in here, so two
 * instances never share anything. Logging is off and no code reads the client's address.
 */
export function buildServer(config: ServerConfig, options: ServerOptions = {}): FastifyInstance {
  const now = options.now ?? Date.now;
  const budget = options.budget ?? new Budget(config.budgetBytes, now);
  const maxTransfers = options.maxTransfers ?? 256;
  const stallMs = options.stallMs ?? 10_000;
  const deadlineMs = options.deadlineMs ?? 30_000;
  const ledger = new TicketLedger();
  // Random bytes, so no proxy or modem can compress them and inflate the reading.
  const payload = randomBytes(PAYLOAD_BYTES);
  const startedAt = new WeakMap<FastifyRequest, number>();
  let open = 0;

  const common = {
    logger: false,
    trustProxy: false,
    // Backstops behind the per-transfer timers below.
    connectionTimeout: deadlineMs + 10_000,
    requestTimeout: deadlineMs + 5_000,
    http2SessionTimeout: deadlineMs + 10_000,
  } as const;
  // The handlers only use what HTTP/1.1 and HTTP/2 requests have in common (streams, destroy), so
  // one instance type serves both.
  const app = (config.protocol === "h2c"
    ? fastify({ ...common, http2: true })
    : fastify(common)) as unknown as FastifyInstance;

  const prune = setInterval(() => {
    ledger.prune(now());
  }, 30_000);
  prune.unref();
  app.addHook("onClose", () => {
    clearInterval(prune);
  });

  app.addHook("onRequest", (request, reply, done) => {
    startedAt.set(request, performance.now());
    reply.headers({
      "cache-control": "no-store, no-transform",
      ...corsHeaders(request.headers.origin, config.origins),
    });
    done();
  });

  app.addHook("onSend", (request, reply, body, done) => {
    const start = startedAt.get(request);
    if (start !== undefined) {
      reply.header("server-timing", `app;dur=${(performance.now() - start).toFixed(2)}`);
    }
    done(null, body);
  });

  // Upload bodies are drained by the /up handler itself, which counts every byte: Fastify's
  // bodyLimit only applies to parsers that buffer, and it treats a body with neither
  // Content-Type nor Content-Length as empty.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, _payload, done) => {
    done(null, undefined);
  });

  function ticketOf(request: FastifyRequest): TicketClaims | null {
    const value = (request.query as Record<string, unknown>).t;
    return typeof value === "string" ? verifyTicket(config.ticketKey, value, now()) : null;
  }

  /** The ticket if the request may be served; otherwise sends the refusal and returns null. */
  function admit(request: FastifyRequest, reply: FastifyReply): TicketClaims | null {
    const claims = ticketOf(request);
    if (!claims) {
      void reply.code(403).send();
      return null;
    }
    if (budget.status() !== "ok") {
      void reply.code(503).send();
      return null;
    }
    return claims;
  }

  /**
   * Cuts one transfer off. HTTP/1.1: destroy the response, which closes its socket (destroying a
   * fully read GET request leaves the socket open). HTTP/2: destroy only this stream, never the
   * session, which Caddy shares between many visitors.
   */
  function cutOff(request: FastifyRequest, reply: FastifyReply): void {
    const raw: unknown = request.raw;
    if (raw instanceof Http2ServerRequest) raw.stream.close(http2Constants.NGHTTP2_CANCEL);
    else reply.raw.destroy();
  }

  /** Runs `onDead` if the transfer stalls or outlives the deadline; `touch()` marks progress. */
  function watchdog(onDead: () => void): { touch: () => void; stop: () => void } {
    let stall = setTimeout(onDead, stallMs);
    const deadline = setTimeout(onDead, deadlineMs);
    return {
      touch: () => {
        clearTimeout(stall);
        stall = setTimeout(onDead, stallMs);
      },
      stop: () => {
        clearTimeout(stall);
        clearTimeout(deadline);
      },
    };
  }

  app.options("*", (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && config.origins.has(origin)) reply.headers(PREFLIGHT_HEADERS);
    return reply.code(204).send();
  });

  app.get("/health", (_request, reply) => reply.send({ status: budget.status() }));

  app.get("/ping", (request, reply) => {
    if (admit(request, reply)) return reply.code(200).send();
    return reply;
  });

  app.get("/down", (request, reply) => {
    const raw = (request.query as Record<string, unknown>).bytes;
    const bytes = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
    if (!(bytes <= MAX_DOWNLOAD_BYTES)) return reply.code(400).send();
    const claims = admit(request, reply);
    if (!claims) return reply;
    if (open >= maxTransfers) return reply.code(503).send();
    if (!ledger.charge(claims, bytes)) return reply.code(403).send();
    if (!budget.reserve(bytes)) {
      ledger.refund(claims, bytes);
      return reply.code(503).send();
    }

    open += 1;
    let sent = 0;
    const guard = watchdog(() => {
      cutOff(request, reply);
    });
    reply.raw.once("close", () => {
      open -= 1;
      guard.stop();
      budget.settle(bytes, sent);
      ledger.refund(claims, bytes - sent);
    });

    const body = new Readable({
      read() {
        guard.touch();
        if (sent >= bytes) {
          this.push(null);
          return;
        }
        const offset = sent % PAYLOAD_BYTES;
        const size = Math.min(CHUNK_BYTES, bytes - sent, PAYLOAD_BYTES - offset);
        sent += size;
        this.push(payload.subarray(offset, offset + size));
      },
    });
    return reply
      .header("content-type", "application/octet-stream")
      .header("content-length", bytes)
      .send(body);
  });

  app.post("/up", async (request, reply) => {
    const claims = admit(request, reply);
    if (!claims) return reply;
    if (open >= maxTransfers) return reply.code(503).send();

    open += 1;
    reply.raw.once("close", () => {
      open -= 1;
    });
    const stream = request.raw;
    const outcome = await new Promise<number | "aborted">((resolve) => {
      let received = 0;
      const guard = watchdog(() => {
        cutOff(request, reply);
      });
      const finish = (result: number | "aborted") => {
        guard.stop();
        stream.removeListener("data", onData);
        resolve(result);
      };
      const onData = (chunk: Buffer) => {
        guard.touch();
        received += chunk.byteLength;
        if (received > MAX_UPLOAD_BYTES) {
          finish(413);
          return;
        }
        if (!ledger.charge(claims, chunk.byteLength)) {
          finish(403);
          return;
        }
        budget.charge(chunk.byteLength);
      };
      stream.on("data", onData);
      stream.once("end", () => {
        finish(200);
      });
      stream.once("close", () => {
        if (!stream.readableEnded) finish("aborted");
      });
      stream.once("error", () => {
        finish("aborted");
      });
    });

    if (outcome === "aborted") {
      reply.hijack();
      return reply;
    }
    if (outcome !== 200) {
      // Refuse the rest of the body: answer, then drop the connection (or HTTP/2 stream).
      stream.pause();
      if (stream.httpVersionMajor === 1) reply.header("connection", "close");
      // Not at once: closing a socket with unread bytes resets it, and the reset can overtake the
      // answer. A second lets the client read why it was refused; the paused body sends no more.
      reply.raw.once("finish", () => {
        setTimeout(() => {
          cutOff(request, reply);
        }, 1_000).unref();
      });
    }
    return reply.code(outcome).send();
  });

  return app;
}
