import { APP_NAME } from "@kilomita/shared";
import { ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";
import { formatMbps } from "@/lib/format";
import type { ShareCard } from "@/lib/share-code";

/** What a share card says, for the page and its preview image alike. */
export interface CardText {
  download: string;
  upload: string;
  latency: string;
  grade: string;
  /** "MTN · Lagos", or null when neither was chosen. */
  place: string | null;
  day: string;
  headline: string;
}

export const NOT_CHECKED = `Shared by a ${APP_NAME} user, not checked by us.`;

export function cardText(card: ShareCard): CardText {
  const isp = ISPS.find((entry) => entry.slug === card.isp)?.name;
  const state = NIGERIAN_STATES.find((entry) => entry.slug === card.state)?.name;
  const place = [isp, state].filter(Boolean).join(" · ") || null;
  const download = formatMbps(card.downloadMbps);
  return {
    download,
    upload: formatMbps(card.uploadMbps),
    latency: String(card.latencyMs),
    grade: card.grade,
    place,
    day: new Intl.DateTimeFormat("en-NG", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(Date.parse(`${card.day}T00:00:00Z`)),
    headline: isp ? `${download} Mbps download on ${isp}` : `${download} Mbps download`,
  };
}
