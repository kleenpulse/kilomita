/*
 * Places in a ranking, shared where the 95% ranges overlap. Items are sorted by value, highest
 * first; walking down the list, an item joins the current place if its range overlaps the range of
 * that place's first item (its leader), otherwise it starts the next place. Overlap is not
 * transitive (A overlaps B, B overlaps C, A doesn't overlap C), so it is always checked against
 * the leader: A and B share a place and C gets the next one. Overlapping ranges are not a
 * significance test; the pages say "their ranges overlap", never "statistically tied".
 */

export interface Placed<T> {
  item: T;
  /** 1 for the first place, 2 for the next, and so on (dense). */
  place: number;
  /** More than one item holds this place. */
  shared: boolean;
}

type Range = readonly [low: number, high: number];

const overlaps = (a: Range, b: Range) => a[0] <= b[1] && b[0] <= a[1];

export function sharedPlaces<T>(
  items: readonly T[],
  value: (item: T) => number,
  range: (item: T) => Range,
): Placed<T>[] {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  const placed: Placed<T>[] = [];
  let leader: T | undefined;
  let place = 0;
  for (const item of sorted) {
    if (leader === undefined || !overlaps(range(item), range(leader))) {
      leader = item;
      place++;
    }
    placed.push({ item, place, shared: false });
  }
  for (const entry of placed) {
    entry.shared = placed.filter((other) => other.place === entry.place).length > 1;
  }
  return placed;
}
