# KiloMita: agent and maintainer guide

KiloMita ("How far your network speed?") is a fast.com-style internet speed test for Nigerian users, with an aggregated, anonymised per-ISP/per-state dashboard. The full requirements are in `mita-frd.md`. That file calls the app "Mita" in its brand section and "NaijaSpeed" in one other place. On 2026-11-01 the maintainer renamed the product to **KiloMita**, with package scope `@kilomita/*`. The FRD is left as written, so read its "Mita" as KiloMita. The display name lives only in `packages/shared/brand.ts`.

## Phase status

| Phase | Scope                                              | Status             |
| ----- | -------------------------------------------------- | ------------------ |
| 0     | Foundation: monorepo, tooling, CI, shared schemas  | **Done** (295d397) |
| 1     | Measurement engine (`packages/engine`)             | Not started        |
| 2     | Test UI (`apps/web`)                               | Not started        |
| 3     | ISP and location detection, consent                | Not started        |
| 4     | Results API and storage                            | Not started        |
| 5     | Public insights dashboard                          | Not started        |
| 6     | Own test servers (`apps/server`), share cards, PWA | Not started        |
| 7     | Production hardening                               | Not started        |

Work one phase at a time. Each phase ends with typecheck, lint and tests passing, a summary, known limitations and manual verification steps. Then stop for the maintainer's approval.

## Commands

```sh
bun install                              # install (isolated linker, see bunfig.toml)
bun run dev                              # turbo: web app on http://localhost:3000
bun run build / bun run start            # turbo build / serve the build
bun run typecheck                        # turbo: tsc in every workspace
bun run lint                             # turbo: ESLint in every workspace (errors fail)
bun run format / bun run format:check    # Prettier, repo-wide (not a turbo task)
bun run test                             # turbo: Vitest in shared, engine, scripts
bun --filter @kilomita/web playwright:install && bun run test:e2e   # turbo, builds first
bun run licenses                         # dependency licence check
bun run tripwire                         # malware-marker scan (exit 0 clean, 1 found, 2 scan error)
```

## Architecture

```
apps/web                    @kilomita/web                Next.js 16 App Router, Tailwind v4, React 19. No src/, no pages/. @/* → ./*
packages/shared             @kilomita/shared             Zod schemas + constants (brand, 36 states + FCT, ISP list). Depends on zod only.
packages/engine             @kilomita/engine             Framework-agnostic engine. Phase 0: ENGINE_VERSION stub only.
packages/eslint-config      @kilomita/eslint-config      ESLint presets (TS): base, isomorphic, next
packages/typescript-config  @kilomita/typescript-config  tsconfig presets (JSON): base, nextjs
scripts/                    @kilomita/scripts            check-licenses.ts (run by Bun), tripwire.sh (POSIX sh) + tests
```

- **Dependency direction:** `web → engine → shared`. Shared never imports engine. The engine test checks `ENGINE_VERSION` against `SpeedTestResultSchema.shape.engineVersion`.
- Workspace packages export TS source directly (`"exports": { ".": "./index.ts" }`). There is no build step, and Next transpiles them via `transpilePackages`.
- `SpeedTestResult` deliberately has **no IP field**. The hashed IP prefix is added server-side in Phase 4.
- `requestLossPct` counts failed or timed-out HTTP probes. It is not ICMP packet loss, and the methodology page must say so.
- The ISP list has slug and name only. ASNs come in Phase 3 and must be verified against RIPEstat, bgp.he.net or ipinfo, with the source linked per entry. Never invent ISP facts.
- `lgaSlug` is an optional free-form slug. There is no LGA list yet; add one only with a cited source.

## Toolchain decisions

- **Bun 1.4.4** is the package manager and script runner. Next, tsc, ESLint, Vitest and Playwright have `#!/usr/bin/env node` shebangs, so they **run on Node** (`engines.node >=20.9`, `.node-version` 24). Bun runs only the repo's own `scripts/*.ts`.
- **TypeScript is pinned `~6.0.3`.** TypeScript 7 (the native port) is outside typescript-eslint's peer range (`<6.1.0`). Revisit when typescript-eslint supports it.
- **Turborepo 2.11** orchestrates workspace tasks (`turbo.json`), adopted 2026-11-01 before Phase 1, with D:\Avi\eazyaza as the reference.
  - **Root scripts** delegate to `turbo run`. Repo-wide jobs (Prettier, licences, tripwire) stay plain root scripts.
  - **`transit`** is a no-op task. `typecheck`, `lint` and `test` depend on it, so a change in `@kilomita/shared` invalidates the cached typecheck of engine and web, which consume shared's TS source, without making them wait for a build.
  - **Strict env mode:** a task only sees env vars declared in `turbo.json`. Undeclared vars vanish, and declared ones are part of the cache key. When code reads a new env var, declare it on the task (`build`: `NEXT_PUBLIC_SITE_URL`; `test:e2e`: `CI`, `PORT`, `NEXT_PUBLIC_SITE_URL`; `dev`: `PORT`, `NEXT_PUBLIC_SITE_URL`). This was verified for e2e: `CI=1` reaches Playwright through turbo (`[WebServer] $ next start`).
  - **Telemetry:** Turbo collects anonymous telemetry by default. CI sets `TURBO_TELEMETRY_DISABLED=1`. Locally, run `bun x turbo telemetry disable` once.
  - **No remote cache.** Vercel Remote Cache is a third-party service; ask the maintainer before enabling it.
  - **Adding a workspace** means adding `package.json` scripts (`lint`, `typecheck`, and `test` if it has tests), an `eslint.config.ts` that calls a preset, and a `tsconfig.json` that extends a preset. A workspace without them is silently skipped by turbo.
  - **A task that reads another workspace's files must declare that workspace as a dependency.** Otherwise turbo's cache key ignores those files and replays a stale pass. `@kilomita/scripts` lists `@kilomita/shared` and `@kilomita/engine` as devDependencies for exactly this reason: `isomorphic.test.ts` reads their configs. Verified: with a warm cache, regressing `packages/engine/tsconfig.json` makes `scripts#test` miss the cache and fail.
- **Isolated linker** (`bunfig.toml`). Every workspace declares every package it imports or whose binary it runs, including its own eslint, jiti, typescript, vitest and config presets. The root keeps only turbo, Prettier, Husky, lint-staged, and eslint + jiti for the pre-commit hook.
- **`trustedDependencies: []`** is explicitly empty. That also disables Bun's built-in default allowlist, so **no dependency runs install scripts**. This is intentional. sharp and @tailwindcss/oxide ship ready-built binaries. Add a package here only after a verified install or runtime failure, and record why in this file.
- **ESLint:** each workspace has an `eslint.config.ts` calling a preset from `@kilomita/eslint-config` with `import.meta.dirname`. ESLint 10 resolves the nearest config from each file's folder, so per-package configs also work for the root pre-commit hook. Lint is a **gate**: errors fail CI. That differs from eazyaza, which only warns.
  - `base`: typescript-eslint `strictTypeChecked` with typed linting, plus Prettier.
  - `isomorphic` (shared, engine): these packages must run in browsers as well as Node. There are two guards:
    1. **Compile time (primary):** the package `tsconfig.json` sets `types: []` and excludes `eslint.config.ts`, so any Node API (`process`, `globalThis.Buffer`, `node:*` imports) fails `tsc`. `types: []` must stay explicit: `@types/node` is installed for the config file, and TypeScript would otherwise auto-include it. `eslint.config.ts` is type-checked separately by `tsconfig.config.json` (with Node types) as the second step of `typecheck`, and linted without type information.
    2. **Lint (backstop, clearer messages):** bans Node built-in imports, Node-only globals, and the same names reached through `globalThis`, `window` or `self`. The engine adds a React/Next import ban through the same rule.
    - `scripts/isomorphic.test.ts` probes both guards against the real shared and engine configs. It must keep failing if either guard regresses.
  - `next` (web): `eslint-config-next/core-web-vitals`, with `settings.next.rootDir` set to the package.
  - `jiti` lets ESLint load TS configs on Node.
- **TypeScript:** each workspace's `tsconfig.json` extends `@kilomita/typescript-config/base.json` or `nextjs.json` and every `.ts` file in the package is type-checked: by `tsconfig.json`, or for shared and engine's `eslint.config.ts`, by `tsconfig.config.json`. There is no root tsconfig, because there are no root TS files.
- **PostCSS config is JSON** (`apps/web/postcss.config.json`). There are no JS config files, and a data-only file cannot hide injected code.
- **`.gitattributes` forces LF.** The maintainer's system git has `core.autocrlf=true`, which would otherwise break `prettier --check` on Windows checkouts.
- **Vitest** runs per workspace with defaults and no config files (shared, engine and scripts have a `test` script). When apps/web gets unit tests in Phase 2, add a `vitest.config.ts` there that excludes `e2e/**`, because Playwright's `test()` throws under Vitest.
- **Playwright** runs `bun run dev` locally (reusing a running server) and `bun run start` after the build in CI.
- **`apps/web/AGENTS.md` is generated by `next dev`** (Next 16.4 `agentRules`), and `next dev` re-creates it if it's deleted. It is committed as-is. It points agents to the version-matched docs in `apps/web/node_modules/next/dist/docs/`, so read those before writing Next.js code. Next 16 differs from older training data.
- **Bundle baseline:** in Phase 0, `/` loads 131.5 KiB of gzipped JS on modern browsers: 5 chunks, all Next 16 + React 19 runtime with no app code. Legacy browsers also fetch a 38.5 KiB `noModule` polyfill. Phase 2 adds the engine and UI on top of that, so keep client components small.

## FOSS and licensing

- **License:** AGPL-3.0-only (`LICENSE`), and every `package.json` says so. All packages are `"private": true`, so nothing is published to npm.
- **AGPL §13:** the footer links to `SOURCE_URL` (`https://github.com/kleenpulse/kilomita`). Keep the source link visible on every deployed page.
- **Contact:** GitHub private vulnerability reporting only, for both security issues and Code of Conduct reports. No email address is published.
- **DCO:** the CI `dco` job requires `Signed-off-by` on every non-merge PR commit. Sign-off certifies a human's rights to the code, so **agents never add `Signed-off-by` lines**. The human submitting signs off.
- **Licence check:** `bun run licenses` walks `node_modules/.bun/<entry>/node_modules/<name>/package.json` plus the workspaces, parses SPDX expressions (AND/OR/WITH, parentheses), and fails on a missing licence field. Data exception: `caniuse-lite` (CC-BY-4.0). Optional platform packages differ between Windows and Linux, so the CI (Linux) run is authoritative.
- **Future constraints:**
  - MaxMind GeoLite2 data may not be redistributed, so never commit it. If it's chosen in Phase 3, download it at deploy time with the operator's own licence key.
  - Check Cloudflare's speed test endpoint terms of use before Phase 1 depends on them.

## Security tripwire

The maintainer's machine was hit by a self-propagating npm worm in 2026-10. It forged commits, appended obfuscated loaders to `postcss.config.*` files, planted editor tasks that run on folder open, and hid "fonts" that were really JavaScript droppers. `scripts/tripwire.sh` runs first in CI and fails on:

1. the worm's campaign markers and C2 addresses, and both loader-key regexes (every `global`/`globalThis` bang-key and `.i = 'A…'` spelling)
2. any tracked `.js`, `.cjs` or `.mjs` file
3. a `package.json` script that runs `node` on a non-`.ts` path
4. `.gitignore` entries the worm used to hide its push scripts
5. a VS Code `tasks.json` that runs on folder open, or settings that allow automatic tasks

Patterns are written with character classes so the script never matches itself. **Never paste the literal markers into this repo**, including in docs, tests and this file. The full indicator list lives in the maintainer's private incident record, outside the repo. Self-test probes go in a scratch directory outside the repo (`TRIPWIRE_TARGET=<dir> sh scripts/tripwire.sh`).

- **It fails closed.** Outside a git work tree, or if any scan errors, it exits 2. It never reports clean by accident.
- **Tests:** `scripts/tripwire.test.ts` builds its markers at runtime and covers non-repo, clean, planted, scan-error and every loader-key spelling.
- **Windows:** `bun run tripwire` goes through `scripts/tripwire.ts`, which finds a POSIX `sh` on PATH or Git for Windows' bundled `bin/sh.exe`. A plain PowerShell has no `sh`. CI calls `sh scripts/tripwire.sh` directly.

## Conventions

- TypeScript only. No `src/` directories. App Router only.
- Comments only where the reason is not obvious.
- Simple over clever. No speculative abstractions.
- Pidgin touches are fine in microcopy. Errors, privacy and methodology text stay in clear standard English.
- Mobile-first, low-end Android, expensive data: keep the JS small and avoid layout shift.
- Ask the maintainer before adding a paid service or a heavy dependency.

## Phase 0 summary

- **Built:**
  - Bun workspace monorepo, strict TS base config
  - single root ESLint config, Prettier, Husky + lint-staged
  - Vitest and Playwright, GitHub Actions CI (tripwire, DCO, check)
  - licence checker, tripwire
  - `@kilomita/shared` schemas and constants, `@kilomita/engine` stub
  - a minimal Next.js home page
  - FOSS docs
- **Known limitations:**
  - no LGA list, no ASNs
  - the engine is a stub, and the Start button is disabled
  - licence-check results differ by platform
- **Manual steps for the maintainer:**
  1. ~~create the GitHub repo~~ done: `kleenpulse/kilomita`.
  2. ~~enable private vulnerability reporting~~ done
  3. ~~commit and push~~ done: 295d397 on `main`, CI green
