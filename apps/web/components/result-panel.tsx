import type { EngineResult } from "@kilomita/engine";
import type { CSSProperties, ReactNode } from "react";
import { formatMbps, formatMegabytes, formatMs } from "@/lib/format";
import { GRADE_TEXT, REASON_TEXT, judge } from "@/lib/verdicts";

/** Laid out (invisibly) before any result exists, so revealing one changes paint, not layout. */
export const PLACEHOLDER_RESULT: EngineResult = {
  downloadMbps: 0,
  uploadMbps: 0,
  latency: { idleMedianMs: 0, idleP95Ms: 0, jitterMs: 0, requestLossPct: 0 },
  loadedLatency: { downloadMs: 0, uploadMs: 0, grade: "A" },
  loadedP95Ms: { download: 0, upload: 0 },
  addedLatencyMs: 0,
  bytesUsed: 0,
  durationMs: 0,
  lowDataMode: false,
  engineVersion: "0.0.0",
  serverId: "-",
  measuredAt: "1970-01-01T00:00:00.000Z",
  stoppedBy: { download: "stable", upload: "stable" },
};

interface Props {
  result: EngineResult;
  shown: boolean;
}

/** Staggered fade-in, only for people who haven't asked for reduced motion. */
export function Reveal({
  shown,
  order,
  children,
  className = "",
}: {
  shown: boolean;
  order: number;
  children: ReactNode;
  className?: string;
}) {
  const style: CSSProperties = { transitionDelay: shown ? `${String(order * 80)}ms` : "0ms" };
  return (
    <div
      data-reveal
      style={style}
      className={`motion-safe:transition-[opacity,translate] motion-safe:duration-300 ${shown ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  wide = false,
}: {
  label: string;
  value: string;
  detail?: string;
  wide?: boolean;
}) {
  // Three fixed lines that never wrap, so a long value can't change the panel's height.
  return (
    <div className={`flex flex-col whitespace-nowrap ${wide ? "col-span-2" : ""}`}>
      <dt className="h-5 text-sm text-neutral-600 dark:text-neutral-400">{label}</dt>
      <dd className="text-xl leading-7 font-semibold tabular-nums">
        {value}
        <span className="block h-5 text-sm font-normal text-neutral-600 dark:text-neutral-400">
          {detail}
        </span>
      </dd>
    </div>
  );
}

export function ResultPanel({ result, shown }: Props) {
  const verdicts = judge(result);
  const { grade } = result.loadedLatency;
  const endedEarly =
    result.stoppedBy.download === "data-cap" || result.stoppedBy.upload === "data-cap";

  return (
    <section aria-labelledby="results-heading" aria-hidden={!shown} className="w-full text-left">
      <h2 id="results-heading" className="sr-only">
        Results
      </h2>

      <Reveal shown={shown} order={0}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Stat label="Upload" value={formatMbps(result.uploadMbps)} detail="Mbps" />
          <Stat label="Latency" value={formatMs(result.latency.idleMedianMs)} detail="idle" />
          <Stat label="Jitter" value={formatMs(result.latency.jitterMs)} />
          <Stat
            label="Loaded latency"
            value={`+${formatMs(result.addedLatencyMs)}`}
            detail={`grade ${grade}`}
          />
          <Stat
            wide
            label="Data used"
            value={formatMegabytes(result.bytesUsed)}
            detail={result.lowDataMode ? "approximate · low-data mode" : "approximate"}
          />
        </dl>
      </Reveal>

      <Reveal shown={shown} order={1} className="mt-4">
        <p className="min-h-10 text-sm text-neutral-700 dark:text-neutral-300">
          Grade {grade}. {GRADE_TEXT[grade]}
        </p>
      </Reveal>

      <Reveal shown={shown} order={2} className="mt-6">
        <p className="min-h-14 text-lg font-semibold text-balance">{verdicts.headline}</p>
        <ul className="mt-2 space-y-1.5">
          {verdicts.activities.map((activity) => (
            <li key={activity.id} className="flex h-7 items-baseline gap-2 whitespace-nowrap">
              <span
                aria-hidden="true"
                className={
                  activity.ok
                    ? "font-bold text-emerald-700 dark:text-emerald-400"
                    : "font-bold text-amber-700 dark:text-amber-400"
                }
              >
                {activity.ok ? "✓" : "✗"}
              </span>
              <span>
                {activity.label}
                <span className="sr-only">{activity.ok ? ": good" : ": not good"}</span>
              </span>
              {activity.reason ? (
                <span className="ml-auto text-sm text-neutral-600 dark:text-neutral-400">
                  {REASON_TEXT[activity.reason]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Reveal>

      {/* Room for the longest note (low-data) at 320 px, shown or not. */}
      <Reveal shown={shown} order={3} className="mt-4 min-h-15 text-sm">
        {endedEarly ? (
          <p className="text-neutral-700 dark:text-neutral-300">
            Ended early to save data, so this reading may be a little low.
            {result.lowDataMode ? " Turn off low-data mode for a fuller reading." : ""}
          </p>
        ) : null}
      </Reveal>

      <Reveal shown={shown} order={4}>
        <details className="text-sm text-neutral-700 dark:text-neutral-300">
          <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">
            How we judge this
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Streaming: HD from 3 Mbps, Full HD from 5, 4K from 20 (
              <a className="underline" href="https://help.netflix.com/en/node/306">
                Netflix
              </a>
              ,{" "}
              <a className="underline" href="https://support.google.com/youtube/answer/78358">
                YouTube
              </a>
              ).
            </li>
            <li>
              HD video calls: 1.7 Mbps each way (
              <a
                className="underline"
                href="https://knowledge.workspace.google.com/admin/meet/prepare-your-network-for-meet-meetings-and-live-streams"
              >
                Google Meet
              </a>
              ;{" "}
              <a
                className="underline"
                href="https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060748"
              >
                Zoom
              </a>{" "}
              asks 1.2).
            </li>
            <li>
              Latency limits: browsing 500 ms (median), calls 400 ms and gaming 40 ms (95th
              percentile), checked idle and under load; gaming also needs 10 Mbps down and 3 up.
              These follow{" "}
              <a className="underline" href="https://www.waveform.com/tools/bufferbloat">
                Waveform&apos;s bufferbloat test
              </a>
              .
            </li>
            <li>
              For video calls and 4K we use the apps&apos; own published figures, which are less
              strict than Waveform&apos;s generic 10/5 Mbps and 25 Mbps.
            </li>
            <li>Results are measured against the test server, not the apps&apos; own servers.</li>
          </ul>
        </details>
      </Reveal>
    </section>
  );
}
