import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { base } from "./base";

export function next(tsconfigRootDir: string) {
  return base(tsconfigRootDir, ...nextCoreWebVitals, {
    settings: { next: { rootDir: tsconfigRootDir } },
  });
}
