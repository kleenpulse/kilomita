import type { ReactNode } from "react";

export const MUTED = "text-neutral-600 dark:text-neutral-400";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="pt-6 pb-4">
      <h1 className="text-3xl leading-snug font-bold tracking-tight">{title}</h1>
      {children ? <div className={`mt-2 text-base ${MUTED}`}>{children}</div> : null}
    </header>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
