import type { BufferbloatGrade } from "@kilomita/shared";
import type { EngineResult } from "@kilomita/engine";

/*
 * Plain-language verdicts. Every threshold comes from a published source, retrieved 2026-11-01:
 *
 * [NF] Netflix Help, "Netflix-recommended internet speeds", https://help.netflix.com/en/node/306
 *      HD 720p "3 Mbps or higher", Full HD 1080p "5 Mbps or higher", Ultra HD 4K "15 Mbps or higher".
 * [YT] YouTube Help, "System requirements & supported devices",
 *      https://support.google.com/youtube/answer/78358 (recommended sustained speed):
 *      4K 20 Mbps, 1080p 5, 720p 2.5, 480p 1.1, 360p 0.7.
 * [ZM] Zoom KB0060748, "Zoom system requirements: Windows, macOS, Linux",
 *      https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060748
 *      1:1 video calling, "For 720p HD video: 1.2Mbps (up/down)".
 * [GM] Google Workspace, "Prepare your network for Meet",
 *      https://knowledge.workspace.google.com/admin/meet/prepare-your-network-for-meet-meetings-and-live-streams
 *      720p video "Up to 1.7 Mbps" outbound and inbound.
 * [WF] Waveform's bufferbloat test script, the same archived file the engine cites for grades:
 *      https://web.archive.org/web/20260707132656id_/https://bufferbloat.waveform.com/static/js/main.28a58a9c.js
 *      Its activity table (bits per second and ms):
 *        {name:"Web Browsing",criteria:{downlink:[LARGER_THAN,2e6],uplink:[LARGER_THAN,1e5],latency:[SMALLER_THAN,500]}}
 *        {name:"Audio Calls",criteria:{downlink:[LARGER_THAN,1e5],uplink:[LARGER_THAN,1e5],latency_95th:[SMALLER_THAN,400]}}
 *        {name:"Low Latency Gaming",criteria:{downlink:[LARGER_THAN,1e7],uplink:[LARGER_THAN,3e6],latency_95th:[SMALLER_THAN,40]}}
 *      Each latency limit is checked on the idle values and again on the loaded values; failing
 *      only under load is "with bufferbloat". Its fail test is `LARGER_THAN && value < limit` or
 *      `SMALLER_THAN && value > limit`, so a value exactly on a limit passes; so it does here.
 *      Its FAQ calls the criteria "a good general guideline".
 *
 * For video calls and 4K, the apps' own published figures are used (maintainer's choice), not
 * Waveform's stricter generic 10/5 Mbps video conferencing and 25 Mbps 4K rules.
 */

export type VerdictInput = Pick<
  EngineResult,
  "downloadMbps" | "uploadMbps" | "latency" | "loadedLatency" | "loadedP95Ms"
>;

export type FailReason = "speed" | "latency" | "bufferbloat";

export interface ActivityVerdict {
  id: "browsing" | "voice" | "video" | "streaming" | "gaming";
  label: string;
  ok: boolean;
  reason?: FailReason;
}

export type StreamingLevel = "4K" | "Full HD" | "HD" | "SD" | null;

export interface Verdicts {
  headline: string;
  streaming: StreamingLevel;
  activities: ActivityVerdict[];
}

interface Rule {
  minDownMbps: number;
  minUpMbps: number;
  /** Latency limit and which statistic it applies to, as in the source. */
  latency?: { maxMs: number; stat: "median" | "p95" };
}

/** [WF] Web Browsing. Waveform's plain `latency` is compared with our medians. */
const BROWSING: Rule = { minDownMbps: 2, minUpMbps: 0.1, latency: { maxMs: 500, stat: "median" } };
/** [WF] Audio Calls. */
const VOICE: Rule = { minDownMbps: 0.1, minUpMbps: 0.1, latency: { maxMs: 400, stat: "p95" } };
/** [GM] 720p 1.7 Mbps each way, the stricter of [GM] and [ZM] 1.2; latency as [WF] Audio Calls. */
const VIDEO: Rule = { minDownMbps: 1.7, minUpMbps: 1.7, latency: { maxMs: 400, stat: "p95" } };
/** [WF] Low Latency Gaming. */
const GAMING: Rule = { minDownMbps: 10, minUpMbps: 3, latency: { maxMs: 40, stat: "p95" } };

/** Highest first. Where [NF] and [YT] differ, the stricter figure. */
const STREAMING_LEVELS: readonly (readonly [number, Exclude<StreamingLevel, null>])[] = [
  [20, "4K"], // [YT] 20 (Netflix 15)
  [5, "Full HD"], // [NF] and [YT] 5
  [3, "HD"], // [NF] 3 (YouTube 2.5)
  [1.1, "SD"], // [YT] 480p 1.1
];

function check(rule: Rule, input: VerdictInput): { ok: boolean; reason?: FailReason } {
  if (input.downloadMbps < rule.minDownMbps || input.uploadMbps < rule.minUpMbps) {
    return { ok: false, reason: "speed" };
  }
  if (!rule.latency) return { ok: true };
  const { maxMs, stat } = rule.latency;
  const idle = stat === "p95" ? input.latency.idleP95Ms : input.latency.idleMedianMs;
  if (idle > maxMs) return { ok: false, reason: "latency" };
  const loaded =
    stat === "p95"
      ? Math.max(input.loadedP95Ms.download, input.loadedP95Ms.upload)
      : Math.max(input.loadedLatency.downloadMs, input.loadedLatency.uploadMs);
  if (loaded > maxMs) return { ok: false, reason: "bufferbloat" };
  return { ok: true };
}

export function streamingLevel(downloadMbps: number): StreamingLevel {
  for (const [minMbps, level] of STREAMING_LEVELS) if (downloadMbps >= minMbps) return level;
  return null;
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${String(items.at(-1))}`;
}

export function judge(input: VerdictInput): Verdicts {
  const streaming = streamingLevel(input.downloadMbps);
  const streams = streaming === "4K" || streaming === "Full HD" || streaming === "HD";
  const browsing = check(BROWSING, input);
  const voice = check(VOICE, input);
  const video = check(VIDEO, input);
  const gaming = check(GAMING, input);

  const activities: ActivityVerdict[] = [
    {
      id: "streaming",
      label: streaming && streaming !== "SD" ? `${streaming} video` : "HD video",
      ok: streams,
      ...(streams ? {} : { reason: "speed" as const }),
    },
    { id: "video", label: "HD video calls", ...video },
    { id: "gaming", label: "Online gaming", ...gaming },
    { id: "voice", label: "Voice calls", ...voice },
    { id: "browsing", label: "Web browsing", ...browsing },
  ];

  const good: string[] = [];
  if (streams) good.push(`${streaming} streaming`);
  if (video.ok) good.push("video calls");
  if (gaming.ok) good.push("gaming");

  let headline: string;
  if (good.length > 0) headline = `Good for ${joinList(good)}.`;
  else if (browsing.ok && voice.ok)
    headline = "Fine for browsing and voice calls. Video may struggle.";
  else if (browsing.ok) headline = "Fine for browsing. Calls may struggle.";
  else headline = "Very slow. Even browsing may struggle.";

  return { headline, streaming, activities };
}

export const REASON_TEXT: Record<FailReason, string> = {
  speed: "too slow",
  latency: "latency too high",
  bufferbloat: "lags under load",
};

/** Waveform's grade bands (A < 30 ms, B < 60, C < 200, D < 400, F), in plain words. */
export const GRADE_TEXT: Record<BufferbloatGrade, string> = {
  A: "Barely changes when the line is busy.",
  B: "Rises a little when the line is busy.",
  C: "Calls and games may lag while the line is busy.",
  D: "Calls and games will likely lag while the line is busy.",
  F: "Calls and games suffer badly while the line is busy.",
};
