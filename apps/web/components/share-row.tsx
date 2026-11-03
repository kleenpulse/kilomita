import { useState } from "react";
import type { ShareCard } from "@/lib/share-code";
import { SHARE_CAPTION } from "@/lib/share-caption";
import type * as ShareModule from "@/lib/share-card";

const BUTTON =
  "inline-flex h-11 shrink-0 items-center rounded-full px-5 text-base font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

const STATUS: Record<ShareModule.ShareOutcome, string | null> = {
  shared: null,
  cancelled: null,
  copied: "Link copied. Paste it anywhere.",
  failed: "Couldn't share from this browser. Try the WhatsApp link.",
};

interface Props {
  /** Loaded with import() after the result appears; null until then. */
  share: typeof ShareModule | null;
  card: ShareCard | null;
}

export function ShareRow({ share, card }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const url = share && card ? share.shareUrl(card, window.location.origin) : null;
  const text = share && card ? share.shareText(card) : null;
  const ready = url !== null && text !== null;
  const whatsApp = share && url !== null && text !== null ? share.whatsAppHref(text, url) : null;
  const caption = status ?? SHARE_CAPTION;

  return (
    <section
      aria-labelledby="share-heading"
      className="rounded-xl border border-neutral-300 p-4 text-left dark:border-neutral-700"
    >
      <h2 id="share-heading" className="text-base font-semibold">
        Show your people
      </h2>
      {/* Three lines reserved: the caption, or what happened, in a wide font at 320 px. */}
      <p
        aria-live="polite"
        data-testid="share-status"
        className="mt-1 h-15 text-sm text-neutral-700 dark:text-neutral-300"
      >
        <span key={caption}>{caption}</span>
      </p>
      <div className="mt-2 flex h-11">
        <button
          type="button"
          disabled={!ready}
          className={`${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60`}
          onClick={() => {
            if (!share || !ready) return;
            void share.shareLink(text, url).then((outcome) => {
              setStatus(STATUS[outcome]);
            });
          }}
        >
          Share result
        </button>
      </div>
      {/* Its own line: next to the button it doesn't fit 320 px in a wide font. */}
      <p className="mt-3 h-5 text-sm">
        {/* A link only once it has somewhere to go: an <a> without href isn't crawlable. */}
        {whatsApp ? (
          <a
            href={whatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            Send it on WhatsApp
          </a>
        ) : (
          <span className="underline underline-offset-2 opacity-60">Send it on WhatsApp</span>
        )}
      </p>
    </section>
  );
}
