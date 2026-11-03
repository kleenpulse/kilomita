import type { InsightsSource } from "@/lib/insights-format";

const NOTICE = "rounded-lg border px-4 py-3 text-sm leading-relaxed";

/** Says when the numbers are not real measurements. Nothing for real data. */
export function SourceBanner({ source }: { source: InsightsSource }) {
  if (source === "real") return null;
  return (
    <p
      data-testid="source-banner"
      className={`${NOTICE} border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100`}
    >
      {source === "sample" ? (
        <>
          <strong>Sample data.</strong> These numbers are made up for development. They are not real
          measurements.
        </>
      ) : (
        <>
          <strong>Test data.</strong> These are results shared with this development server, kept in
          memory. They are not real measurements of Nigerian networks.
        </>
      )}
    </p>
  );
}

export function Unavailable() {
  return (
    <p
      className={`${NOTICE} mt-4 border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300`}
    >
      Insights are unavailable right now. The speed test still works.
    </p>
  );
}

export function NotEnough({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
      {children}
    </p>
  );
}
