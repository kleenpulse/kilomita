import type { Metadata } from "next";
import { SiteFooter } from "./_components/site-footer";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/*
 * Our own 404, styled with the site's classes. Next's built-in one carries an inline <style>,
 * which the CSP's style-src 'self' blocks (Phase 7). Plain links: no client JS of its own.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <main className="flex-1 pt-16 pb-10 text-base leading-relaxed">
        <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          This page doesn&apos;t exist, or a share link was mistyped.
        </p>
        <p className="mt-6">
          <a href="/" className="underline underline-offset-2">
            Test your connection
          </a>{" "}
          ·{" "}
          <a href="/isps" className="underline underline-offset-2">
            See ISP speeds
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
