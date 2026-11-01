// Test helper: a fake fetch that simulates a network on Vitest's fake timers. Not exported from
// the package entry point.
import { vi } from "vitest";
import { cloudflareEndpoint } from "./cloudflare";
import { STANDARD_PROFILE } from "./profiles";
import type { RunContext } from "./runtime";
import type { FetchFn } from "./types";

export interface NetworkConditions {
  downMbps: number;
  upMbps: number;
  rttMs: number;
  /** Latency probes get a seeded, uniform ± this much. */
  jitterMs?: number;
  /** A single request's own limit, like one TCP flow, on top of the shared link. */
  perStreamMbps?: number;
  /** Link capacity ramps from 10% to full over this long after a direction's first byte. */
  slowStartMs?: number;
  /** Extra latency for probes while any transfer is moving. */
  bloatMs?: number;
  /** Server processing time, added to every response and reported in Server-Timing. */
  serverTimeMs?: number;
  /** Extra round trips on the very first request (DNS, TCP, TLS). */
  handshakeRtts?: number;
  /** Probability that a request fails with a network error. */
  failureRate?: number;
  /** Answer requests of a kind with this HTTP status. "loaded-probe": probes sent mid-transfer. */
  status?: { code: number; on: "all" | Kind | "loaded-probe" };
  /** From this long after creation on, every request fails with a network error. */
  dropAtMs?: number;
  /** From this long after creation on, nothing moves and nothing answers. */
  stallAtMs?: number;
  /** Link capacity compounds by this fraction per second after a direction's first byte. */
  capacityRampPerSec?: number;
  seed?: number;
}

export interface NetworkStats {
  /** Download bytes asked for plus upload bodies sent. */
  requestedBytes: number;
  calls: number;
  /** Requests whose body hasn't been read to the end or cancelled yet. */
  open: number;
  maxOpen: number;
  maxConcurrent: Record<Kind, number>;
}

export interface SimulatedNetwork {
  fetch: FetchFn;
  stats: NetworkStats;
}

type Kind = "probe" | "download" | "upload";

interface Transfer {
  kind: "download" | "upload";
  remaining: number;
  carry: number;
  /** Delivers download bytes, or receives upload bytes. */
  move(bytes: number): void;
  finish(): void;
  fail(error: Error): void;
}

const STEP_MS = 10;
/** Mbps to bytes per ms. */
const BYTES_PER_MS_PER_MBPS = 125;
const ZEROS = new Uint8Array(1 << 20);

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function createSimulatedNetwork(conditions: NetworkConditions): SimulatedNetwork {
  const origin = performance.now();
  const random = mulberry32(conditions.seed ?? 1);
  const stats: NetworkStats = {
    requestedBytes: 0,
    calls: 0,
    open: 0,
    maxOpen: 0,
    maxConcurrent: { probe: 0, download: 0, upload: 0 },
  };
  const transfers = new Set<Transfer>();
  const concurrent: Record<Kind, number> = { probe: 0, download: 0, upload: 0 };
  const firstByteAt: Partial<Record<"download" | "upload", number>> = {};
  let firstRequest = true;
  let scheduler: ReturnType<typeof setInterval> | undefined;

  const elapsed = () => performance.now() - origin;
  const dropped = () => conditions.dropAtMs !== undefined && elapsed() >= conditions.dropAtMs;
  const stalled = () => conditions.stallAtMs !== undefined && elapsed() >= conditions.stallAtMs;
  const headers = () => {
    const result = new Headers();
    if (conditions.serverTimeMs !== undefined) {
      result.set("server-timing", `cfSpeedWorker;dur=${conditions.serverTimeMs}`);
    }
    return result;
  };

  function capacity(kind: "download" | "upload"): number {
    const base =
      (kind === "download" ? conditions.downMbps : conditions.upMbps) * BYTES_PER_MS_PER_MBPS;
    const since = performance.now() - (firstByteAt[kind] ?? performance.now());
    const slowStart = conditions.slowStartMs
      ? Math.min(1, 0.1 + (0.9 * since) / conditions.slowStartMs)
      : 1;
    const ramp = (1 + (conditions.capacityRampPerSec ?? 0)) ** (since / 1000);
    return base * slowStart * ramp;
  }

  function step(): void {
    if (dropped()) {
      for (const transfer of [...transfers]) transfer.fail(new TypeError("Failed to fetch"));
      removeTransfer(undefined);
    } else if (!stalled()) {
      for (const kind of ["download", "upload"] as const) {
        const active = [...transfers].filter((transfer) => transfer.kind === kind);
        if (active.length === 0) continue;
        const perStream = (conditions.perStreamMbps ?? Infinity) * BYTES_PER_MS_PER_MBPS;
        const share = Math.min(perStream, capacity(kind) / active.length) * STEP_MS;
        for (const transfer of active) {
          transfer.carry += share;
          const bytes = Math.min(transfer.remaining, Math.floor(transfer.carry));
          transfer.carry -= bytes;
          transfer.remaining -= bytes;
          if (bytes > 0) transfer.move(bytes);
          if (transfer.remaining === 0) transfer.finish();
        }
      }
    }
  }

  function removeTransfer(transfer: Transfer | undefined): void {
    if (transfer) transfers.delete(transfer);
    if (transfers.size === 0 && scheduler !== undefined) {
      clearInterval(scheduler);
      scheduler = undefined;
    }
  }

  function addTransfer(transfer: Transfer): void {
    firstByteAt[transfer.kind] ??= performance.now();
    transfers.add(transfer);
    scheduler ??= setInterval(step, STEP_MS);
  }

  function track(kind: Kind): () => void {
    stats.calls++;
    stats.open++;
    stats.maxOpen = Math.max(stats.maxOpen, stats.open);
    concurrent[kind]++;
    stats.maxConcurrent[kind] = Math.max(stats.maxConcurrent[kind], concurrent[kind]);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      stats.open--;
      concurrent[kind]--;
    };
  }

  /** An empty body that only counts as consumed once it's read or cancelled. */
  function emptyBody(close: () => void): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.close();
          close();
        },
        cancel: close,
      },
      { highWaterMark: 0 },
    );
  }

  const fetch: FetchFn = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input);
      const kind: Kind =
        init.method === "POST"
          ? "upload"
          : Number(url.searchParams.get("bytes")) > 0
            ? "download"
            : "probe";
      const close = track(kind);
      const signal = init.signal ?? undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let transfer: Transfer | undefined;
      let settled = false;

      const fail = (error: Error) => {
        if (timer !== undefined) clearTimeout(timer);
        removeTransfer(transfer);
        close();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const answer = (response: Response) => {
        settled = true;
        resolve(response);
      };
      const onAbort = () => {
        fail(abortError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      /** Runs `then` after `ms`, unless the network drops or stalls first. */
      const later = (ms: number, then: () => void) => {
        timer = setTimeout(() => {
          timer = undefined;
          if (dropped()) fail(new TypeError("Failed to fetch"));
          else if (!stalled()) then();
        }, ms);
      };

      const { rttMs } = conditions;
      const serverMs = conditions.serverTimeMs ?? 0;
      const handshakeMs = firstRequest ? (conditions.handshakeRtts ?? 0) * rttMs : 0;
      firstRequest = false;
      const bytes =
        kind === "upload"
          ? (init.body as Uint8Array).byteLength
          : Number(url.searchParams.get("bytes"));
      if (kind !== "probe") stats.requestedBytes += bytes;

      if (dropped()) {
        fail(new TypeError("Failed to fetch"));
        return;
      }
      if (stalled()) return;
      if (random() < (conditions.failureRate ?? 0)) {
        later(handshakeMs + rttMs / 2, () => {
          fail(new TypeError("Failed to fetch"));
        });
        return;
      }
      const status = conditions.status;
      const loadedProbe = kind === "probe" && transfers.size > 0;
      if (
        status &&
        (status.on === "all" || status.on === kind || (status.on === "loaded-probe" && loadedProbe))
      ) {
        later(handshakeMs + rttMs + serverMs, () => {
          answer(new Response(emptyBody(close), { status: status.code, headers: headers() }));
        });
        return;
      }

      if (kind === "probe") {
        const jitter = (random() * 2 - 1) * (conditions.jitterMs ?? 0);
        const bloat = transfers.size > 0 ? (conditions.bloatMs ?? 0) : 0;
        later(handshakeMs + Math.max(1, rttMs + jitter) + bloat + serverMs, () => {
          answer(new Response(emptyBody(close), { headers: headers() }));
        });
        return;
      }

      if (kind === "download") {
        later(handshakeMs + rttMs + serverMs, () => {
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          let ended = false;
          const end = () => {
            ended = true;
            removeTransfer(download);
            close();
          };
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
            cancel: end,
          });
          const download: Transfer = {
            kind: "download",
            remaining: bytes,
            carry: 0,
            move(count) {
              for (let sent = 0; sent < count; sent += ZEROS.length) {
                controller.enqueue(ZEROS.subarray(0, Math.min(ZEROS.length, count - sent)));
              }
            },
            finish() {
              if (ended) return;
              end();
              controller.close();
            },
            fail(error) {
              if (ended) return;
              end();
              controller.error(error);
            },
          };
          transfer = download;
          signal?.removeEventListener("abort", onAbort);
          signal?.addEventListener(
            "abort",
            () => {
              download.fail(abortError());
            },
            { once: true },
          );
          addTransfer(download);
          answer(new Response(body, { headers: headers() }));
        });
        return;
      }

      const upload: Transfer = {
        kind: "upload",
        remaining: bytes,
        carry: 0,
        move() {
          // Bytes leave the client; nothing to deliver.
        },
        finish() {
          removeTransfer(upload);
          later(rttMs + serverMs, () => {
            answer(new Response(emptyBody(close), { headers: headers() }));
          });
        },
        fail,
      };
      transfer = upload;
      if (handshakeMs > 0)
        later(handshakeMs, () => {
          addTransfer(upload);
        });
      else addTransfer(upload);
    });

  return { fetch, stats };
}

/** Makes any test that forgets to inject `fetch` fail instead of reaching a real server. */
export function blockRealNetwork(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network access is blocked in tests. Inject `fetch`.");
  });
}

/** A run context for testing one part of the engine on its own. */
export function testContext(fetch: FetchFn, overrides: Partial<RunContext> = {}): RunContext {
  return {
    fetchFn: fetch,
    endpoint: cloudflareEndpoint,
    profile: STANDARD_PROFILE,
    signal: new AbortController().signal,
    deadline: performance.now() + 60_000,
    usage: { bytes: 0 },
    progress: () => undefined,
    ...overrides,
  };
}

/** Wraps a fetch so it throws like a browser's native fetch when called with a foreign `this`. */
export function strictThisFetch(inner: FetchFn): FetchFn {
  return function (this: unknown, input: string, init: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return inner(input, init);
  };
}
