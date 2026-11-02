import { useRef } from "react";
import type { Consent, ConsentChoice } from "@/lib/consent";

const STATUS: Record<Consent, string> = {
  unasked: "Nothing is shared until you choose.",
  granted: "Sharing is on.",
  declined: "Your results aren't shared.",
};

/** Clicks this soon after a change are ignored, so a double tap can't undo the choice. */
const SETTLE_MS = 600;

const BUTTON =
  "h-11 shrink-0 rounded-full px-5 text-base font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";
const PRIMARY = `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`;
const SECONDARY = `${BUTTON} border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`;

interface Props {
  consent: Consent;
  onChoose: (choice: ConsentChoice) => void;
}

export function ConsentCard({ consent, onChoose }: Props) {
  const status = useRef<HTMLParagraphElement>(null);
  const changedAt = useRef(Number.NEGATIVE_INFINITY);

  const choose = (choice: ConsentChoice) => {
    const now = performance.now();
    if (now - changedAt.current < SETTLE_MS) return;
    changedAt.current = now;
    onChoose(choice);
    // Not onto the next button: a held Enter would press it straight away.
    status.current?.focus();
  };

  return (
    <section
      aria-labelledby="consent-heading"
      className="rounded-xl border border-neutral-300 p-4 text-left dark:border-neutral-700"
    >
      <h2 id="consent-heading" className="text-base font-semibold">
        Help compare networks in Nigeria?
      </h2>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        Share this result and future ones anonymously: speeds, network, state and connection type.
        We never store your IP address, only a scrambled code made from part of it, which can&apos;t
        be traced back after a day.
      </p>
      {/* Two lines reserved, so a wider font than ours can wrap the status without moving the
          buttons. */}
      <p
        ref={status}
        tabIndex={-1}
        aria-live="polite"
        data-testid="consent-status"
        className="mt-3 h-10 text-sm font-semibold focus:outline-none"
      >
        <span key={consent}>{STATUS[consent]}</span>
      </p>
      <div className="mt-2 flex h-11 gap-3">
        {consent === "granted" ? (
          <button
            type="button"
            className={SECONDARY}
            onClick={() => {
              choose("declined");
            }}
          >
            Stop sharing
          </button>
        ) : (
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              choose("granted");
            }}
          >
            Share
          </button>
        )}
        {consent === "unasked" ? (
          <button
            type="button"
            className={SECONDARY}
            onClick={() => {
              choose("declined");
            }}
          >
            No thanks
          </button>
        ) : null}
      </div>
      <a
        href="/privacy"
        className="mt-3 inline-block text-sm underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        How we handle data
      </a>
    </section>
  );
}
