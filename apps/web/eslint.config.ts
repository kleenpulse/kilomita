import { next } from "@kilomita/eslint-config/next";

const MESSAGE = "Server-only code: import it from server/ or app/api/ only.";
// Regexes, so a relative path is caught at any depth. Not "server" anywhere: next/server is fine.
const SERVER_ALIAS = "^@/server(/|$)";
const SERVER_ALIAS_EXCEPT_INSIGHTS = "^@/server(/(?!insights$).*)?$";
const SERVER_ALIAS_EXCEPT_CARD_LIMIT = "^@/server(/(?!card-limit$).*)?$";
const serverBan = (alias: string) =>
  [alias, "^\\./server(/|$)", "^(\\.\\./)+server(/|$)"].map((regex) => ({
    regex,
    message: MESSAGE,
  }));

const config = [
  ...next(import.meta.dirname),
  {
    // Plain links on purpose: next/link adds a client chunk to otherwise static pages
    // (CLAUDE.md, "Bundle"). The dashboard pages ship no JS of their own.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    // Client-reachable code takes only types from the engine and shared. The engine itself runs in
    // the Worker (its caps come from `@kilomita/engine/limits`), and shared's values pull in zod.
    files: ["components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["lib/speed-test.worker.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@kilomita/engine",
              allowTypeImports: true,
              message:
                "Type imports only: the engine runs in lib/speed-test.worker.ts. Caps come from @kilomita/engine/limits.",
            },
            {
              name: "@kilomita/shared",
              allowTypeImports: true,
              message: "Type imports only: a value import pulls zod into the client bundle.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    // Server code (Node built-ins, the ASN table, IP handling) stays out of anything that could
    // reach the client, including a future "use client" file in app/.
    files: ["**/*.{ts,tsx}"],
    ignores: ["server/**", "app/api/**", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: serverBan(SERVER_ALIAS) }],
    },
  },
  {
    // The insight pages are server components that read stats through one facade. A files-scoped
    // rule replaces the block above for these files, so the whole ban is restated here.
    files: ["app/\\(insights\\)/**/page.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: serverBan(SERVER_ALIAS_EXCEPT_INSIGHTS) }],
    },
  },
  {
    // The share-card image route may reach its render limit and nothing else under server/. The
    // share page next to it stays fully banned: it stores and looks up nothing.
    files: ["app/r/\\[code\\]/card.png/route.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: serverBan(SERVER_ALIAS_EXCEPT_CARD_LIMIT) }],
    },
  },
];

export default config;
