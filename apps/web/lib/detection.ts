import type { IspSlug, NigerianStateSlug } from "@kilomita/shared";
import { ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";

export interface Detection {
  isp: IspSlug | null;
  state: NigerianStateSlug | null;
}

export const NOT_DETECTED: Detection = { isp: null, state: null };

/** Keeps only values from our own lists; anything else counts as not detected. */
export function parseDetection(json: unknown): Detection {
  if (typeof json !== "object" || json === null) return NOT_DETECTED;
  const { isp, state } = json as Record<string, unknown>;
  return {
    isp: ISPS.find((entry) => entry.slug === isp)?.slug ?? null,
    state: NIGERIAN_STATES.find((entry) => entry.slug === state)?.slug ?? null,
  };
}

/** Asks our server which network the visitor is on. Never rejects. */
export async function fetchDetection(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = 5000,
): Promise<Detection> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn("/api/network", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return NOT_DETECTED;
    return parseDetection(await response.json());
  } catch {
    return NOT_DETECTED;
  } finally {
    clearTimeout(timer);
  }
}
