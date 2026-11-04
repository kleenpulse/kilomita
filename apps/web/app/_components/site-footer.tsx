import { APP_NAME, SOURCE_URL } from "@kilomita/shared";

const LINK = "underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200";

/**
 * On every page. The source link is what AGPL-3.0 §13 asks of a network service. Plain links, not
 * next/link: next/link adds a client chunk to otherwise static pages.
 */
export function SiteFooter() {
  return (
    <footer className="py-6 text-center text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
      <p>
        {APP_NAME} is free software (AGPL-3.0) ·{" "}
        <a href={SOURCE_URL} className={LINK}>
          Source code
        </a>
      </p>
      <p>
        <a href="/isps" className={LINK}>
          ISP speeds
        </a>{" "}
        ·{" "}
        <a href="/methodology" className={LINK}>
          Methodology
        </a>{" "}
        ·{" "}
        <a href="/privacy" className={LINK}>
          Privacy
        </a>{" "}
        ·{" "}
        <a href="/status" className={LINK}>
          Status
        </a>
      </p>
    </footer>
  );
}
