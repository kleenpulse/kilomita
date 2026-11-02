import type { IspSlug } from "./isps";

/*
 * Autonomous System Numbers of the ISPs in isps.ts. Verified 2026-11-02:
 *
 * - Discovery: every ASN RIPEstat lists for Nigeria
 *   (https://stat.ripe.net/data/country-resource-list/data.json?resource=NG, 306 ASNs), matched on
 *   the holder name, plus SpaceX's AS14593 for Starlink.
 * - Each row's `holder` is the exact string from its `source` (RIPEstat as-overview). Rows marked
 *   "not announced" were registered but routed nothing on that date; they stay so a re-announced
 *   ASN still maps.
 * - FiberOne: AS329267's AFRINIC contacts use @fob.ng
 *   (https://rdap.afrinic.net/rdap/autnum/329267), and https://fob.ng is "FiberOne Broadband".
 * - Starlink (AS14593) is SpaceX's global network, so it says nothing about the user's country.
 * - Deliberately not mapped: AS329244 "Connect, Surf and Smile Limited" (a different company),
 *   AS37127 Visafone (not MTN-named), and transit networks (MainOne 37282,
 *   IXPN 36940, Galaxy Backbone 37018).
 *
 * Re-verify by fetching each `source` and comparing `data.holder`. Never add a row without one.
 */

const RIPESTAT = "https://stat.ripe.net/data/as-overview/data.json?resource=AS";

export interface IspAsn {
  asn: number;
  isp: Exclude<IspSlug, "other">;
  holder: string;
  source: string;
}

function row(asn: number, isp: IspAsn["isp"], holder: string): IspAsn {
  return { asn, isp, holder, source: `${RIPESTAT}${String(asn)}` };
}

export const ISP_ASNS: readonly IspAsn[] = [
  row(29465, "mtn", "VCG-AS MTN NIGERIA Communication limited"),
  row(36933, "mtn", "MTN Nigeria - MTN Nigeria"), // not announced
  row(36873, "airtel", "Airtel Networks Limited - Airtel Networks Limited"),
  row(37148, "glo", "Globacom Limited - Globacom Limited"),
  row(328309, "glo", "Globacom Limited - Globacom Limited"), // not announced
  row(
    37076,
    "9mobile",
    "Emerging Markets Telecommunication Services (EMTS) Limited - Emerging Markets Telecommunication Services (EMTS) Limited",
  ),
  row(37340, "spectranet", "SPECTRANET LIMITED - SPECTRANET LIMITED"),
  row(329051, "spectranet", "SPECTRANET LIMITED - SPECTRANET LIMITED"), // not announced
  row(37637, "smile", "Smile Communications Nigeria - Smile Communications Nigeria"),
  row(329267, "fiberone", "FIBERONE BROADBAND LTD - FIBERONE BROADBAND LTD"),
  row(29091, "ipnx", "ipNX Nigeria Limited - ipNX Nigeria Limited"),
  row(37682, "tizeti", "Tizeti Network Limited - Tizeti Network Limited"),
  row(328630, "tizeti", "Tizeti Network Limited - Tizeti Network Limited"),
  row(14593, "starlink", "SPACEX-STARLINK - Space Exploration Technologies Corporation"),
];

const BY_ASN = new Map(ISP_ASNS.map((entry) => [entry.asn, entry.isp]));

/** The ISP behind an ASN; any ASN not in the table is "other". */
export function ispForAsn(asn: number): IspSlug {
  return BY_ASN.get(asn) ?? "other";
}
