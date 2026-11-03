import { DEFAULT_STATS_WINDOW, ISPS, NIGERIAN_STATES, STATS_WINDOWS } from "@kilomita/shared/lists";
import { TYPE_LABEL, TYPE_ORDER } from "@/lib/network-labels";
import type { FilterValues } from "@/lib/insights-format";

type Field = "isp" | "state" | "type" | "window";

const SELECT =
  "h-11 w-full min-w-0 truncate rounded-lg border border-neutral-300 bg-white px-2 text-base text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const FIELD = "flex min-w-0 flex-col gap-1 text-sm font-medium";

/**
 * A plain GET form: it works without JavaScript, and the page reads its query on the next request.
 * "All" submits an empty value, which the page treats as no filter.
 */
export function FilterForm({
  action,
  fields,
  filter,
}: {
  action: string;
  fields: readonly Field[];
  filter: FilterValues;
}) {
  return (
    <form
      action={action}
      method="get"
      aria-label="Filter"
      className="grid grid-cols-2 items-end gap-3 rounded-xl bg-neutral-100 p-3 dark:bg-neutral-900"
    >
      {fields.includes("isp") ? (
        <label htmlFor="filter-isp" className={FIELD}>
          Network
          <select id="filter-isp" name="isp" defaultValue={filter.isp ?? ""} className={SELECT}>
            <option value="">All</option>
            {ISPS.map((isp) => (
              <option key={isp.slug} value={isp.slug}>
                {isp.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.includes("state") ? (
        <label htmlFor="filter-state" className={FIELD}>
          State
          <select
            id="filter-state"
            name="state"
            defaultValue={filter.state ?? ""}
            className={SELECT}
          >
            <option value="">All</option>
            {NIGERIAN_STATES.map((state) => (
              <option key={state.slug} value={state.slug}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.includes("type") ? (
        <label htmlFor="filter-type" className={FIELD}>
          Connection
          <select id="filter-type" name="type" defaultValue={filter.type ?? ""} className={SELECT}>
            <option value="">All</option>
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.includes("window") ? (
        <label htmlFor="filter-window" className={FIELD}>
          Period
          <select
            id="filter-window"
            name="window"
            defaultValue={String(filter.window ?? DEFAULT_STATS_WINDOW)}
            className={SELECT}
          >
            {STATS_WINDOWS.map((days) => (
              <option key={days} value={String(days)}>
                {`${String(days)} days`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="submit"
        className="col-span-2 h-11 rounded-lg bg-emerald-700 px-4 text-base font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        Apply
      </button>
    </form>
  );
}
