import { GEOPOLITICAL_ZONES } from "@kilomita/shared";
import { DEFAULT_STATS_WINDOW, NIGERIAN_STATES } from "@kilomita/shared/lists";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ispName, typeLabel, windowLabel } from "@/lib/insights-format";
import { loadInsights, parsePageFilter } from "@/server/insights";
import { SplitTable } from "../_components/charts";
import { FilterForm } from "../_components/filter-form";
import { JsonLd, datasetLd } from "../_components/json-ld";
import { SourceBanner, Unavailable } from "../_components/notices";
import { PageHeader, Section } from "../_components/page-header";
import { hasQuery, insightsMetadata } from "../_components/page-meta";

const PATH = "/states";
const IGNORE = ["state"] as const;
const TITLE = "Internet speeds by state";
const DESCRIPTION =
  "Median internet download speeds in each of Nigeria's 36 states and the FCT, from speed tests people chose to share, with a page per state showing which providers perform best locally.";

const ZONE_NAME: Record<(typeof GEOPOLITICAL_ZONES)[number], string> = {
  "north-central": "North Central",
  "north-east": "North East",
  "north-west": "North West",
  "south-east": "South East",
  "south-south": "South South",
  "south-west": "South West",
};

export async function generateMetadata({ searchParams }: PageProps<"/states">): Promise<Metadata> {
  const params = await searchParams;
  const filter = parsePageFilter(params, IGNORE);
  const insights = filter ? await loadInsights("state", filter) : null;
  return insightsMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    indexable: !hasQuery(params) && insights?.status === "ok",
  });
}

export default async function StatesPage({ searchParams }: PageProps<"/states">) {
  const filter = parsePageFilter(await searchParams, IGNORE);
  if (!filter) notFound();
  const insights = await loadInsights("state", filter);
  const window = filter.window ?? DEFAULT_STATS_WINDOW;
  const cells = insights.status === "ok" ? insights.cells : [];

  return (
    <main className="flex-1 pb-10">
      <PageHeader title={TITLE}>
        <p>
          Median download
          {filter.isp ? ` on ${ispName(filter.isp)}` : ""}
          {filter.type ? ` over ${typeLabel(filter.type)}` : ""} in each state,{" "}
          {windowLabel(window).toLowerCase()}. Open a state to see which providers do best there.
        </p>
      </PageHeader>
      <FilterForm action={PATH} fields={["isp", "type", "window"]} filter={filter} />
      {insights.status === "unavailable" ? (
        <Unavailable />
      ) : (
        <>
          <div className="mt-4">
            <SourceBanner source={insights.source} />
          </div>
          {GEOPOLITICAL_ZONES.map((zone) => (
            <Section key={zone} title={ZONE_NAME[zone]}>
              <SplitTable
                heading="State"
                rows={NIGERIAN_STATES.filter((state) => state.zone === zone).flatMap((state) => {
                  const cell = cells.find((entry) => entry.key === state.slug);
                  return cell
                    ? [{ key: state.slug, label: state.name, href: `/states/${state.slug}`, cell }]
                    : [];
                })}
              />
            </Section>
          ))}
          <JsonLd
            data={datasetLd({
              name: "Internet speeds by state in Nigeria",
              description: `${DESCRIPTION} Medians over a rolling window; groups under 30 results are not published.`,
              path: PATH,
              window,
              api: "/api/stats/state",
            })}
          />
        </>
      )}
    </main>
  );
}
