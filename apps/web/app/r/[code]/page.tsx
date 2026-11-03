import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { APP_NAME } from "@kilomita/shared";
import { decodeShareCode } from "@/lib/share-code";
import { SiteFooter } from "../../_components/site-footer";
import { NOT_CHECKED, cardText } from "./card";

type Props = { params: Promise<{ code: string }> };

/** The card for a code, judged against today (a card may be dated up to tomorrow). */
const cardFor = (code: string) => decodeShareCode(code, Date.now());

/*
 * A shared result. Everything shown comes from the URL itself: nothing is stored or looked up, so
 * this page can't reveal anything the person didn't post. Never indexed, since anyone can type one.
 */

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const { code } = await params;
  const card = cardFor(code);
  if (!card) return { robots: { index: false, follow: true } };
  const text = cardText(card);
  const description = `${text.download} Mbps down, ${text.upload} Mbps up, ${text.latency} ms latency. Test your own speed on ${APP_NAME}.`;
  const image = { url: `/r/${code}/card.png`, width: 1200, height: 630, alt: text.headline };
  return {
    title: text.headline,
    description,
    robots: { index: false, follow: true },
    openGraph: { type: "website", title: text.headline, description, images: [image] },
    twitter: { card: "summary_large_image", title: text.headline, description, images: [image] },
  };
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm text-neutral-600 dark:text-neutral-400">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {value} <span className="text-base font-normal">{unit}</span>
      </span>
    </div>
  );
}

export default async function SharedResultPage({ params }: Props) {
  await connection();
  const { code } = await params;
  const card = cardFor(code);
  if (!card) notFound();
  const text = cardText(card);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <header className="pt-8 pb-6">
        <a href="/" className="text-sm font-semibold">
          {APP_NAME}
        </a>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{text.headline}</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{NOT_CHECKED}</p>
      </header>

      <main className="flex-1 pb-10">
        <section
          aria-label="Shared result"
          className="rounded-xl border border-neutral-300 p-5 dark:border-neutral-700"
        >
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Download" value={text.download} unit="Mbps" />
            <Stat label="Upload" value={text.upload} unit="Mbps" />
            <Stat label="Latency" value={text.latency} unit="ms" />
            <Stat label="Bufferbloat grade" value={text.grade} unit="" />
          </div>
          <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
            {text.place ? `${text.place} · ` : ""}
            {text.day}
          </p>
        </section>
        <a
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800"
        >
          Test your own speed
        </a>
      </main>

      <SiteFooter />
    </div>
  );
}
