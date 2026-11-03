import type { EngineResult } from "@kilomita/engine";
import { describe, expect, it } from "vitest";
import { CARD_FIELD_WORDS, SHARE_CAPTION } from "./share-caption";
import { cardFromResult, shareLink, shareText, shareUrl, whatsAppHref } from "./share-card";
import { type ShareCard, decodeShareCode, encodeShareCode, lagosDay } from "./share-code";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const CARD: ShareCard = {
  downloadMbps: 23.4,
  uploadMbps: 5.12,
  latencyMs: 34,
  grade: "B",
  isp: "mtn",
  state: "akwa-ibom",
  day: "2026-11-03",
};
const CODE = "d23_u5.1_l34_gB_imtn_sakwa-ibom_t20261103";

describe("share codes", () => {
  it("encodes exactly what the result screen shows", () => {
    expect(encodeShareCode(CARD)).toBe(CODE);
    expect(decodeShareCode(CODE, NOW)).toEqual({ ...CARD, downloadMbps: 23, uploadMbps: 5.1 });
  });

  it("round-trips cards without a network or state", () => {
    const bare = { ...CARD, downloadMbps: 0.85, isp: null, state: null };
    const code = encodeShareCode(bare);
    expect(code).toBe("d0.85_u5.1_l34_gB_t20261103");
    expect(decodeShareCode(code ?? "", NOW)).toEqual({ ...bare, uploadMbps: 5.1 });
  });

  it.each([
    ["a second spelling of a number", "d023_u5.1_l34_gB_t20261103"],
    ["trailing zeros", "d23.0_u5.1_l34_gB_t20261103"],
    ["exponent notation", "d2.3e1_u5.1_l34_gB_t20261103"],
    ["a leading-zero latency", "d23_u5.1_l034_gB_t20261103"],
    ["zero Mbps", "d0.00_u5.1_l34_gB_t20261103"],
    ["over 10,000 Mbps", "d10001_u5.1_l34_gB_t20261103"],
    ["latency over 60 s", "d23_u5.1_l60001_gB_t20261103"],
    ["an unknown grade", "d23_u5.1_l34_gE_t20261103"],
    ["an unknown ISP", "d23_u5.1_l34_gB_iacme_t20261103"],
    ["the Other ISP", "d23_u5.1_l34_gB_iother_t20261103"],
    ["an unknown state", "d23_u5.1_l34_gB_satlantis_t20261103"],
    ["fields out of order", "d23_u5.1_l34_gB_slagos_imtn_t20261103"],
    ["an impossible date", "d23_u5.1_l34_gB_t20260230"],
    ["a day before KiloMita", "d23_u5.1_l34_gB_t20261031"],
    ["a day after tomorrow", "d23_u5.1_l34_gB_t20261105"],
    ["extra fields", "d23_u5.1_l34_gB_t20261103_x1"],
    ["nothing", ""],
  ])("refuses %s", (_name, code) => {
    expect(decodeShareCode(code, NOW)).toBeNull();
  });

  it("accepts tomorrow, for clocks a little ahead of ours", () => {
    expect(decodeShareCode("d23_u5.1_l34_gB_t20261104", NOW)).not.toBeNull();
  });

  it("counts days in Lagos time", () => {
    expect(lagosDay(Date.parse("2026-11-03T22:59:59Z"))).toBe("2026-11-03");
    expect(lagosDay(Date.parse("2026-11-03T23:00:00Z"))).toBe("2026-11-04");
  });

  it("won't encode numbers no card can show", () => {
    expect(encodeShareCode({ ...CARD, downloadMbps: 0 })).toBeNull();
    expect(encodeShareCode({ ...CARD, uploadMbps: 20_000 })).toBeNull();
    expect(encodeShareCode({ ...CARD, latencyMs: 70_000 })).toBeNull();
  });
});

describe("the share caption", () => {
  it("names exactly the fields a link carries, so a new field can't slip in unannounced", () => {
    const decoded = decodeShareCode(CODE, NOW);
    expect(Object.keys(decoded ?? {}).sort()).toEqual(Object.keys(CARD_FIELD_WORDS).sort());
    const words = [...new Set(Object.values(CARD_FIELD_WORDS))];
    for (const word of words) expect(SHARE_CAPTION).toContain(word);
    expect(SHARE_CAPTION).toBe(
      "Shares a link with your speeds, latency, grade, network, state and the day.",
    );
  });
});

const RESULT = {
  downloadMbps: 23.4,
  uploadMbps: 5.12,
  latency: { idleMedianMs: 33.6, idleP95Ms: 41, jitterMs: 3, requestLossPct: 0 },
  loadedLatency: { downloadMs: 80, uploadMs: 70, grade: "B" },
  loadedP95Ms: { download: 90, upload: 80 },
  addedLatencyMs: 46,
  bytesUsed: 9_000_000,
  durationMs: 9_000,
  lowDataMode: true,
  engineVersion: "0.4.0",
  serverId: "lagos-secret-host-7",
  measuredAt: "2026-11-03T22:30:00.000Z",
  stoppedBy: { download: "stable", upload: "data-cap" },
} satisfies EngineResult;

describe("share links", () => {
  it("carry exactly the fields on screen: no server, token, ticket, secret or time of day", () => {
    const card = cardFromResult(RESULT, { isp: "mtn", state: "lagos", type: "4g" });
    const url = shareUrl(card, "https://kilomita.ng");
    expect(url).toBe("https://kilomita.ng/r/d23_u5.1_l34_gB_imtn_slagos_t20261103");
    for (const leak of ["lagos-secret-host", "4g", "9000000", "22", "30", "k1.", "v1."]) {
      expect(url?.replace("https://kilomita.ng/r/", "")).not.toContain(leak);
    }
  });

  it("leave out a network of Other", () => {
    const card = cardFromResult(RESULT, { isp: "other", state: null, type: "unknown" });
    expect(card.isp).toBeNull();
    expect(shareText(card)).toBe("My speed test: 23 Mbps down, 5.1 Mbps up.");
  });

  it("name the network in the share text", () => {
    const card = cardFromResult(RESULT, { isp: "mtn", state: null, type: "unknown" });
    expect(shareText(card)).toBe("My speed test: 23 Mbps down, 5.1 Mbps up on MTN.");
    expect(whatsAppHref("Hi there", "https://kilomita.ng/r/x")).toBe(
      "https://wa.me/?text=Hi%20there%20https%3A%2F%2Fkilomita.ng%2Fr%2Fx",
    );
  });

  it("use the share sheet where there is one, else the clipboard", async () => {
    const copied: string[] = [];
    const clipboard = {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    } as unknown as Clipboard;
    expect(await shareLink("t", "u", { share: () => Promise.resolve(), clipboard })).toBe("shared");
    const abort = () => Promise.reject(new DOMException("no", "AbortError"));
    expect(await shareLink("t", "u", { share: abort, clipboard })).toBe("cancelled");
    expect(await shareLink("t", "u", { clipboard } as unknown as Navigator)).toBe("copied");
    expect(copied).toEqual(["u"]);
    const broken = { writeText: () => Promise.reject(new Error("denied")) } as unknown as Clipboard;
    expect(await shareLink("t", "u", { clipboard: broken } as unknown as Navigator)).toBe("failed");
  });
});
