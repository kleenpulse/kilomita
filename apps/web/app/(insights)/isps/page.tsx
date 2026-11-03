import { DEFAULT_STATS_WINDOW } from "@kilomita/shared/lists";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ispName, stateName, typeLabel, windowLabel } from "@/lib/insights-format";
import { loadInsights, parsePageFilter } from "@/server/insights";
import { Ranking } from "../_components/cells";
import { FilterForm } from "../_components/filter-form";
import { JsonLd, datasetLd } from "../_components/json-ld";
import { Unavailable, SourceBanner } from "../_components/notices";
import { MUTED, PageHeader, Section } from "../_components/page-header";
import { hasQuery, insightsMetadata } from "../_components/page-meta";

const PATH = "/isps";
const IGNORE = ["isp"] as const;
const TITLE = "ISP speeds in Nigeria";
const DESCRIPTION =
  "Median download and upload speeds and latency for Nigerian internet providers (MTN, Airtel, Glo, 9mobile, Spectranet, Starlink and more), from speed tests people chose to share.";

export async function generateMetadata({ searchParams }: PageProps<"/isps">): Promise<Metadata> {
  const params = await searchParams;
  const filter = parsePageFilter(params, IGNORE);
  const insights = filter ? await loadInsights("isp", filter) : null;
  return insightsMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    indexable: !hasQuery(params) && insights?.status === "ok",
  });
}

export default async function IspsPage({ searchParams }: PageProps<"/isps">) {
  const filter = parsePageFilter(await searchParams, IGNORE);
  if (!filter) notFound();
  const insights = await loadInsights("isp", filter);
  const window = filter.window ?? DEFAULT_STATS_WINDOW;
  const scope = [
    filter.state ? `in ${stateName(filter.state)}` : "across Nigeria",
    filter.type ? `on ${typeLabel(filter.type)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="flex-1 pb-10">
      <PageHeader title={TITLE}>
        <p>
          Median speeds {scope}, {windowLabel(window).toLowerCase()}, from tests people chose to
          share.
        </p>
      </PageHeader>
      <FilterForm action={PATH} fields={["state", "type", "window"]} filter={filter} />
      {insights.status === "unavailable" ? (
        <Unavailable />
      ) : (
        <>
          <div className="mt-4">
            <SourceBanner source={insights.source} />
          </div>
          <Section title="Providers, fastest download first">
            <Ranking
              cells={insights.cells}
              name={ispName}
              href={(key) => (key === "other" ? undefined : `/isps/${key}`)}
              unranked={["other"]}
            />
            <p className={`mt-4 text-sm ${MUTED}`}>
              Ranked by median download. Providers whose 95% ranges overlap share a place. Ranges
              and counts are rounded.{" "}
              <a href="/methodology" className="underline underline-offset-2">
                How we work this out
              </a>
            </p>
          </Section>
          <JsonLd
            data={datasetLd({
              name: TITLE,
              description: `${DESCRIPTION} Medians over a rolling window, with 95% ranges; groups under 30 results are not published.`,
              path: PATH,
              window,
              api: "/api/stats/isp",
            })}
          />
        </>
      )}
    </main>
  );
}
