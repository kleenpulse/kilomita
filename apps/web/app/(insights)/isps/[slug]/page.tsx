import type { StatsCell } from "@kilomita/shared";
import { DEFAULT_STATS_WINDOW, ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  dayLabel,
  blockLabel,
  ispName,
  stateName,
  typeLabel,
  windowLabel,
} from "@/lib/insights-format";
import { TYPE_ORDER } from "@/lib/network-labels";
import { loadInsights, parsePageFilter } from "@/server/insights";
import { CellCard, isPublished } from "../../_components/cells";
import { BarChart, SplitTable, TrendChart } from "../../_components/charts";
import { FilterForm } from "../../_components/filter-form";
import { JsonLd, breadcrumbLd, datasetLd } from "../../_components/json-ld";
import { NotEnough, SourceBanner, Unavailable } from "../../_components/notices";
import { MUTED, PageHeader, Section } from "../../_components/page-header";
import { hasQuery, insightsMetadata } from "../../_components/page-meta";

const IGNORE = ["isp"] as const;

/** Every named ISP has a page; "Other" is a bucket, not a provider. */
const isIsp = (slug: string) => slug !== "other" && ISPS.some((isp) => isp.slug === slug);

const describe = (name: string) =>
  `${name} internet speeds in Nigeria: median download, upload and latency over time, by time of day, by state and by connection type, from speed tests people chose to share.`;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/isps/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isIsp(slug)) return {};
  const query = await searchParams;
  const filter = parsePageFilter(query, IGNORE);
  const insights = filter ? await loadInsights("isp", filter) : null;
  return insightsMetadata({
    title: `${ispName(slug)} speeds`,
    description: describe(ispName(slug)),
    path: `/isps/${slug}`,
    indexable: !hasQuery(query) && insights?.status === "ok",
  });
}

export default async function IspPage({ params, searchParams }: PageProps<"/isps/[slug]">) {
  const { slug } = await params;
  const pageFilter = parsePageFilter(await searchParams, IGNORE);
  if (!isIsp(slug) || !pageFilter) notFound();
  const name = ispName(slug);
  const window = pageFilter.window ?? DEFAULT_STATS_WINDOW;
  const filter = { ...pageFilter, isp: slug };
  const [summary, trend, hours, states, types] = await Promise.all([
    loadInsights("isp", pageFilter),
    loadInsights(window === 7 ? "trend" : "week", filter),
    loadInsights("daypart", filter),
    loadInsights("state", filter),
    loadInsights("network-type", filter),
  ]);
  const cell = (insights: typeof summary, key: string): StatsCell | undefined =>
    insights.status === "ok" ? insights.cells.find((entry) => entry.key === key) : undefined;
  const cells = (insights: typeof summary) => (insights.status === "ok" ? insights.cells : []);
  const own = cell(summary, slug);
  const shownStates = cells(states).filter(isPublished);
  const path = `/isps/${slug}`;

  return (
    <main className="flex-1 pb-10">
      <PageHeader title={`${name} speeds`}>
        <p>
          {name}
          {filter.state ? ` in ${stateName(filter.state)}` : " across Nigeria"}
          {filter.type ? ` on ${typeLabel(filter.type)}` : ""}, {windowLabel(window).toLowerCase()},
          from tests people chose to share.
        </p>
      </PageHeader>
      <FilterForm action={path} fields={["state", "type", "window"]} filter={pageFilter} />
      {summary.status === "unavailable" ? (
        <Unavailable />
      ) : (
        <>
          <div className="mt-4">
            <SourceBanner source={summary.source} />
          </div>
          <Section title="Medians">
            {own && isPublished(own) ? (
              <ul>
                <CellCard cell={own} name={name} />
              </ul>
            ) : (
              <NotEnough>{`Not enough results for ${name} here yet.`}</NotEnough>
            )}
          </Section>
          <Section title={window === 7 ? "Download, day by day" : "Download, week by week"}>
            <TrendChart
              heading={window === 7 ? "Day" : "Week of"}
              columns={cells(trend).map((entry) => ({
                key: entry.key,
                label: dayLabel(entry.key),
                cell: entry,
              }))}
            />
          </Section>
          <Section title="Download by time of day (Lagos time)">
            <BarChart
              heading="Time"
              axisLabels={["00:00", "06:00", "12:00", "18:00"]}
              columns={cells(hours).map((entry) => ({
                key: entry.key,
                label: blockLabel(entry.key),
                cell: entry,
              }))}
            />
          </Section>
          <Section title="By state">
            {shownStates.length === 0 ? (
              <NotEnough>No state has enough results yet.</NotEnough>
            ) : (
              <>
                <SplitTable
                  heading="State"
                  rows={shownStates.map((entry) => ({
                    key: entry.key,
                    label: stateName(entry.key),
                    href: `/states/${entry.key}`,
                    cell: entry,
                  }))}
                />
                <p className={`mt-2 text-sm ${MUTED}`}>
                  Not enough results yet in the other{" "}
                  {String(NIGERIAN_STATES.length - shownStates.length)} states.
                </p>
              </>
            )}
          </Section>
          <Section title="By connection">
            <SplitTable
              heading="Connection"
              rows={TYPE_ORDER.flatMap((type) => {
                const entry = cell(types, type);
                return entry ? [{ key: type, label: typeLabel(type), cell: entry }] : [];
              })}
            />
          </Section>
          <JsonLd
            data={datasetLd({
              name: `${name} speeds in Nigeria`,
              description: `${describe(name)} Medians over a rolling window, with 95% ranges; groups under 30 results are not published.`,
              path,
              window,
              api: `/api/stats/trend?isp=${slug}`,
            })}
          />
          <JsonLd
            data={breadcrumbLd([
              { name: "ISP speeds", path: "/isps" },
              { name, path },
            ])}
          />
        </>
      )}
    </main>
  );
}
