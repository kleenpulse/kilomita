import type { BufferbloatGrade, IspSlug, NigerianStateSlug } from "@kilomita/shared";
import { ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";
import { formatMbps } from "./format";

/*
 * Share links carry the numbers themselves (/r/<code>), so nothing is stored or looked up: the
 * link is exactly what the person chose to post. Anyone can type one, so the card says it isn't
 * checked by us. Only the canonical spelling of a card decodes, so look-alike URLs can't multiply.
 * Fields are joined with "_" because state slugs contain "-".
 */

export interface ShareCard {
  downloadMbps: number;
  uploadMbps: number;
  /** Idle median, whole ms. */
  latencyMs: number;
  grade: BufferbloatGrade;
  /** The network shown on the result, if one was chosen (never "other"). */
  isp: IspSlug | null;
  state: NigerianStateSlug | null;
  /** The day the test ran, in Lagos (YYYY-MM-DD). */
  day: string;
}

const MAX_MBPS = 10_000;
const MAX_LATENCY_MS = 60_000;
/** No card can predate KiloMita's first test servers. */
const FIRST_DAY = "2026-11-01";
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GRADES = new Set(["A", "B", "C", "D", "F"]);
const ISP_SLUGS = new Set<string>(ISPS.map((isp) => isp.slug).filter((slug) => slug !== "other"));
const STATE_SLUGS = new Set<string>(NIGERIAN_STATES.map((state) => state.slug));

/** Nigeria keeps UTC+1 all year. */
export function lagosDay(ms: number): string {
  return new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Mbps exactly as the result screen shows it, or null if out of range. */
function mbps(value: number): string | null {
  return value > 0 && value <= MAX_MBPS ? formatMbps(value) : null;
}

export function encodeShareCode(card: ShareCard): string | null {
  const down = mbps(card.downloadMbps);
  const up = mbps(card.uploadMbps);
  const latency = Math.round(card.latencyMs);
  if (!down || !up || latency < 0 || latency > MAX_LATENCY_MS) return null;
  const parts = [`d${down}`, `u${up}`, `l${String(latency)}`, `g${card.grade}`];
  if (card.isp) parts.push(`i${card.isp}`);
  if (card.state) parts.push(`s${card.state}`);
  parts.push(`t${card.day.replaceAll("-", "")}`);
  return parts.join("_");
}

/** The card a code stands for, or null unless it is a canonical, in-range code. */
export function decodeShareCode(code: string, now: number): ShareCard | null {
  const match =
    /^d([0-9.]+)_u([0-9.]+)_l(0|[1-9][0-9]{0,4})_g([A-F])(?:_i([a-z0-9-]+))?(?:_s([a-z-]+))?_t([0-9]{8})$/.exec(
      code,
    );
  if (!match) return null;
  const [, down, up, latency, grade, isp, state, date] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string | undefined,
    string | undefined,
    string,
  ];
  const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (!GRADES.has(grade)) return null;
  if (isp !== undefined && !ISP_SLUGS.has(isp)) return null;
  if (state !== undefined && !STATE_SLUGS.has(state)) return null;
  if (
    Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ||
    lagosDay(Date.parse(`${day}T12:00:00Z`)) !== day
  ) {
    return null;
  }
  if (day < FIRST_DAY || day > lagosDay(now + DAY_MS)) return null;
  const card: ShareCard = {
    downloadMbps: Number(down),
    uploadMbps: Number(up),
    latencyMs: Number(latency),
    grade: grade as BufferbloatGrade,
    isp: (isp ?? null) as IspSlug | null,
    state: (state ?? null) as NigerianStateSlug | null,
    day,
  };
  // Canonical only: "023", "8.40" or "1e1" would otherwise be second spellings of one card.
  return encodeShareCode(card) === code ? card : null;
}
