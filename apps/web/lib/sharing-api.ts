import type { CorrectResult, SubmitResult } from "@kilomita/shared";
import { SHARING } from "@kilomita/shared/lists";
import type { TestServer } from "./test-servers";

/** A test token as the browser holds it. */
export interface HeldToken {
  value: string;
  expiresAt: number;
  lowData: boolean;
}

type FetchFn = typeof fetch;
const browserFetch: FetchFn = (input, init) => fetch(input, init);

async function send(
  fetchFn: FetchFn,
  path: string,
  method: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchFn(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Asked for before every run. null when sharing is unavailable; the test runs anyway. */
export async function requestToken(
  lowData: boolean,
  now: () => number = Date.now,
  fetchFn: FetchFn = browserFetch,
  timeoutMs = 3_000,
): Promise<HeldToken | null> {
  // Counted on this device's clock from the moment we asked, which is never after the server
  // issued it, so the device never thinks a token is fresher than it is.
  const asked = now();
  const response = await send(fetchFn, "/api/tokens", "POST", { lowData }, timeoutMs);
  if (!response?.ok) return null;
  try {
    const { token } = (await response.json()) as { token: unknown };
    if (typeof token !== "string") return null;
    return { value: token, expiresAt: asked + SHARING.tokenTtlMs, lowData };
  } catch {
    return null;
  }
}

/** What one run may test against (POST /api/test-servers). */
export interface RunServers {
  servers: TestServer[];
  fallback: boolean;
  /** Signed for our servers; null when none is offered. */
  ticket: string | null;
}

function isRunServers(value: unknown): value is RunServers {
  if (typeof value !== "object" || value === null) return false;
  const { servers, fallback, ticket } = value as Record<string, unknown>;
  return (
    Array.isArray(servers) &&
    servers.every(
      (server: unknown) =>
        typeof (server as TestServer | null)?.id === "string" &&
        typeof (server as TestServer | null)?.origin === "string",
    ) &&
    typeof fallback === "boolean" &&
    (ticket === null || typeof ticket === "string")
  );
}

/**
 * Asked for after Start, alongside the token. null if it can't be had, "rate-limited" if this
 * connection has started too many tests lately: either way the run can't start.
 */
export async function requestTestServers(
  lowData: boolean,
  fetchFn: FetchFn = browserFetch,
  timeoutMs = 3_000,
): Promise<RunServers | "rate-limited" | null> {
  const response = await send(fetchFn, "/api/test-servers", "POST", { lowData }, timeoutMs);
  if (response?.status === 429) {
    try {
      const { error } = (await response.json()) as { error?: unknown };
      return error === "rate-limited" ? "rate-limited" : null;
    } catch {
      return null;
    }
  }
  if (!response?.ok) return null;
  try {
    const body: unknown = await response.json();
    return isRunServers(body) ? body : null;
  } catch {
    return null;
  }
}

export type SubmitOutcome =
  | { status: "shared"; id: string }
  /** The server answered no: nothing was stored. */
  | { status: "refused"; reason: "too-old" | "unavailable" | "refused" }
  /** No answer, or a server error: the result may or may not be stored. */
  | { status: "unknown" };

export async function submitResult(
  body: SubmitResult,
  fetchFn: FetchFn = browserFetch,
  timeoutMs = 15_000,
): Promise<SubmitOutcome> {
  const response = await send(fetchFn, "/api/results", "POST", body, timeoutMs);
  if (!response) return { status: "unknown" };
  if (response.status === 200 || response.status === 201) {
    try {
      const { id } = (await response.json()) as { id: unknown };
      if (typeof id === "string") return { status: "shared", id };
    } catch {
      // Stored, but the answer was garbled: treat it as unanswered, so the secret is kept.
    }
    return { status: "unknown" };
  }
  if (response.status === 410) return { status: "refused", reason: "too-old" };
  if (response.status === 503) return { status: "refused", reason: "unavailable" };
  if (response.status >= 500) return { status: "unknown" };
  return { status: "refused", reason: "refused" };
}

export async function correctResult(
  id: string,
  body: CorrectResult,
  fetchFn: FetchFn = browserFetch,
): Promise<boolean> {
  const response = await send(
    fetchFn,
    `/api/results/${encodeURIComponent(id)}`,
    "PATCH",
    body,
    10_000,
  );
  return response?.ok ?? false;
}

/** How many stored results the secrets matched, or null if the request failed. */
export async function deleteResults(
  secrets: readonly string[],
  fetchFn: FetchFn = browserFetch,
): Promise<number | null> {
  const response = await send(fetchFn, "/api/results", "DELETE", { secrets }, 15_000);
  if (!response?.ok) return null;
  try {
    const { deleted } = (await response.json()) as { deleted: unknown };
    return typeof deleted === "number" ? deleted : null;
  } catch {
    return null;
  }
}
