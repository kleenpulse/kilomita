import { APP_NAME, SOURCE_URL, TAGLINE } from "@kilomita/shared";
import { SpeedTest } from "@/components/speed-test";

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

      <footer className="py-6 text-center text-xs text-neutral-600 dark:text-neutral-400">
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
