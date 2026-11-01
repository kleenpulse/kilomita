import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_NAME, DESCRIPTION, TAGLINE } from "@kilomita/shared";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${APP_NAME} · ${TAGLINE}`, template: `%s · ${APP_NAME}` },
  description: DESCRIPTION,
  applicationName: APP_NAME,
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} · ${TAGLINE}`,
    description: DESCRIPTION,
    locale: "en_NG",
  },
  twitter: { card: "summary", title: `${APP_NAME} · ${TAGLINE}`, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
