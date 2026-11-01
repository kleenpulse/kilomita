import { APP_NAME, SOURCE_URL, TAGLINE } from "@mita/shared";

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 py-12 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="text-lg text-neutral-600 dark:text-neutral-400">{TAGLINE}</p>
        </div>

        <p
          className="flex items-baseline gap-2 tabular-nums"
          aria-label="Download speed not measured yet"
        >
          <span className="text-7xl font-semibold leading-none sm:text-8xl">--</span>
          <span className="text-xl text-neutral-500">Mbps</span>
        </p>

        <button
          type="button"
          disabled
          className="h-14 min-w-40 rounded-full bg-emerald-600 px-8 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start
        </button>

        <p className="text-sm text-neutral-500">We dey build am. The speed test go land soon.</p>
      </main>

      <footer className="py-6 text-center text-xs text-neutral-500">
        {APP_NAME} is free software (AGPL-3.0) ·{" "}
        <a
          href={SOURCE_URL}
          className="underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          Source code
        </a>
      </footer>
    </div>
  );
}
