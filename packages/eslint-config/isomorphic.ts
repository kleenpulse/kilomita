import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";
import { base } from "./base";

const NODE_ONLY = "Node-only API. This package must also run in browsers.";

const NODE_GLOBAL_NAMES = [
  "process",
  "Buffer",
  "global",
  "require",
  "module",
  "__dirname",
  "__filename",
  "setImmediate",
];

const GLOBAL_OBJECTS = ["globalThis", "window", "self"];

interface Restrictions {
  paths?: string[];
  patterns?: string[];
  message: string;
}

// For code shared by the browser and Node. The package's own tsconfig.json has `types: []`, so
// Node APIs fail to type-check; these rules are a second line of defence with clearer messages.
// eslint.config.ts is type-checked separately (tsconfig.config.json) and linted without types.
export function isomorphic(tsconfigRootDir: string, extra?: Restrictions) {
  const extraPaths = (extra?.paths ?? []).map((name) => ({ name, message: extra?.message }));
  const extraPatterns = (extra?.patterns ?? []).map((pattern) => ({
    group: [pattern],
    message: extra?.message,
  }));

  return base(
    tsconfigRootDir,
    {
      files: ["**/*.ts"],
      ignores: ["eslint.config.ts"],
      rules: {
        "no-restricted-globals": [
          "error",
          ...NODE_GLOBAL_NAMES.map((name) => ({ name, message: NODE_ONLY })),
        ],
        "no-restricted-properties": [
          "error",
          ...GLOBAL_OBJECTS.flatMap((object) =>
            NODE_GLOBAL_NAMES.map((property) => ({ object, property, message: NODE_ONLY })),
          ),
        ],
        "no-restricted-imports": [
          "error",
          {
            paths: [...builtinModules.map((name) => ({ name, message: NODE_ONLY })), ...extraPaths],
            patterns: [{ group: ["node:*"], message: NODE_ONLY }, ...extraPatterns],
          },
        ],
      },
    },
    { files: ["eslint.config.ts"], ...tseslint.configs.disableTypeChecked },
  );
}
