import type { Metadata } from "next";

type SearchParams = Record<string, string | string[] | undefined>;

/** Any query string at all: filtered views, fbclid and utm_* links are never indexed. */
export const hasQuery = (params: SearchParams) => Object.keys(params).length > 0;

/**
 * Title, description and the canonical (always the unfiltered path). Filtered or unavailable pages
 * get noindex, follow: they would be thousands of near-duplicates, or an outage.
 */
export function insightsMetadata({
  title,
  description,
  path,
  indexable,
}: {
  title: string;
  description: string;
  path: string;
  indexable: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: path },
  };
}
