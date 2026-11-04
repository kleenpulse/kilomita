import { APP_NAME } from "@kilomita/shared";
import type { StatsWindow } from "@kilomita/shared";
import { SITE_URL } from "../../_components/site-url";

/** Structured data as a script tag, `<` escaped so the JSON can't close it (Next's json-ld guide). */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

/** The published aggregates are CC BY 4.0 (maintainer, 2026-11-04). */
export const DATA_LICENSE = Object.freeze({
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
});

/** A schema.org Dataset for a page of aggregates. */
export function datasetLd({
  name,
  description,
  path,
  window,
  api,
}: {
  name: string;
  description: string;
  path: string;
  window: StatsWindow;
  api: string;
}): Record<string, unknown> {
  const end = new Date();
  const start = new Date(end.getTime() - window * 24 * 60 * 60 * 1000);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url: `${SITE_URL}${path}`,
    isAccessibleForFree: true,
    license: DATA_LICENSE.url,
    creator: { "@type": "Organization", name: APP_NAME, url: SITE_URL },
    spatialCoverage: { "@type": "Place", name: "Nigeria" },
    temporalCoverage: `${start.toISOString().slice(0, 10)}/${end.toISOString().slice(0, 10)}`,
    variableMeasured: [
      "Median download speed (Mbps)",
      "Median upload speed (Mbps)",
      "Median idle latency (ms)",
    ],
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: `${SITE_URL}${api}`,
    },
  };
}

export function breadcrumbLd(
  items: readonly { name: string; path: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}
