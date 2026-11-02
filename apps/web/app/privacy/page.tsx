import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, SOURCE_URL } from "@kilomita/shared";

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
          This page describes the current version of {APP_NAME}. A full privacy policy, with how
          long shared results are kept and how to delete them, will be published before results are
          stored.
        </p>
      </header>

      <main className="flex-1 space-y-6 pb-10 text-base leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">What the test contacts</h2>
          <p className="mt-1">
            The speed test downloads and uploads data to a test server, currently run by Cloudflare.
            Like any server, it sees your IP address. Its responses also include your IP address and
            approximate location; {APP_NAME} never reads them.
          </p>
          <p className="mt-2">
            Our own server also receives your IP address with every request, as every website does.
            After a test it can look up which network you are on from that address. In this version
            no lookup service is connected, so nothing is detected, and we keep nothing from the
            lookup.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">What is stored</h2>
          <p className="mt-1">
            Nothing from your test is stored on our servers in this version. Your browser keeps two
            choices on your device: whether low-data mode is on, and whether you agreed to share
            results.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">If you choose to share</h2>
          <p className="mt-1">
            Sharing is off until you say yes. If you agree, we will keep the result on screen and
            later ones: the speeds, your network, state and connection type. We will not store your
            IP address. We keep only a scrambled code made from the first part of it (the first
            three numbers of an IPv4 address, or the first three groups of an IPv6 address). The
            code is made with a random key that changes every day and is deleted when the day ends.
          </p>
          <p className="mt-2">
            The first part of an IPv4 address is shared by up to 256 addresses, often by many
            people. The first part of an IPv6 address can belong to a single home or office, so on
            the day the code is made it can tell results from the same connection apart. We use that
            only to spot duplicate or abusive results. Once that day&apos;s key is deleted, the code
            can&apos;t be traced back to an address or linked to codes from other days.
          </p>
          <p className="mt-2">
            You can change your mind at any time with the &ldquo;Stop sharing&rdquo; button below
            your result. Stopping applies to future results.
          </p>
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
    </div>
  );
}
