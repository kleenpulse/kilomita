import type { Metadata } from "next";
import { APP_NAME, TAGLINE } from "@kilomita/shared";
import { SpeedTest } from "@/components/speed-test";
import { SiteFooter } from "./_components/site-footer";

// The installed app opens at /?source=pwa; search engines should only ever list /.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <header className="pt-8 pb-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-base text-neutral-600 dark:text-neutral-400">{TAGLINE}</p>
      </header>

      <main className="flex flex-1 flex-col items-center pb-10">
        <SpeedTest />
      </main>

      <SiteFooter />
    </div>
  );
}
