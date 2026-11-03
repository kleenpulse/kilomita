import type { EngineResult } from "@kilomita/engine";
import { ISPS } from "@kilomita/shared/lists";
import { formatMbps } from "./format";
import type { NetworkSelection } from "./share";
import { type ShareCard, encodeShareCode, lagosDay } from "./share-code";

/*
 * Loaded with import() once a result is on screen, never at page load, so none of this is in the
 * home page's first download. Nothing here talks to our server: the link carries the card.
 */

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** The card for the result on screen: only what the screen shows. */
export function cardFromResult(result: EngineResult, selection: NetworkSelection): ShareCard {
  return {
    downloadMbps: result.downloadMbps,
    uploadMbps: result.uploadMbps,
    latencyMs: Math.round(result.latency.idleMedianMs),
    grade: result.loadedLatency.grade,
    isp: selection.isp === "other" ? null : selection.isp,
    state: selection.state,
    day: lagosDay(Date.parse(result.measuredAt)),
  };
}

/** The share link, or null for numbers no card can show (they would 404). */
export function shareUrl(card: ShareCard, origin: string): string | null {
  const code = encodeShareCode(card);
  return code === null ? null : `${origin}/r/${code}`;
}

export function shareText(card: ShareCard): string {
  const isp = ISPS.find((entry) => entry.slug === card.isp);
  const on = isp ? ` on ${isp.name}` : "";
  return `My speed test: ${formatMbps(card.downloadMbps)} Mbps down, ${formatMbps(card.uploadMbps)} Mbps up${on}.`;
}

export function whatsAppHref(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

/** The system share sheet where there is one, otherwise the clipboard. */
export async function shareLink(
  text: string,
  url: string,
  nav: Pick<Navigator, "share" | "clipboard"> = navigator,
): Promise<ShareOutcome> {
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: "My speed test result", text, url });
      return "shared";
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await nav.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
