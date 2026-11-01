import type { Linter } from "eslint";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export function base(tsconfigRootDir: string, ...extra: Linter.Config[]) {
  return defineConfig(
    globalIgnores([
      "**/node_modules/",
      "**/.next/",
      "**/.turbo/",
      "**/coverage/",
      "**/playwright-report/",
      "**/test-results/",
      "**/next-env.d.ts",
    ]),
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    {
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            destructuredArrayIgnorePattern: "^_",
          },
        ],
        "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      },
    },
    ...extra,
    prettier,
  );
}
