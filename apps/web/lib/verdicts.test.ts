import { describe, expect, it } from "vitest";
import { type VerdictInput, judge, streamingLevel } from "./verdicts";

/** A clean, fast line that passes everything; tests change one thing at a time. */
function line(overrides: {
  down?: number;
  up?: number;
  idleMedian?: number;
  idleP95?: number;
  loadedMedian?: number;
  loadedP95?: number;
}): VerdictInput {
  const idleMedian = overrides.idleMedian ?? 20;
  const loadedMedian = overrides.loadedMedian ?? 25;
  return {
    downloadMbps: overrides.down ?? 50,
    uploadMbps: overrides.up ?? 20,
    latency: {
      idleMedianMs: idleMedian,
      idleP95Ms: overrides.idleP95 ?? idleMedian,
      jitterMs: 2,
      requestLossPct: 0,
    },
    loadedLatency: { downloadMs: loadedMedian, uploadMs: loadedMedian, grade: "A" },
    loadedP95Ms: {
      download: overrides.loadedP95 ?? loadedMedian,
      upload: overrides.loadedP95 ?? loadedMedian,
    },
  };
}

function activity(input: VerdictInput, id: string) {
  const found = judge(input).activities.find((item) => item.id === id);
  if (!found) throw new Error(`No activity ${id}`);
  return found;
}

describe("streaming levels (Netflix, YouTube)", () => {
  it.each([
    [20, "4K"],
    [19.99, "Full HD"],
    [5, "Full HD"],
    [4.99, "HD"],
    [3, "HD"],
    [2.99, "SD"],
    [1.1, "SD"],
    [1.09, null],
    [0, null],
  ])("%s Mbps is %s", (mbps, level) => {
    expect(streamingLevel(mbps)).toBe(level);
  });

  it("counts streaming as good from HD up", () => {
    expect(activity(line({ down: 3 }), "streaming").ok).toBe(true);
    expect(activity(line({ down: 2.99 }), "streaming")).toMatchObject({
      ok: false,
      reason: "speed",
    });
  });
});

describe("video calls (Google Meet 720p, Waveform latency)", () => {
  it("needs 1.7 Mbps each way, a value on the limit passing", () => {
    expect(activity(line({ down: 1.7, up: 1.7 }), "video").ok).toBe(true);
    expect(activity(line({ down: 1.69, up: 1.7 }), "video")).toMatchObject({
      ok: false,
      reason: "speed",
    });
    expect(activity(line({ down: 1.7, up: 1.69 }), "video")).toMatchObject({
      ok: false,
      reason: "speed",
    });
  });

  it("fails on an idle p95 over 400 ms", () => {
    expect(activity(line({ idleP95: 400, loadedP95: 400 }), "video").ok).toBe(true);
    expect(activity(line({ idleP95: 401 }), "video")).toMatchObject({
      ok: false,
      reason: "latency",
    });
  });

  it("fails as bufferbloat when only the loaded p95 is over 400 ms", () => {
    expect(activity(line({ loadedMedian: 100, loadedP95: 401 }), "video")).toMatchObject({
      ok: false,
      reason: "bufferbloat",
    });
  });
});

describe("gaming (Waveform Low Latency Gaming)", () => {
  it("needs 10 Mbps down and 3 up", () => {
    expect(activity(line({ down: 10, up: 3 }), "gaming").ok).toBe(true);
    expect(activity(line({ down: 9.99 }), "gaming")).toMatchObject({ ok: false, reason: "speed" });
    expect(activity(line({ up: 2.99 }), "gaming")).toMatchObject({ ok: false, reason: "speed" });
  });

  it("needs an idle p95 of at most 40 ms", () => {
    expect(activity(line({ idleMedian: 20, idleP95: 40, loadedP95: 40 }), "gaming").ok).toBe(true);
    expect(activity(line({ idleMedian: 20, idleP95: 41 }), "gaming")).toMatchObject({
      ok: false,
      reason: "latency",
    });
  });

  it("judges load by the loaded p95, not the median", () => {
    // Median under load looks fine; the 95th percentile shows the spikes Waveform checks.
    expect(activity(line({ loadedMedian: 35, loadedP95: 150 }), "gaming")).toMatchObject({
      ok: false,
      reason: "bufferbloat",
    });
  });

  it("takes the worse of the download and upload phases", () => {
    const input = line({});
    input.loadedP95Ms = { download: 30, upload: 41 };
    expect(activity(input, "gaming")).toMatchObject({ ok: false, reason: "bufferbloat" });
  });
});

describe("voice calls and browsing (Waveform)", () => {
  it("voice needs 0.1 Mbps each way and a p95 of at most 400 ms", () => {
    expect(activity(line({ down: 0.1, up: 0.1 }), "voice").ok).toBe(true);
    expect(activity(line({ down: 0.09 }), "voice")).toMatchObject({ ok: false, reason: "speed" });
    expect(activity(line({ idleMedian: 100, idleP95: 401 }), "voice").reason).toBe("latency");
  });

  it("browsing needs 2 Mbps down, 0.1 up and a median of at most 500 ms", () => {
    expect(activity(line({ down: 2, up: 0.1 }), "browsing").ok).toBe(true);
    expect(activity(line({ down: 1.99 }), "browsing").reason).toBe("speed");
    expect(activity(line({ up: 0.09 }), "browsing").reason).toBe("speed");
    // Browsing uses the median: a high p95 alone doesn't fail it.
    expect(
      activity(line({ idleMedian: 500, idleP95: 900, loadedMedian: 500 }), "browsing").ok,
    ).toBe(true);
    expect(activity(line({ idleMedian: 501 }), "browsing").reason).toBe("latency");
    expect(activity(line({ loadedMedian: 501 }), "browsing").reason).toBe("bufferbloat");
  });
});

describe("headline", () => {
  it("lists every good use in a fixed order", () => {
    expect(judge(line({})).headline).toBe("Good for 4K streaming, video calls and gaming.");
  });

  it("drops what fails", () => {
    expect(judge(line({ loadedMedian: 35, loadedP95: 150 })).headline).toBe(
      "Good for 4K streaming and video calls.",
    );
    expect(judge(line({ down: 4, up: 1 })).headline).toBe("Good for HD streaming.");
    expect(judge(line({ down: 2.5, up: 2 })).headline).toBe("Good for video calls.");
  });

  it("falls back to browsing and voice calls on a slow line", () => {
    expect(judge(line({ down: 2.2, up: 0.5 })).headline).toBe(
      "Fine for browsing and voice calls. Video may struggle.",
    );
  });

  it("falls back to browsing alone when calls lag", () => {
    expect(judge(line({ down: 2.2, up: 0.5, idleMedian: 300, idleP95: 450 })).headline).toBe(
      "Fine for browsing. Calls may struggle.",
    );
  });

  it("says so when even browsing struggles", () => {
    expect(judge(line({ down: 0.5, up: 0.2 })).headline).toBe(
      "Very slow. Even browsing may struggle.",
    );
  });
});
