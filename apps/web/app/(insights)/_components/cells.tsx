import type { StatsCell } from "@kilomita/shared";
import { bandLabel, formatMbps, formatMs, formatRange, isFewResults } from "@/lib/insights-format";
import { type Placed, sharedPlaces } from "@/lib/tiers";
import { MUTED } from "./page-header";

export type Published = Extract<StatsCell, { enough: true }>;

export const isPublished = (cell: StatsCell): cell is Published => cell.enough;

const CARD = "rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

/** Download, upload and latency, each with its 95% range. */
export function Metrics({ cell }: { cell: Published }) {
  const rows = [
    ["Download", formatMbps(cell.downloadMbps), formatRange(cell.interval.downloadMbps)],
    ["Upload", formatMbps(cell.uploadMbps), formatRange(cell.interval.uploadMbps)],
    ["Latency", formatMs(cell.latencyMs), formatRange(cell.interval.latencyMs)],
  ] as const;
  return (
    <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
      {rows.map(([label, value, range]) => (
        <div key={label} className="contents">
          <dt className={MUTED}>{label}</dt>
          <dd className="font-semibold">{value}</dd>
          <dd className={MUTED}>
            <span className="sr-only">95% range </span>
            {range}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SampleSize({ cell }: { cell: Published }) {
  return (
    <p className={`text-xs ${MUTED}`}>
      {bandLabel(cell.nBand)}
      {isFewResults(cell.nBand) ? (
        <>
          {" · "}
          <span className="font-medium text-amber-800 dark:text-amber-300">
            Few results, read with care
          </span>
        </>
      ) : null}
    </p>
  );
}

/** One group's card. `place` is shown as "1", or "=1" when shared. */
export function CellCard({
  cell,
  name,
  href,
  placed,
}: {
  cell: Published;
  name: string;
  href?: string | undefined;
  placed?: Placed<Published> | undefined;
}) {
  return (
    <li className={CARD} data-testid="cell-card">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        {placed ? (
          <span className="text-base font-bold tabular-nums">
            <span aria-hidden="true">
              {placed.shared ? "=" : ""}
              {placed.place}
            </span>
            <span className="sr-only">
              {placed.shared
                ? `Shared place ${String(placed.place)}:`
                : `Place ${String(placed.place)}:`}
            </span>
          </span>
        ) : null}
        <h3 className="text-base font-semibold">
          {href ? (
            <a href={href} className="underline underline-offset-2">
              {name}
            </a>
          ) : (
            name
          )}
        </h3>
      </div>
      <Metrics cell={cell} />
      <div className="mt-2">
        <SampleSize cell={cell} />
      </div>
    </li>
  );
}

/**
 * Ranked groups (by median download, places shared where ranges overlap), then the groups without
 * enough results, by name only.
 */
export function Ranking({
  cells,
  name,
  href,
  unranked = [],
}: {
  cells: readonly StatsCell[];
  name: (key: string) => string;
  href?: (key: string) => string | undefined;
  /** Shown after the ranking without a place, e.g. "Other". */
  unranked?: readonly string[];
}) {
  const ranked = cells.filter(
    (cell) => isPublished(cell) && !unranked.includes(cell.key),
  ) as Published[];
  const placed = sharedPlaces(
    ranked,
    (cell) => cell.downloadMbps,
    (cell) => cell.interval.downloadMbps,
  );
  const extra = cells.filter(
    (cell) => isPublished(cell) && unranked.includes(cell.key),
  ) as Published[];
  const hidden = cells.filter((cell) => !cell.enough).map((cell) => name(cell.key));
  return (
    <>
      {placed.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>No network has enough results here yet.</p>
      ) : (
        <ol className="space-y-3" aria-label="Ranking">
          {placed.map((entry) => (
            <CellCard
              key={entry.item.key}
              cell={entry.item}
              name={name(entry.item.key)}
              href={href?.(entry.item.key)}
              placed={entry}
            />
          ))}
        </ol>
      )}
      {extra.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {extra.map((cell) => (
            <CellCard key={cell.key} cell={cell} name={name(cell.key)} href={href?.(cell.key)} />
          ))}
        </ul>
      ) : null}
      {hidden.length > 0 ? (
        <p className={`mt-4 text-sm ${MUTED}`} data-testid="not-enough">
          <span className="font-medium">Not enough results yet:</span> {hidden.join(", ")}.
        </p>
      ) : null}
    </>
  );
}
