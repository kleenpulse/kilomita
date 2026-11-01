import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const WEB_FILES = "apps/web/**/*.{ts,tsx}";

const isIgnoresOnly = (config: object) => Object.keys(config).every((key) => key === "ignores");

const nextForWeb = nextCoreWebVitals.map((config) =>
  isIgnoresOnly(config) ? config : { ...config, files: [WEB_FILES] },
);

export default defineConfig(
  globalIgnores([
    "**/node_modules/",
    "**/.next/",
    "**/coverage/",
    "**/playwright-report/",
    "**/test-results/",
    "**/next-env.d.ts",
  ]),
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  ...nextForWeb,
  {
    files: [WEB_FILES],
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["react", "react-dom", "next", "@mita/web"],
          patterns: ["react/*", "react-dom/*", "next/*", "@mita/web/*"],
        },
      ],
    },
  },
  prettier,
);
