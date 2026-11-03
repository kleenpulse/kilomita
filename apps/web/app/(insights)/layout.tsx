import type { ReactNode } from "react";
import { SiteFooter } from "../_components/site-footer";

const LINK = "underline-offset-2 hover:underline";

export default function InsightsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <nav aria-label="Site" className="flex flex-wrap gap-x-4 gap-y-1 pt-6 text-sm font-medium">
        <a href="/" className={LINK}>
          Speed test
        </a>
        <a href="/isps" className={LINK}>
          ISPs
        </a>
        <a href="/states" className={LINK}>
          States
        </a>
        <a href="/methodology" className={LINK}>
          Methodology
        </a>
      </nav>
      {children}
      <SiteFooter />
    </div>
  );
}
