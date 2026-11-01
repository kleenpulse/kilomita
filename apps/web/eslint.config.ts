import { next } from "@kilomita/eslint-config/next";

const config = [
  ...next(import.meta.dirname),
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
];

export default config;
