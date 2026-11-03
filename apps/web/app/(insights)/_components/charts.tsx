import type { StatsCell } from "@kilomita/shared";
import type { ReactNode } from "react";
import { niceScale } from "@/lib/chart-scale";
import { formatMbps, formatRange } from "@/lib/insights-format";
import { type Published, isPublished } from "./cells";
import { MUTED } from "./page-header";

/*
 * Server-rendered charts, no client JS. The plot is a fixed-height box (h-32 plus a 1.5rem axis
 * row), so nothing moves when it renders, and its text is HTML that never scales with the width.
 * Lines are SVG stretched to the box with non-scaling strokes. Hidden groups are gaps, never
 * zeros. Every chart has a table of the same numbers; hovering a column shows its value (title).
 * One series, one hue: blue #2a78d6 (dark #3987e5), the range as a 10% wash of it.
 */

const SERIES_FILL = "bg-[#2a78d6] dark:bg-[#3987e5]";
const SERIES_STROKE = "stroke-[#2a78d6] dark:stroke-[#3987e5]";
const BAND_FILL = "fill-[#2a78d6]/10 dark:fill-[#3987e5]/15";
const GRID = "border-neutral-200 dark:border-neutral-800";

interface Column {
  key: string;
  label: string;
  /** A link for the row label (tables only). */
  href?: string | undefined;
  cell: StatsCell;
}

const tip = (column: Column) =>
  isPublished(column.cell)
    ? `${column.label}: ${formatMbps(column.cell.downloadMbps)} (95% range ${formatRange(column.cell.interval.downloadMbps)})`
    : `${column.label}: not enough results yet`;

function Plot({
  columns,
  summary,
  axisLabels,
  axis = "spread",
  children,
}: {
  columns: readonly Column[];
  summary: string;
  axisLabels: readonly string[];
  axis?: "spread" | "grid";
  children: (top: number) => ReactNode;
}) {
  const highest = Math.max(
    0,
    ...columns.flatMap((column) =>
      isPublished(column.cell) ? [column.cell.interval.downloadMbps[1]] : [],
    ),
  );
  const { top, ticks } = niceScale(highest, 3);
  if (highest === 0) {
    // The same box as a drawn chart, so an empty chart takes the same room.
    return (
      <div role="img" aria-label={summary} className="h-41 pt-3">
        <div
          data-testid="plot"
          className={`flex h-32 items-center justify-center rounded-lg border border-dashed text-center text-sm ${GRID} ${MUTED}`}
          aria-hidden="true"
        >
          Not enough results yet to draw this.
        </div>
      </div>
    );
  }
  return (
    <div role="img" aria-label={summary} className="h-41 pt-3">
      <div className="relative h-32" aria-hidden="true" data-testid="plot">
        {ticks.map((tick) => (
          <div
            key={tick}
            className={`absolute inset-x-0 border-t ${GRID}`}
            style={{ bottom: `${String((tick / top) * 100)}%` }}
          >
            <span className={`absolute bottom-0 left-0 text-[0.6875rem] leading-tight ${MUTED}`}>
              {tick}
            </span>
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-8">{children(top)}</div>
        <div className="absolute inset-y-0 right-0 left-8 flex">
          {columns.map((column) => (
            <div key={column.key} className="h-full flex-1" title={tip(column)} />
          ))}
        </div>
      </div>
      {/* Spread: first, middle and last of a line. Grid: one cell per label, under its bars. */}
      <div
        className={`ml-8 h-6 items-end text-[0.6875rem] leading-tight ${MUTED} ${axis === "grid" ? "grid" : "flex justify-between"}`}
        style={
          axis === "grid"
            ? { gridTemplateColumns: `repeat(${String(axisLabels.length)}, minmax(0, 1fr))` }
            : undefined
        }
        aria-hidden="true"
      >
        {axisLabels.map((label, index) => (
          <span key={`${String(index)}-${label}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function NumbersTable({ columns, heading }: { columns: readonly Column[]; heading: string }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">
        Show the numbers
      </summary>
      <table className="mt-2 w-full text-left tabular-nums">
        <thead className={MUTED}>
          <tr>
            <th scope="col" className="py-1 font-medium">
              {heading}
            </th>
            <th scope="col" className="py-1 font-medium">
              Download
            </th>
            <th scope="col" className="py-1 font-medium">
              95% range
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.key} className={`border-t ${GRID}`}>
              <th scope="row" className="py-1 font-normal">
                {column.label}
              </th>
              {isPublished(column.cell) ? (
                <>
                  <td className="py-1">{formatMbps(column.cell.downloadMbps)}</td>
                  <td className="py-1">{formatRange(column.cell.interval.downloadMbps)}</td>
                </>
              ) : (
                <td className={`py-1 ${MUTED}`} colSpan={2}>
                  Not enough results yet
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function summarise(what: string, columns: readonly Column[]): string {
  const shown = columns.filter((column) => isPublished(column.cell));
  if (shown.length === 0) return `${what}: not enough results yet.`;
  const values = shown.map((column) => (column.cell as Published).downloadMbps);
  return `${what}: median download from ${formatMbps(Math.min(...values))} to ${formatMbps(Math.max(...values))} across ${String(shown.length)} of ${String(columns.length)} periods with enough results.`;
}

/** Median download over time with its 95% range; gaps where a day or week has too few results. */
export function TrendChart({ columns, heading }: { columns: readonly Column[]; heading: string }) {
  const count = columns.length;
  const x = (index: number) => ((index + 0.5) / count) * 100;
  const runs: { index: number; cell: Published }[][] = [];
  columns.forEach((column, index) => {
    if (!isPublished(column.cell)) return;
    const last = runs.at(-1);
    if (last && last.at(-1)?.index === index - 1) last.push({ index, cell: column.cell });
    else runs.push([{ index, cell: column.cell }]);
  });
  const first = columns[0]?.label ?? "";
  const lastLabel = columns.at(-1)?.label ?? "";
  return (
    <figure>
      <Plot
        columns={columns}
        summary={summarise("Download over time", columns)}
        axisLabels={[first, columns[Math.floor(count / 2)]?.label ?? "", lastLabel]}
      >
        {(top) => {
          const y = (value: number) => 100 - (Math.min(value, top) / top) * 100;
          return (
            <>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                {runs.map((run) => {
                  const upper = run.map(
                    (p) => `${String(x(p.index))},${String(y(p.cell.interval.downloadMbps[1]))}`,
                  );
                  const lower = run
                    .map(
                      (p) => `${String(x(p.index))},${String(y(p.cell.interval.downloadMbps[0]))}`,
                    )
                    .reverse();
                  const line = run.map(
                    (p) => `${String(x(p.index))},${String(y(p.cell.downloadMbps))}`,
                  );
                  return (
                    <g key={run[0]?.index}>
                      {run.length > 1 ? (
                        <polygon points={[...upper, ...lower].join(" ")} className={BAND_FILL} />
                      ) : null}
                      <polyline
                        points={line.join(" ")}
                        fill="none"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        className={SERIES_STROKE}
                      />
                    </g>
                  );
                })}
              </svg>
              {runs
                .filter((run) => run.length === 1)
                .map(([point]) =>
                  point ? (
                    <span
                      key={point.index}
                      className={`absolute size-2 rounded-full ring-2 ring-white dark:ring-neutral-950 ${SERIES_FILL}`}
                      style={{
                        left: `calc(${String(x(point.index))}% - 4px)`,
                        top: `calc(${String(y(point.cell.downloadMbps))}% - 4px)`,
                      }}
                    />
                  ) : null,
                )}
            </>
          );
        }}
      </Plot>
      <NumbersTable columns={columns} heading={heading} />
    </figure>
  );
}

/** Median download per column (e.g. each hour of the day); a gap where there are too few results. */
export function BarChart({
  columns,
  heading,
  axisLabels,
}: {
  columns: readonly Column[];
  heading: string;
  axisLabels: readonly string[];
}) {
  return (
    <figure>
      <Plot
        columns={columns}
        summary={summarise("Download by time of day", columns)}
        axisLabels={axisLabels}
        axis="grid"
      >
        {(top) => (
          <div className="flex h-full items-end gap-0.5">
            {columns.map((column) => (
              <div key={column.key} className="flex h-full flex-1 items-end justify-center">
                {isPublished(column.cell) ? (
                  <div
                    className={`w-full max-w-6 rounded-t-sm ${SERIES_FILL}`}
                    style={{
                      height: `${String((Math.min(column.cell.downloadMbps, top) / top) * 100)}%`,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Plot>
      <NumbersTable columns={columns} heading={heading} />
    </figure>
  );
}

/** A table with an inline bar per row: label, bar, median download (or "not enough"). */
export function SplitTable({ rows, heading }: { rows: readonly Column[]; heading: string }) {
  const highest = Math.max(
    0,
    ...rows.flatMap((row) => (isPublished(row.cell) ? [row.cell.downloadMbps] : [])),
  );
  return (
    <table className="w-full table-fixed text-left text-sm tabular-nums">
      <thead className={MUTED}>
        <tr>
          <th scope="col" className="w-[36%] py-1 font-medium">
            {heading}
          </th>
          <th scope="col" className="py-1 font-medium">
            <span className="sr-only">Bar</span>
          </th>
          <th scope="col" className="w-[40%] py-1 text-right font-medium">
            Download
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={`border-t ${GRID}`} title={tip(row)}>
            <th scope="row" className="py-2 pr-2 font-normal">
              {row.href ? (
                <a href={row.href} className="underline underline-offset-2">
                  {row.label}
                </a>
              ) : (
                row.label
              )}
            </th>
            <td className="py-2" aria-hidden="true">
              {isPublished(row.cell) && highest > 0 ? (
                <div
                  className={`h-3 rounded-r-sm ${SERIES_FILL}`}
                  style={{ width: `${String((row.cell.downloadMbps / highest) * 100)}%` }}
                />
              ) : null}
            </td>
            <td className={`py-2 text-right ${isPublished(row.cell) ? "" : MUTED}`}>
              {isPublished(row.cell) ? formatMbps(row.cell.downloadMbps) : "Not enough yet"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type { Column };
