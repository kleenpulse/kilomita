import { APP_NAME, SHARING } from "@kilomita/shared";
import { COUNT_BANDS } from "@kilomita/shared/lists";
import type { Metadata } from "next";
import { bandLabel } from "@/lib/insights-format";
import { PageHeader } from "../_components/page-header";
import { DATA_LICENSE } from "../_components/json-ld";
import { insightsMetadata } from "../_components/page-meta";

export const metadata: Metadata = insightsMetadata({
  title: "Methodology",
  description: `How the ${APP_NAME} speed test measures your connection, how the published ISP and state numbers are worked out, and what they can't tell you.`,
  path: "/methodology",
  indexable: true,
});

const H2 = "text-lg font-semibold";

export default function MethodologyPage() {
  return (
    <main className="flex-1 space-y-6 pb-10 text-base leading-relaxed">
      <PageHeader title="Methodology">
        <p>How the test measures, how the published numbers are made, and their limits.</p>
      </PageHeader>

      <section>
        <h2 className={H2}>How a test runs</h2>
        <p className="mt-1">
          The test first measures latency while your connection is idle: a series of tiny requests,
          timed from sending to the first byte of the answer, minus the time the server reports it
          spent. The first request pays for setting up the connection and is not counted. Jitter is
          the average change between one latency sample and the next.
        </p>
        <p className="mt-2">
          Then it downloads, and then it uploads, starting with one stream and adding more while
          each one still raises the speed. It stops a direction once the reading is stable, or when
          it reaches its time or data limit: 50 MB and 30 seconds in all, or 10 MB and 15 seconds in
          low-data mode. While data flows, it keeps measuring latency. How much latency rises under
          load gives the A to F grade.
        </p>
        <p className="mt-2">
          Request loss is the share of latency requests that failed or timed out. It counts failed
          web requests, not lost network packets (ICMP), which a browser can&apos;t measure.
        </p>
        <p className="mt-2">
          The test runs against {APP_NAME}&apos;s own test servers. When there is more than one, it
          first sends each a few small requests and picks the one that answers fastest. If none can
          be reached, it may fall back to Cloudflare&apos;s nearest edge server. Either way, it is
          not the server of the app or site you use, so a video call or game can behave differently
          from the test. Each result records which server it used.
        </p>
      </section>

      <section>
        <h2 className={H2}>How the published numbers are made</h2>
        <p className="mt-1">
          Only results that people chose to share are counted, over the last 7, 30 or 90 days
          (rolling, by our server&apos;s clock). Times of day and days are in Lagos time.
        </p>
        <p className="mt-2">
          We publish medians, not averages: half the results are faster and half slower. A few very
          fast lines would pull an average far above what most people get.
        </p>
        <p className="mt-2">
          Each median comes with a 95% range: ranges made this way contain the true median at least
          95 times in 100, if the shared results are typical of the connections behind them. We take
          it from the sorted results themselves, without assuming any shape for the data. A wide
          range means the median is uncertain.
        </p>
        <p className="mt-2">
          A group with fewer than {SHARING.minGroupSize} results gets no numbers and no count; it
          looks the same as a group with none. Larger groups show their size as a band (
          {COUNT_BANDS.map((entry) => bandLabel(entry.band)).join(", ")}), and groups under 100 are
          marked &ldquo;Few results, read with care&rdquo;. Every number is rounded: speeds to 2
          significant figures, latency to whole milliseconds.
        </p>
        <p className="mt-2">
          Why rounded and banded: each end of a range, and sometimes the median, is one real result
          rounded to 2 significant figures. Counts appear only as bands, so comparing groups
          doesn&apos;t show how many results separate them. That makes any one result hard to work
          out, though it can be done, most easily by someone who shares made-up results into a small
          group. A result never carries who sent it.
        </p>
      </section>

      <section>
        <h2 className={H2}>Rankings</h2>
        <p className="mt-1">
          Providers are ranked by median download. When two providers&apos; 95% ranges overlap, they
          share a place: going down the list, a provider joins a place if its range overlaps the
          range of the first provider in that place. Overlapping ranges are a reason for caution,
          not a statistical test, and separate places don&apos;t prove a difference either.
        </p>
      </section>

      <section>
        <h2 className={H2}>What is left out</h2>
        <p className="mt-1">
          Results with values no real test can produce are refused when they are sent. Results that
          look very unusual for a genuine test are kept but flagged and never counted, and so are
          repeats of the same result from the same connection on the same day, where our host tells
          us the connection&apos;s address. What counts as unusual comes from running the real test
          on simulated connections from 2G to 1 Gbps, so it will be tuned as real results arrive.
        </p>
      </section>

      <section>
        <h2 className={H2}>Verdicts</h2>
        <p className="mt-1">
          The plain-language verdicts after a test use published figures: Netflix and YouTube for
          streaming (HD 3, Full HD 5, 4K 20 Mbps), Google Meet and Zoom for HD video calls (1.7 Mbps
          each way), and Waveform&apos;s bufferbloat test for browsing, voice calls and gaming.
        </p>
      </section>

      <section>
        <h2 className={H2}>Limits</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            Only people who choose to share are counted, and people often test when something feels
            wrong, so the numbers may not match a typical day for everyone.
          </li>
          <li>
            Browsers slow down background tabs, so the test stops when you switch away and that run
            is not shared.
          </li>
          <li>
            On slow, high-latency lines such as 2G, upload reads about 20% low, and very slow
            uploads can&apos;t finish.
          </li>
          <li>
            Readings settle up to about 63 Mbps down and 32 up (about 13 and 6 in low-data mode).
            Faster lines reach the data limit first, so their readings are less exact.
          </li>
          <li>
            Network detection isn&apos;t connected yet, so people pick their provider and state
            themselves.
          </li>
        </ul>
      </section>

      <section>
        <h2 className={H2}>Using the numbers</h2>
        <p className="mt-1">
          The published numbers on these pages and from <code>/api/stats</code> are licensed under{" "}
          <a className="underline underline-offset-2" href={DATA_LICENSE.url}>
            {DATA_LICENSE.name}
          </a>
          . You may reuse them, for reporting or research, as long as you credit {APP_NAME} and link
          to this page, so readers can see how they were made and what they can&apos;t tell.
        </p>
      </section>
    </main>
  );
}
