import { isomorphic } from "@kilomita/eslint-config/isomorphic";

export default [
  ...isomorphic(import.meta.dirname, {
    paths: ["react", "react-dom", "next", "@kilomita/web"],
    patterns: ["react/*", "react-dom/*", "next/*", "@kilomita/web/*"],
    message: "The engine is framework-agnostic. Keep UI code in apps/web.",
    properties: [
      {
        object: "AbortSignal",
        property: "timeout",
        message: "Runs on real time, so fake-timer tests can't drive it. Use setTimeout.",
      },
      {
        object: "AbortSignal",
        property: "any",
        message: "Needs Chrome 116 / Safari 17.4, above the Next 16 baseline. Use linkSignal.",
      },
    ],
  }),
  {
    files: ["**/*.ts"],
    ignores: ["eslint.config.ts"],
    rules: {
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    files: ["**/*.ts"],
    ignores: ["eslint.config.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@kilomita/shared",
              allowTypeImports: true,
              message: "Type imports only: a value import pulls zod into the client bundle.",
            },
          ],
        },
      ],
    },
  },
];
