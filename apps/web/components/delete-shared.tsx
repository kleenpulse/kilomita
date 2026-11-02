"use client";

import { SHARING } from "@kilomita/shared/lists";
import { useState, useSyncExternalStore } from "react";
import { forget, readShared } from "@/lib/shared-results";
import { deleteResults } from "@/lib/sharing-api";

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("storage", listener);
  };
}

const sharedCount = () => readShared(Date.now()).length;

const plural = (count: number) => `${String(count)} ${count === 1 ? "result" : "results"}`;

/**
 * Deletes every result this browser shared, by the secrets it kept: there are no accounts, so
 * nothing else proves which results were yours. Sent in batches, each forgotten once deleted, so
 * a delete cut short can simply be started again.
 */
export function DeleteShared() {
  const count = useSyncExternalStore(subscribe, sharedCount, () => null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function remove() {
    const secrets = readShared(Date.now()).map((entry) => entry.secret);
    if (secrets.length === 0) return;
    if (
      !window.confirm(
        `Delete ${plural(secrets.length)} shared from this browser? This can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage("Deleting…");
    let deleted = 0;
    for (let i = 0; i < secrets.length; i += SHARING.deleteBatch) {
      const batch = secrets.slice(i, i + SHARING.deleteBatch);
      const found = await deleteResults(batch);
      if (found === null) {
        setMessage(`Deleted ${plural(deleted)}, then the connection failed. Try again.`);
        setBusy(false);
        return;
      }
      deleted += found;
      forget(batch, Date.now());
    }
    setMessage(`Deleted ${plural(deleted)}.`);
    setBusy(false);
  }

  const countText =
    count === null
      ? "Checking this browser…"
      : `Results shared from this browser: ${String(count)}`;
  return (
    <div className="mt-3 rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <p data-testid="shared-count" className="h-6 tabular-nums">
        <span key={countText}>{countText}</span>
      </p>
      <button
        type="button"
        disabled={busy || !count}
        onClick={() => {
          void remove();
        }}
        className="mt-3 h-11 rounded-full border border-neutral-300 px-5 text-base font-semibold hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        Delete them
      </button>
      {/* Two lines reserved for the longest message at 320 px. */}
      <p data-testid="delete-status" aria-live="polite" className="mt-3 h-10 text-sm">
        <span key={message}>{message}</span>
      </p>
    </div>
  );
}
