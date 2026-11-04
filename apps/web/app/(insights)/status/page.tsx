import type { Metadata } from "next";
import { type StatusSummary, loadStatus } from "@/server/insights";
import { SourceBanner, Unavailable } from "../_components/notices";
import { MUTED, PageHeader, Section } from "../_components/page-header";
import { insightsMetadata } from "../_components/page-meta";

export const metadata: Metadata = insightsMetadata({
  title: "Status",
  description: "How many speed tests ran, how they ended, and the errors on our side.",
  path: "/status",
  indexable: false,
});

const OUTCOME_LABELS: Record<StatusSummary["outcomes"][number]["outcome"], string> = {
  complete: "Finished",
  cancelled: "Stopped by the visitor",
  hidden: "Stopped: left the page",
  offline: "Stopped: went offline",
  "network-lost": "Connection dropped",
  "endpoint-error": "Test server refused or failed",
  "no-server": "No test server available",
  crashed: "Problem in the browser",
  stale: "Old copy of the page",
};

const REFUSAL_LABELS: Record<string, string> = {
  "limited:tokens": "Too many tests from one connection (sharing pass)",
  "limited:servers": "Too many tests from one connection",
  "busy:tokens": "Every sharing pass for that minute was taken",
  "busy:servers": "Server lists at their per-minute ceiling",
};

const TABLE = "w-full border-collapse text-sm tabular-nums";
const CELL = "border-b border-neutral-200 py-1.5 pr-3 text-left align-top dark:border-neutral-800";
const NUM = `${CELL} text-right`;

const percent = (part: number, whole: number) =>
  whole === 0 ? "–" : `${String(Math.round((part / whole) * 100))}%`;

function Totals({ title, totals }: { title: string; totals: StatusSummary["last24h"] }) {
  const rows = [
    ["Tests started", String(totals.started)],
    ["Ends reported", String(totals.reported)],
    ["Finished", `${String(totals.completed)} (${percent(totals.completed, totals.reported)})`],
    ["Stopped", String(totals.stopped)],
    ["Failed", String(totals.failed)],
  ] as const;
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-semibold">{title}</h2>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className={MUTED}>{label}</dt>
            <dd className="text-right font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function StatusPage() {
  const view = await loadStatus();
  return (
    <main className="flex-1 pb-10 text-base leading-relaxed">
      <PageHeader title="Status">
        <p>How many tests ran and how they ended. Counts only: nothing here is about a person.</p>
      </PageHeader>
      {view.status === "unavailable" ? (
        <Unavailable />
      ) : (
        <StatusBody summary={view.summary} source={view.source} />
      )}
    </main>
  );
}

function StatusBody({
  summary,
  source,
}: {
  summary: StatusSummary;
  source: Parameters<typeof SourceBanner>[0]["source"];
}) {
  return (
    <>
      <SourceBanner source={source} />
      <p className={`mt-4 text-sm ${MUTED}`}>
        Reported by browsers, not checked by us: each test&apos;s page says how it ended, and anyone
        could send made-up reports. Shared results are never counted on this page. Times are UTC.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Totals title="Last 24 hours" totals={summary.last24h} />
        <Totals title="Last 30 days" totals={summary.last30d} />
      </div>

      <Section title="How tests ended, last 30 days">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={CELL}>Ending</th>
              <th className={NUM}>Tests</th>
            </tr>
          </thead>
          <tbody>
            {summary.outcomes.map(({ outcome, count }) => (
              <tr key={outcome}>
                <td className={CELL}>{OUTCOME_LABELS[outcome]}</td>
                <td className={NUM}>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="By test server, last 30 days">
        {summary.servers.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No tests reported yet.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={CELL}>Server</th>
                <th className={NUM}>Reported</th>
                <th className={NUM}>Finished</th>
              </tr>
            </thead>
            <tbody>
              {summary.servers.map(({ server, reported, completed }) => (
                <tr key={server}>
                  <td className={CELL}>{server === "none" ? "None chosen" : server}</td>
                  <td className={NUM}>{reported}</td>
                  <td className={NUM}>{percent(completed, reported)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="By day">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={CELL}>Day</th>
              <th className={NUM}>Started</th>
              <th className={NUM}>Reported</th>
              <th className={NUM}>Finished</th>
            </tr>
          </thead>
          <tbody>
            {summary.days.toReversed().map(({ day, started, reported, completed }) => (
              <tr key={day}>
                <td className={CELL}>{day}</td>
                <td className={NUM}>{started}</td>
                <td className={NUM}>{reported}</td>
                <td className={NUM}>{completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Refused, last 30 days">
        {summary.refusals.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>None.</p>
        ) : (
          <table className={TABLE}>
            <tbody>
              {summary.refusals.map(({ reason, count }) => (
                <tr key={reason}>
                  <td className={CELL}>{REFUSAL_LABELS[reason] ?? reason}</td>
                  <td className={NUM}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Errors on our side, last 30 days">
        {summary.errors.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>None.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={CELL}>Where</th>
                <th className={CELL}>Code</th>
                <th className={NUM}>Times</th>
              </tr>
            </thead>
            <tbody>
              {summary.errors.map(({ event, code, count }) => (
                <tr key={`${event}:${code}`}>
                  <td className={`${CELL} break-all`}>{event}</td>
                  <td className={`${CELL} break-all`}>{code}</td>
                  <td className={NUM}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
