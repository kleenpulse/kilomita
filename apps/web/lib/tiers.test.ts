import { describe, expect, it } from "vitest";
import { sharedPlaces } from "./tiers";

interface Isp {
  key: string;
  median: number;
  range: readonly [number, number];
}

const place = (items: Isp[]) =>
  sharedPlaces(
    items,
    (isp) => isp.median,
    (isp) => isp.range,
  ).map((entry) => [entry.item.key, entry.place, entry.shared]);

describe("sharedPlaces", () => {
  it("ranks by value, highest first, when no ranges overlap", () => {
    expect(
      place([
        { key: "glo", median: 9, range: [8, 10] },
        { key: "mtn", median: 22, range: [20, 24] },
      ]),
    ).toEqual([
      ["mtn", 1, false],
      ["glo", 2, false],
    ]);
  });

  it("shares a place when ranges overlap, the touching case included", () => {
    expect(
      place([
        { key: "mtn", median: 22, range: [20, 24] },
        { key: "airtel", median: 21, range: [19, 23] },
        { key: "glo", median: 9, range: [8, 10] },
        { key: "smile", median: 11, range: [10, 13] },
      ]),
    ).toEqual([
      ["mtn", 1, true],
      ["airtel", 1, true],
      ["smile", 2, true],
      ["glo", 2, true],
    ]);
  });

  it("checks overlap against the place's leader, not the previous item (not transitive)", () => {
    // A overlaps B, B overlaps C, but A doesn't overlap C.
    expect(
      place([
        { key: "a", median: 20, range: [18, 22] },
        { key: "b", median: 17, range: [15, 19] },
        { key: "c", median: 14, range: [12, 16] },
      ]),
    ).toEqual([
      ["a", 1, true],
      ["b", 1, true],
      ["c", 2, false],
    ]);
  });

  it("handles nothing and one item", () => {
    expect(place([])).toEqual([]);
    expect(place([{ key: "mtn", median: 1, range: [1, 1] }])).toEqual([["mtn", 1, false]]);
  });
});
