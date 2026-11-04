import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, SHARING, SOURCE_URL } from "@kilomita/shared";
import { DeleteShared } from "@/components/delete-shared";
import { SiteFooter } from "../_components/site-footer";

export const metadata: Metadata = {
  title: "Privacy",
  description: `How ${APP_NAME} handles your data.`,
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <header className="pt-8 pb-6">
        <Link href="/" prefetch={false} className="text-sm underline underline-offset-2">
          ← Back to the test
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          This page describes the current version of {APP_NAME}.
        </p>
      </header>

      <main className="flex-1 space-y-6 pb-10 text-base leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">What the test contacts</h2>
          <p className="mt-1">
            The speed test downloads and uploads data to {APP_NAME}&apos;s own test servers. If
            there is more than one, it contacts each briefly to find the nearest. Like any server,
            they see your IP address. Our test servers don&apos;t keep a record of your IP address;
            they only count how much data they move each day. The company hosting them carries the
            traffic, like any network.
          </p>
          <p className="mt-2">
            If our servers can&apos;t be reached, the test may use Cloudflare&apos;s speed test
            servers instead. Like any server, they see your IP address. Their responses also include
            your IP address and approximate location; {APP_NAME} never reads them.
          </p>
          <p className="mt-2">
            Our website receives your IP address with every request, as every website does. It is
            hosted by Vercel, a US company; our server code runs in Frankfurt, Germany. Like any
            host, Vercel sees your IP address and keeps its own request logs. The lines our code
            writes to those logs contain error codes only.
          </p>
          <p className="mt-2">
            After a test our website can look up which network you are on from your IP address. In
            this version no lookup service is connected, so nothing is detected, and we keep nothing
            from the lookup.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">What is stored</h2>
          <p className="mt-1">
            Without sharing, we keep only counts. After each test your browser tells us how it ended
            (finished, stopped, or failed and why), whether low-data mode was on and which test
            server it used, never its numbers. We add one to a counter for that hour and that day,
            and keep nothing that links the count to you or your device. The{" "}
            <a className="underline underline-offset-2" href="/status">
              status page
            </a>{" "}
            shows these counts.
          </p>
          <p className="mt-2">
            To limit abuse, we also count requests from each connection, under a scrambled code made
            from your IP address with a random key that changes every day. Each count is deleted
            within a day, when its hour or day is over.
          </p>
          <p className="mt-2">
            Your browser keeps your choices on your device: whether low-data mode is on, whether you
            agreed to share results, and, for each result you share, a random secret that lets you
            delete it later.
          </p>
          <p className="mt-2">
            Before each test our server gives your browser a one-time test pass, and a ticket that
            lets our test servers tell a real test from someone using them as free downloads.
            Neither says anything about you; the ticket expires after two minutes.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Share links</h2>
          <p className="mt-1">
            When you press Share result, you get a link. The link itself carries the numbers,
            network and state shown on your result, and the day of the test. We store nothing for
            it, and anyone with the link can see it. Apps like WhatsApp fetch its preview picture
            from us, as they would from any website.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">The installed app</h2>
          <p className="mt-1">
            If you install {APP_NAME} on your phone or computer, the app keeps a copy of the home
            page on your device so it opens offline. It never stores your results there. Visiting
            the website without installing it stores no such copy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">If you choose to share</h2>
          <p className="mt-1">
            Sharing is off until you say yes. Once you agree, the result on screen and later ones
            are shared after you pick your network: the speeds, latency, jitter, data used, test
            length, when the test ran, your network, state and connection type, and whether the
            device is a phone, tablet or computer. We never store your IP address.
          </p>
          <p className="mt-2">
            The results are kept in a database run by Neon, and short-lived counters in a store run
            by Upstash. Both are hosted by Amazon Web Services in Frankfurt, Germany, so shared
            results leave Nigeria.
          </p>
          <p className="mt-2">
            When our hosting tells us your IP address, we also keep a scrambled code made from the
            first part of it (the first three numbers of an IPv4 address, or the first three groups
            of an IPv6 address). The code is made with a random key that changes every day and is
            deleted when the day ends, and the code itself is wiped after about 48 hours.
          </p>
          <p className="mt-2">
            The first part of an IPv4 address is shared by up to 256 addresses, often by many
            people. The first part of an IPv6 address can belong to a single home or office, so on
            the day the code is made it can tell results from the same connection apart. We use that
            only to spot duplicate or abusive results. Once that day&apos;s key is deleted, the code
            can&apos;t be traced back to an address or linked to codes from other days.
          </p>
          <p className="mt-2">
            Shared results are deleted after 12 months. For groups of at least{" "}
            {SHARING.minGroupSize} results we publish a count band (such as &ldquo;50&ndash;99
            results&rdquo;), rounded medians and a rounded range; smaller groups get no numbers at
            all. Each end of a range, and sometimes the median, is one real result rounded to 2
            significant figures, never with who sent it. Counts appear only as bands, so comparing
            groups doesn&apos;t show how many results separate them. That makes any one result hard
            to work out, though it can be done, most easily by someone who shares made-up results
            into a small group.
          </p>
        </section>

        <section id="delete" className="scroll-mt-6">
          <h2 className="text-lg font-semibold">Stop sharing, or delete what you shared</h2>
          <p className="mt-1">
            The &ldquo;Stop sharing&rdquo; button below your result stops future sharing. To remove
            results already shared, delete them here. This works from the browser you shared them
            from: it holds the only proof that they are yours. If you clear this site&apos;s data,
            we can no longer tell which results were yours, and they are deleted after 12 months.
          </p>
          <DeleteShared />
        </section>

        <section>
          <h2 className="text-lg font-semibold">Questions and concerns</h2>
          <p className="mt-1">
            Report a privacy concern privately through the project&apos;s{" "}
            <a className="underline underline-offset-2" href={`${SOURCE_URL}/security`}>
              GitHub security page
            </a>{" "}
            (&ldquo;Report a vulnerability&rdquo;).
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
