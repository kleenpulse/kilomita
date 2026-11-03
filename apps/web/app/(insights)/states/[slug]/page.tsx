import { DEFAULT_STATS_WINDOW, NIGERIAN_STATES } from "@kilomita/shared/lists";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ispName, stateName, typeLabel, windowLabel } from "@/lib/insights-format";
import { TYPE_ORDER } from "@/lib/network-labels";
import { loadInsights, parsePageFilter } from "@/server/insights";
import { Ranking } from "../../_components/cells";
import { SplitTable } from "../../_components/charts";
import { FilterForm } from "../../_components/filter-form";
import { JsonLd, breadcrumbLd, datasetLd } from "../../_components/json-ld";
import { SourceBanner, Unavailable } from "../../_components/notices";
import { MUTED, PageHeader, Section } from "../../_components/page-header";
import { hasQuery, insightsMetadata } from "../../_components/page-meta";

// An ISP filter makes no sense on a page that ranks ISPs.
const IGNORE = ["state", "isp"] as const;

const isState = (slug: string) => NIGERIAN_STATES.some((state) => state.slug === slug);

const describe = (name: string) =>
  `Which internet provider performs best in ${name}, Nigeria: median download, upload and latency per provider and per connection type, from speed tests people chose to share.`;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/states/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isState(slug)) return {};
  const query = await searchParams;
  const filter = parsePageFilter(query, IGNORE);
  const insights = filter ? await loadInsights("isp", { ...filter, state: slug }) : null;
  return insightsMetadata({
    title: `Internet speeds in ${stateName(slug)}`,
    description: describe(stateName(slug)),
    path: `/states/${slug}`,
    indexable: !hasQuery(query) && insights?.status === "ok",
  });
}

export default async function StatePage({ params, searchParams }: PageProps<"/states/[slug]">) {
  const { slug } = await params;
  const pageFilter = parsePageFilter(await searchParams, IGNORE);
  if (!isState(slug) || !pageFilter) notFound();
  const name = stateName(slug);
  const window = pageFilter.window ?? DEFAULT_STATS_WINDOW;
  const filter = { ...pageFilter, state: slug };
  const [isps, types] = await Promise.all([
    loadInsights("isp", filter),
    loadInsights("network-type", filter),
  ]);
  const path = `/states/${slug}`;

  return (
    <main className="flex-1 pb-10">
      <PageHeader title={`Internet speeds in ${name}`}>
        <p>
          Which providers do best in {name}
          {filter.type ? ` on ${typeLabel(filter.type)}` : ""}, {windowLabel(window).toLowerCase()},
          from tests people chose to share.
        </p>
      </PageHeader>
      <FilterForm action={path} fields={["type", "window"]} filter={pageFilter} />
      {isps.status === "unavailable" ? (
        <Unavailable />
      ) : (
        <>
          <div className="mt-4">
            <SourceBanner source={isps.source} />
          </div>
          <Section title="Providers, fastest download first">
            <Ranking
              cells={isps.cells}
              name={ispName}
              href={(key) => (key === "other" ? undefined : `/isps/${key}`)}
              unranked={["other"]}
            />
            <p className={`mt-4 text-sm ${MUTED}`}>
              Ranked by median download. Providers whose 95% ranges overlap share a place.{" "}
              <a href="/methodology" className="underline underline-offset-2">
                How we work this out
              </a>
            </p>
          </Section>
          <Section title="By connection">
            <SplitTable
              heading="Connection"
              rows={TYPE_ORDER.flatMap((type) => {
                const cell =
                  types.status === "ok"
                    ? types.cells.find((entry) => entry.key === type)
                    : undefined;
                return cell ? [{ key: type, label: typeLabel(type), cell }] : [];
              })}
            />
          </Section>
          <JsonLd
            data={datasetLd({
              name: `Internet speeds in ${name}, Nigeria`,
              description: `${describe(name)} Medians over a rolling window, with 95% ranges; groups under 30 results are not published.`,
              path,
              window,
              api: `/api/stats/isp?state=${slug}`,
            })}
          />
          <JsonLd
            data={breadcrumbLd([
              { name: "States", path: "/states" },
              { name, path },
            ])}
          />
        </>
      )}
    </main>
  );
}
