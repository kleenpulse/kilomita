import { describe, expect, it } from "vitest";
import { ISP_ASNS, ispForAsn } from "./asns";
import { ISPS } from "./isps";

describe("ISP_ASNS", () => {
  it("lists each ASN once", () => {
    expect(new Set(ISP_ASNS.map((entry) => entry.asn)).size).toBe(ISP_ASNS.length);
  });

  it("maps only to known ISPs, never to Other", () => {
    const slugs = new Set<string>(ISPS.map((isp) => isp.slug));
    for (const entry of ISP_ASNS) {
      expect(slugs.has(entry.isp)).toBe(true);
      expect(entry.isp).not.toBe("other");
    }
  });

  it("covers every ISP except Other", () => {
    const mapped = new Set<string>(ISP_ASNS.map((entry) => entry.isp));
    const unmapped = ISPS.filter((isp) => isp.slug !== "other" && !mapped.has(isp.slug));
    expect(unmapped).toEqual([]);
  });

  it("cites the RIPEstat record of its own ASN, with the holder it gave", () => {
    for (const entry of ISP_ASNS) {
      expect(entry.source).toBe(
        `https://stat.ripe.net/data/as-overview/data.json?resource=AS${String(entry.asn)}`,
      );
      expect(entry.holder.length).toBeGreaterThan(0);
    }
  });

  it("matches the verified table", () => {
    expect(ISP_ASNS.map((entry) => `${String(entry.asn)} ${entry.isp}`)).toEqual([
      "29465 mtn",
      "36933 mtn",
      "36873 airtel",
      "37148 glo",
      "328309 glo",
      "37076 9mobile",
      "37340 spectranet",
      "329051 spectranet",
      "37637 smile",
      "329267 fiberone",
      "29091 ipnx",
      "37682 tizeti",
      "328630 tizeti",
      "14593 starlink",
    ]);
  });
});

describe("ispForAsn", () => {
  it("finds the ISP behind a mapped ASN", () => {
    expect(ispForAsn(29465)).toBe("mtn");
    expect(ispForAsn(329267)).toBe("fiberone");
    expect(ispForAsn(14593)).toBe("starlink");
  });

  it("calls any other ASN Other", () => {
    expect(ispForAsn(13335)).toBe("other");
    expect(ispForAsn(329244)).toBe("other");
    expect(ispForAsn(0)).toBe("other");
  });
});
