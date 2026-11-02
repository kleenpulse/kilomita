import { isomorphic } from "@kilomita/eslint-config/isomorphic";

export default [
  ...isomorphic(import.meta.dirname),
  {
    // The `./lists` subpath reaches client bundles, so its files must stay zod-free. This is the
    // typescript-eslint rule on purpose: a core `no-restricted-imports` here would replace the
    // preset's Node bans for these files.
    files: ["isps.ts", "states.ts", "network-types.ts", "lists.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: ["zod", "./schemas", "./index", "."].map((name) => ({
            name,
            message: "Keep the ./lists files zod-free: they reach client bundles.",
          })),
          patterns: [{ group: ["zod/*"], message: "Keep the ./lists files zod-free." }],
        },
      ],
    },
  },
];
