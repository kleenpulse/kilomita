# KiloMita: agent and maintainer guide

KiloMita ("How far your network speed?") is a fast.com-style internet speed test for Nigerian users, with an aggregated, anonymised per-ISP/per-state dashboard. The full requirements are in `mita-frd.md`. That file calls the app "Mita" in its brand section and "NaijaSpeed" in one other place. On 2026-11-01 the maintainer renamed the product to **KiloMita**, with package scope `@kilomita/*`. The FRD is left as written, so read its "Mita" as KiloMita. The display name lives only in `packages/shared/brand.ts`.

## Phase status

| Phase | Scope                                              | Status             |
| ----- | -------------------------------------------------- | ------------------ |
| 0     | Foundation: monorepo, tooling, CI, shared schemas  | **Done** (295d397) |
| 1     | Measurement engine (`packages/engine`)             | **Done** (e7d504f) |
| 2     | Test UI (`apps/web`)                               | **Done** (a7e2dae) |
| 3     | ISP and location detection, consent                | **Done** (876b9ad) |
| 4     | Results API and storage                            | **Done**           |
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
bun run test                             # turbo: Vitest in shared, engine (+ coverage gate), web, scripts
bun --filter @kilomita/web playwright:install && bun run test:e2e   # turbo, builds first
bun run licenses                         # dependency licence check
bun run tripwire                         # malware-marker scan (exit 0 clean, 1 found, 2 scan error)
bun run load-test -- --url http://localhost:3931   # sharing API load test (Bun, no deps); only against your own server
bun --filter @kilomita/web db:generate   # drizzle-kit: SQL migrations from server/db/schema.ts, offline
bun --filter @kilomita/web db:migrate    # apply migrations to DATABASE_URL, then purge expired data (maintainer only)
bun --filter @kilomita/web db:purge      # purge only
```

## Architecture

```
apps/web                    @kilomita/web                Next.js 16 App Router, Tailwind v4, React 19. No src/, no pages/. @/* → ./*
packages/shared             @kilomita/shared             Zod schemas + constants (brand, 36 states + FCT, ISP list). Depends on zod only.
packages/engine             @kilomita/engine             Measurement engine: event API, fetch only, runs in browsers, Workers and Node. Subpath ./limits = caps only.
packages/eslint-config      @kilomita/eslint-config      ESLint presets (TS): base, isomorphic, next
packages/typescript-config  @kilomita/typescript-config  tsconfig presets (JSON): base, nextjs
scripts/                    @kilomita/scripts            check-licenses.ts (run by Bun), tripwire.sh (POSIX sh) + tests
```

- **Dependency direction:** `web → engine → shared`. Shared never imports engine. The engine imports only **types** from shared (lint-enforced, see ESLint below), so zod never reaches the client bundle through it. Engine tests validate results against `SpeedTestResultSchema`.
- Workspace packages export TS source directly (`"exports": { ".": "./index.ts" }`). There is no build step, and Next transpiles them via `transpilePackages`.
- `SpeedTestResult` deliberately has **no IP field**. The hashed IP prefix is added server-side on submit (see "Results API and storage").
- `requestLossPct` counts failed or timed-out HTTP probes. It is not ICMP packet loss, and the methodology page must say so.
- The ISP list has slug and name only; the ASNs live in `packages/shared/asns.ts`, each verified against RIPEstat with its source linked (see "ISP and location detection"). Never invent ISP facts.
- **FiberOne, not FibreOne:** the FRD spells it "FibreOne", but the company is "FiberOne Broadband" (AS329267's AFRINIC contacts use `@fob.ng`, whose site uses that name). The slug is `fiberone` (maintainer's decision, 2026-11-02, before any data was stored).
- `lgaSlug` is an optional free-form slug. There is no LGA list yet; add one only with a cited source.

## Toolchain decisions

- **Bun 1.4.4** is the package manager and script runner. Next, tsc, ESLint, Vitest and Playwright have `#!/usr/bin/env node` shebangs, so they **run on Node** (`engines.node >=20.9`, `.node-version` 24). Bun runs only the repo's own `scripts/*.ts`.
- **TypeScript is pinned `~6.0.3`.** TypeScript 7 (the native port) is outside typescript-eslint's peer range (`<6.1.0`). Revisit when typescript-eslint supports it.
- **Turborepo 2.11** orchestrates workspace tasks (`turbo.json`), adopted 2026-11-01 before Phase 1, with D:\Avi\eazyaza as the reference.
  - **Root scripts** delegate to `turbo run`. Repo-wide jobs (Prettier, licences, tripwire) stay plain root scripts.
  - **`transit`** is a no-op task. `typecheck`, `lint` and `test` depend on it, so a change in `@kilomita/shared` invalidates the cached typecheck of engine and web, which consume shared's TS source, without making them wait for a build.
  - **Strict env mode:** a task only sees env vars declared in `turbo.json`. Undeclared vars vanish, and declared ones are part of the cache key. When code reads a new env var, declare it on the task (`build`: `NEXT_PUBLIC_SITE_URL`; `test:e2e`: `CI`, `PORT`, `NEXT_PUBLIC_SITE_URL`; `dev`: `PORT`, `NEXT_PUBLIC_SITE_URL`, `CLIENT_IP_HEADER`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RESULT_TOKEN_SECRET`, `KILOMITA_STORES`). The e2e server gets `KILOMITA_STORES` and `RESULT_TOKEN_SECRET` from `playwright.config.ts` (`webServer.env`), not from turbo. This was verified for e2e: `CI=1` reaches Playwright through turbo (`[WebServer] $ next start`).
  - **Telemetry:** Turbo collects anonymous telemetry by default. CI sets `TURBO_TELEMETRY_DISABLED=1`. Locally, run `bun x turbo telemetry disable` once.
  - **No remote cache.** Vercel Remote Cache is a third-party service; ask the maintainer before enabling it.
  - **Adding a workspace** means adding `package.json` scripts (`lint`, `typecheck`, and `test` if it has tests), an `eslint.config.ts` that calls a preset, and a `tsconfig.json` that extends a preset. A workspace without them is silently skipped by turbo.
  - **A task that reads another workspace's files must declare that workspace as a dependency.** Otherwise turbo's cache key ignores those files and replays a stale pass. `@kilomita/scripts` lists `@kilomita/shared` and `@kilomita/engine` as devDependencies for exactly this reason: `isomorphic.test.ts` reads their configs. Verified: with a warm cache, regressing `packages/engine/tsconfig.json` makes `scripts#test` miss the cache and fail.
- **Minimum release age** (`bunfig.toml`, `install.minimumReleaseAge = 604800`, maintainer's rule after the worm, 2026-11-02): Bun installs no release younger than 7 days, transitive ones included. Checked in the Bun 1.4.4 binary.
- **Isolated linker** (`bunfig.toml`). Every workspace declares every package it imports or whose binary it runs, including its own eslint, jiti, typescript, vitest and config presets. The root keeps only turbo, Prettier, Husky, lint-staged, and eslint + jiti for the pre-commit hook.
- **`trustedDependencies: []`** is explicitly empty. That also disables Bun's built-in default allowlist, so **no dependency runs install scripts**. This is intentional. sharp and @tailwindcss/oxide ship ready-built binaries. drizzle-kit brings three esbuild copies (0.18.20 via the deprecated `@esbuild-kit/core-utils`, 0.25.12, 0.28.2 via tsx), each with a blocked `node install.js` postinstall; their platform binaries come as optional packages, and `drizzle-kit generate` works without the postinstalls (verified 2026-11-02). Add a package here only after a verified install or runtime failure, and record why in this file.
- **ESLint:** each workspace has an `eslint.config.ts` calling a preset from `@kilomita/eslint-config` with `import.meta.dirname`. ESLint 10 resolves the nearest config from each file's folder, so per-package configs also work for the root pre-commit hook. Lint is a **gate**: errors fail CI. That differs from eazyaza, which only warns.
  - `base`: typescript-eslint `strictTypeChecked` with typed linting, plus Prettier.
  - `isomorphic` (shared, engine): these packages must run in browsers as well as Node. There are two guards:
    1. **Compile time (primary):** the package `tsconfig.json` sets `types: []` and excludes `eslint.config.ts`, so any Node API (`process`, `globalThis.Buffer`, `node:*` imports) fails `tsc`. Shared compiles against `ES2023` only. The engine adds the **WebWorker** lib (maintainer's choice, 2026-11-01): fetch, streams, abort and timers type-check, but `document`, `window` and `localStorage` don't, so the engine stays runnable in a Web Worker. TypeScript 6 already defaults `types` to `[]` (verified: without it, `tsc --listFiles` includes no `@types/node`), but it stays explicit so the guard doesn't hang on a default; the real risk is adding `"node"` to it. `eslint.config.ts` is type-checked separately by `tsconfig.config.json` (with Node types) as the second step of `typecheck`, and linted without type information.
    2. **Lint (backstop, clearer messages):** bans Node built-in imports, Node-only globals, and the same names reached through `globalThis`, `window` or `self`. The engine adds, through the preset's `extra` option: a React/Next import ban; bans on `AbortSignal.timeout` (runs on real time, so fake-timer tests can't drive it) and `AbortSignal.any` (Chrome 116 / Safari 17.4, above Next 16's Chrome/Edge/Firefox 111, Safari 16.4 baseline); and in non-test files, type-only imports from `@kilomita/shared` (`@typescript-eslint/no-restricted-imports` with `allowTypeImports`, plus `no-import-type-side-effects`, because `import { type X }` still compiles to a module-loading `import {}`). Extra `no-restricted-properties` entries must go through the preset: redefining the rule in a package config would replace the Node bans.
    - Shared's `./lists` files (`isps.ts`, `states.ts`, `network-types.ts`, `lists.ts`) reach client bundles, so shared bans `zod`, `./schemas`, `./index` and `.` in them. It uses `@typescript-eslint/no-restricted-imports` on purpose: a files-scoped core `no-restricted-imports` would replace the preset's Node bans for those files.
    - `scripts/isomorphic.test.ts` probes both guards against the real shared and engine configs, plus the engine's DOM ban and its lint rules, and the `./lists` ban (Node and zod both fail in each of those files). It must keep failing if any guard regresses.
  - `next` (web): `eslint-config-next/core-web-vitals`, with `settings.next.rootDir` set to the package.
  - Web adds two boundaries: `components/**` and `lib/**` take only types from `@kilomita/shared` and `@kilomita/engine` (values come from the zod-free subpaths `@kilomita/shared/lists` and `@kilomita/engine/limits`), and every file except `server/**`, `app/api/**` and tests is banned from importing `@/server/*` or a relative `server/` path. The patterns deliberately avoid `**/server`, which would also catch `next/server`. This replaces the `server-only` package, which Vitest can't resolve without installing it.
  - `jiti` lets ESLint load TS configs on Node.
- **TypeScript:** each workspace's `tsconfig.json` extends `@kilomita/typescript-config/base.json` or `nextjs.json` and every `.ts` file in the package is type-checked: by `tsconfig.json`, or for shared and engine's `eslint.config.ts`, by `tsconfig.config.json`. There is no root tsconfig, because there are no root TS files.
- **PostCSS config is JSON** (`apps/web/postcss.config.json`). There are no JS config files, and a data-only file cannot hide injected code.
- **`.gitattributes` forces LF.** The maintainer's system git has `core.autocrlf=true`, which would otherwise break `prettier --check` on Windows checkouts.
- **Vitest** runs per workspace with defaults (shared, engine, web and scripts have a `test` script). The only config file is `apps/web/vitest.config.ts`: it excludes `e2e/**`, because Playwright's `test()` throws under Vitest. Web unit tests run in the node environment (no jsdom); browser behaviour is covered by e2e. Server integration tests run on PGlite (Postgres in WASM) with the real migrations: one database per test file (`server/testing.ts`), emptied for every test, and `hookTimeout: 30_000`, because starting PGlite under turbo's parallel load can take several seconds.
  - **Engine coverage gate:** `@vitest/coverage-v8` (maintainer-approved 2026-11-01, engine devDependency only). The engine's `test` script passes the options as CLI flags (still no config file): v8, text report, `stats.ts` + `throughput.ts` + `transfer.ts`, 90% lines, branches and functions. Below that, `test` fails.
- **Playwright** runs `bun run dev` locally (reusing a running server) and `bun run start` after the build in CI. The server runs with `KILOMITA_STORES=memory` and a throwaway `RESULT_TOKEN_SECRET` per run, so sharing e2e uses the real routes and never reaches Neon or Upstash. Its readiness URL is `/api/stats/isp`, so tests start only after PGlite is up: before that, cold first requests outlasted the page's 3 s token timeout and 6 tests failed on their first attempt. Shared helpers live in `e2e/helpers.ts`.
  - **No Cloudflare traffic from e2e, by three layers:** `e2e/mock-endpoint.ts` answers `https://speed.cloudflare.com/**` through `context.route` (which also catches dedicated Worker requests, verified with Playwright 1.64); `playwright.config.ts` launches Chromium with `--host-resolver-rules=MAP speed.cloudflare.com ~NOTFOUND`, so an unrouted request fails DNS (proven on localhost, never against Cloudflare); and every full-run test asserts issued = routed > 0.
  - The mock is a processor-shared link (in-flight transfers split the capacity, like TCP flows). `route.fulfill` delivers a body in one burst, so readings are only roughly the mock's rates and the e2e bounds are loose. Every answer must come within 5 s (asserted); the engine aborts a request silent for 6 s.
  - Playwright can't make a tab `hidden` (all methods tried, headless and headed), so the stop-on-hide test overrides `document.visibilityState` and dispatches `visibilitychange`.
  - Layout shift is a test: an init script records every `layout-shift` entry, including those right after input, and full-run tests assert there are none. Next's dev route announcer also has `role="alert"`, so tests look for alerts inside `<main>`.
- **`apps/web/AGENTS.md` is generated by `next dev`** (Next 16.4 `agentRules`), and `next dev` re-creates it if it's deleted. It is committed as-is. It points agents to the version-matched docs in `apps/web/node_modules/next/dist/docs/`, so read those before writing Next.js code. Next 16 differs from older training data.
- **Bundle:** measured by gzipping (level 9) each JS chunk that the prerendered `.next/server/app/index.html` references. Phase 0 (`e7d504f`, same method): 132.0 KiB, 5 chunks, all Next 16 + React 19 runtime (Phase 0 originally reported 131.5 with other gzip settings). Phase 2: 138.0 KiB, 6 chunks (+6.0 KiB, the UI). Phase 3: 140.9 KiB, 7 chunks (+2.9 KiB: network details, consent, the lists). Phase 4: 143.5 KiB, 7 chunks (+2.6 KiB: token, send, corrections, device class); `/privacy` 138.3 KiB in all (Phase 3: 135.6; +2.7 KiB, the delete island). Measured against a Phase 3 build of `d950f20` the same way; the initial chunks hold no zod, drizzle, PGlite, Upstash, postgres or crypto strings; links to `/privacy` are plain `<a>`, because `next/link` cost 2.9 KiB more for a static page. `/privacy` loads one 3.2 KiB chunk of its own (`next/link`, for its link back to `/`); the Worker's engine chunk (5.7 KiB) loads only on Start. Legacy browsers also fetch a 38.6 KiB `noModule` polyfill. The engine is not in the initial chunks: it loads with the Worker when Start is pressed. Keep it that way: the main thread imports only types and `@kilomita/engine/limits` (the engine has no `sideEffects` declaration, so importing its index would likely pull it all in).

## Measurement engine (`packages/engine`)

- **API:** `createSpeedTest({ endpoint, lowData?, maxBytes?, maxDurationMs?, fetch? })` returns `{ start, cancel, on }`.
  - `start()` resolves to `{ status: "complete", result }` or `{ status: "error", error }` and never rejects. A second call returns the same promise.
  - Exactly one terminal event per instance: `complete`, or `error` with code `cancelled`, `network-lost` or `endpoint-error`. `cancel()` before `start()` is the outcome; after the end it does nothing.
  - `progress` comes per latency probe and every 250 ms tick, with `bytesUsed` for the live data counter. Events are plain objects (structured-cloneable), so the engine can run in a Web Worker.
  - The result is the measurement part of `SpeedTestResult`, plus `addedLatencyMs` (the graded delta), `loadedP95Ms` (95th-percentile latency under load per direction, from the same post-warm-up probes as the loaded medians; added in 0.2.0 for the verdicts) and `stoppedBy` (`stable`, `time` or `data-cap` per direction).
  - `@kilomita/engine/limits` exports `TEST_LIMITS` (frozen caps and durations per profile), `gradeBufferbloat` (`grade.ts`) and the plausibility envelope (`envelope.ts`: `PLAUSIBILITY`, `outsideEnvelope`). It imports neither the engine nor zod, so a page or the server can use them without bundling the engine.
  - A caller's `fetch` is always called as a plain function: a native fetch called as a method throws "Illegal invocation" in browsers (Node doesn't care, so only a test with a `this`-checking fetch catches it).
- **Files:** `engine.ts` (orchestration, deadlines, events), `latency.ts` (probes, warm-up, loaded probes), `grade.ts` (the bufferbloat grade), `envelope.ts` (what genuine results look like), `transfer.ts` (streams, ramp, sizing, budget, stall), `throughput.ts` (segment meter, warm-up end, estimate, stability), `stats.ts`, `profiles.ts`, `endpoint.ts` (`TestEndpoint`), `cloudflare.ts` (the only file that knows Cloudflare), `runtime.ts` (run context, failures, timers), `types.ts`. `simulated-network.ts` is a test helper and isn't exported.
- **Latency:** the first _successful_ probe pays for DNS/TCP/TLS and never counts (it may take up to the 6 s stall timeout on 2G). Then sequential `bytes=0` probes. Sample = request to response headers, minus the server time in `Server-Timing` (`cfRequestDuration`, else the sum of `cfSpeed*`, as Cloudflare's own client does), clamped at 0. Median and p95 by linear interpolation; jitter = mean absolute difference of consecutive samples; loss = failed or timed-out probes ÷ probes sent.
- **Throughput:**
  - Bytes are recorded as time segments: per `read()` for download; per POST for upload, spread over the request's life, because fetch has no upload progress. Ticks become 250 ms Mbps samples once settled (no open transfer can still add bytes to them).
  - Warm-up ends 1 s after the first byte, or once two ticks in a row grow < 10% (never within 2 ticks). The tick in which a stream is added, and the one after it, are also dropped.
  - Estimate = interquartile mean of the last 8 post-warm-up samples. With fewer than 4, the last 4 samples; with fewer in total, all of them.
  - Stable when the last 4 window estimates spread ≤ 5% (8% low-data) of their mean, once the ramp is done and a full window has passed since the last addition.
  - Streams ramp from 1 while each addition raises throughput ≥ 10%, judged only on settled samples after it. Max 5 (3 down / 2 up low-data): browsers allow 6 HTTP/1.1 connections per host and the loaded probe needs one.
  - Requests are sized to last max(1 s download / 0.5 s upload, 8 idle RTTs) at the stream's rate, excluding the reply round trip. The first request is 64 KB down / 32 KB up. Uploads are incompressible xorshift bytes.
- **Loaded latency:** probes run during each throughput phase, starting at the first byte (download) or one idle RTT after the first send (upload): earlier, they measure an idle line. Timeouts count as the timeout. Loaded probes follow the transfer failure rule: one failure retries, 4 in a row end the run. With no sample yet at phase end, the engine waits for one (the probe in flight, or the retry after a failed one), never past the deadline and not after the probe loop has ended; a probe still pending then counts at its elapsed time, a lower bound. A retry sent after the transfers stopped sees a lighter load, so it is a lower bound too. Grade A–F on `max(loaded medians) − idle median`, strictly less than Waveform's thresholds: A < 30 ms, B < 60, C < 200, D < 400, F. Waveform's A+ folds into A. The source is an archived copy of Waveform's own script, cited in `latency.ts`; there is no official document.
- **Safety rails:**
  - **Data cap** (50 MB standard, 10 MB low-data, decimal MB): payload is reserved against 95% of it before each request and never refunded, so requested bytes can't pass it. The 5% covers unmeasured TLS/HTTP overhead (maintainer's decision). Download may reserve 2/3; upload gets the rest. `bytesUsed` counts payload only.
  - **Duration** (30 s / 15 s): each phase gets its fair share of the time left, every wait is clipped to the deadline, and phases stop 100 ms early so cleanup fits.
  - **Errors:** a 4xx ends the run at once (429 rate limit; 403 can block a whole network). Network errors and 5xx retry after 250 ms; 4 in a row end the run. No bytes for 6 s ends it (upload: no completed POST for max(6 s, 2 × the last POST)).
  - **Per-request inactivity:** the same limits apply to each request. A download with no byte for 6 s, or a POST with no reply within max(6 s, 2 × the last POST), is aborted and retried as a failure. Otherwise one stuck connection (loss recovery on HTTP/1.1, a dead CGNAT mapping) holds back the settled boundary: the reading and the ramp freeze while the other streams spend data unseen.
  - Every response body the engine doesn't stream is cancelled; otherwise HTTP/1.1 connections stay busy and later probes queue (fake bloat).
  - Options are validated: `maxBytes` ≥ 1 MB, `maxDurationMs` ≥ 10 s, both finite, else `RangeError`.
- **Tests:** `simulated-network.ts` is a fake `fetch` on Vitest's fake timers (which fake `performance` too). It shares link capacity between streams, charges an RTT on every request, can add jitter, bloat, server time, handshakes, failures, statuses, drops and stalls, and counts a request as open until its body is read or cancelled. Every engine test file calls `blockRealNetwork()`, which stubs the global `fetch` to throw, so no test can reach a real server. Every test was proven to fail against the bug it guards: 30 of 32 planted bugs were caught; the 2 survivors are redundant safeguards (the ramp gate on stability, and the loaded-probe cleanup on failure), which no behaviour can expose.
- **Verified 2026-11-01:** runs in headless Chromium 156 (simulated: 19.0 / 4.96 Mbps for a 20 / 5 Mbps line; and against real Cloudflare) and in Node 24 against real Cloudflare. The real readings matched an independent curl download.
- **Known limitations:**
  - Readings stabilise up to about 63 Mbps down / 32 up (standard) and 13 / 6 (low-data). Faster links end at the cap with the last window's estimate: within 15% at 40 Mbps low-data, about 11% low at 300 Mbps standard, and at 300 Mbps low-data about 32% low down and 66% low up (only 0.17 s and 0.085 s of data).
  - A stuck request freezes the settled boundary until its 6 s inactivity timeout aborts it; a short phase may end inside that window.
  - Browsers multiplex HTTP/2/3 streams over one connection, so parallel streams keep the pipe full but can't beat single-flow limits. Node's fetch uses separate HTTP/1.1 connections, so Node and browser runs differ.
  - On slow, high-latency lines (2G, 700 ms), upload reads about 20% low: each POST's reply round trip is counted and there's no time to add a stream. Uploads below about 45 kbps can't finish the first 32 KB POST within the 6 s stall timeout and end as `network-lost`.
  - `bytesUsed` is payload only; overhead isn't measured, so the 5% margin makes going over the cap unlikely, not impossible.
  - Server-time correction uses `Server-Timing` only, without Cloudflare's Resource-Timing calibration.
  - Background tabs are throttled (timers ≥ 1 s on the main thread, and a deprioritised renderer that reaches Workers too), so readings in a hidden tab can't be trusted. The web app stops the test when the page is hidden (see "Test UI").

## Test UI (`apps/web`)

- **Files:**
  - `app/page.tsx` (server shell) renders `components/speed-test.tsx`, the only client island, with `result-panel.tsx` and `low-data-switch.tsx`.
  - Logic lives in `lib/`: `verdicts.ts`, `format.ts`, `messages.ts`, `low-data.ts`, `run-in-worker.ts` and `speed-test.worker.ts`.
- **The engine runs in a dedicated Worker** (measured in Phase 2 planning on desktop Chromium, on a paced 20 / 5 Mbps local link):
  - Under heavy main-thread load (180 ms busy of every 200), a main-thread engine read idle latency 4× too high (200 ms against 50). The Worker read it exactly. A light 40% load hurt neither.
  - **Lifecycle:** one Worker per run. It is created on Start with `new Worker(new URL("./speed-test.worker.ts", import.meta.url), { type: "module" })` and terminated when the run ends, on Stop, on hide and on unmount. Termination also aborts its requests.
  - Turbopack builds it as a classic worker behind a `turbopack-worker-*.js` bootstrap, in both `next build` and `next dev`.
  - Worker files type-check against the DOM lib, so use only `postMessage`, `addEventListener` and `MessageEvent`.
  - The worker source is also copied to `static/media` but never requested.
- **Leaving the page stops the test** (maintainer's decision). Hidden tabs were unreliable in both modes: 3 of 7 runs were badly wrong each way (download up to 91% low, wrong grades). So `visibilitychange` → hidden cancels the run, shows why and how much data it used, and no tainted result exists.
- **Verdicts** (`lib/verdicts.ts`) use cited thresholds only; the sources and the quoted Waveform criteria are in the file header, retrieved 2026-11-01:
  - Netflix and YouTube for streaming levels (HD 3, Full HD 5, 4K 20 Mbps)
  - Google Meet / Zoom 720p for HD video calls (1.7 Mbps each way)
  - Waveform's script for browsing (2 / 0.1 Mbps, median ≤ 500 ms), voice calls (0.1 / 0.1, p95 ≤ 400 ms) and gaming (10 / 3 Mbps, p95 ≤ 40 ms)
  - Every latency rule is checked idle and under load (failing only under load = "bufferbloat"). Values exactly on a limit pass, as in Waveform's code.
  - Video calls and 4K use the apps' figures rather than Waveform's stricter generic ones (maintainer's choice); "How we judge this" says so.
- **Low-data mode:**
  - Saved in `localStorage` as `kilomita.lowData` (`on` / `off`). With nothing saved it follows Data Saver (`navigator.connection.saveData`).
  - If storage refuses a write, the choice holds until reload.
  - `useSyncExternalStore` renders "off" on the server.
- **Zero layout shift:**
  - Every box has a fixed size. Results are laid out invisibly from the first paint and revealed with opacity (`motion-safe:` only). Errors overlay the reserved panel.
  - Every result block is bounded by its longest content: stats are three fixed lines that never wrap, verdict rows are one line with a short reason (`too slow`, `latency too high`, `lags under load`), and the grade note (2 lines) and the low-data "ended early" note (3 lines) reserve room for their longest text at 320 px. A placeholder with short text therefore lays out exactly as tall as a grade F, capped result.
  - e2e guards it two ways: a worst-case run (grade F through the mock's `bloatMs`, the low-data cap note, the page scrolled to the bottom) at the Pixel 7, 320 px, 375 px and a tall 412×1150 window, asserting no layout shift; and a sweep that compares the panel's height for that result and for the placeholder at every width from 320 to 600 px in 4 px steps. Grade A text fits one line at 412 px and wraps at 320, so only widths in between (375) exposed a missing reservation.
  - **Wide-font pass:** a fixed box is only as safe as the widest font a visitor gets. Every layout test (at 320 px, the four worst-case runs, both height sweeps) also runs with Verdana or DejaVu Sans forced from the first paint; both are wider than Segoe UI and Roboto. A canvas measurement against two generic fallbacks fails the test if neither font is installed, so the pass can't quietly test the normal font (`document.fonts.check()` says true for a missing local font). Verdana is checked only on Windows runs: CI has no Verdana and uses DejaVu Sans, which is probably Ubuntu's `system-ui` fallback already, so there both passes may measure about the same font.
  - **Overflow check:** in every layout test and at every sweep width, no element in the result area may overflow its own box, sideways or downwards, or cross the area's edges. A fixed-height box hides wrapped or spilled text from a height check, so heights alone can't catch it. Selects (which clip long names on purpose) and sr-only text are skipped, and transforms are switched off while measuring, because hidden reveals sit 4 px lower (`translate-y-1`), which stretches `scrollHeight` without moving layout.
  - Chromium counts a centred text node that re-centres as a shift. So text that changes inside a fixed box (the big number, the status line, the button label, the cap hint) is keyed by its content, which renders a new node each time. The boxes never move.
- **After a result** (revealed with it, laid out invisibly from the first paint like the rest of the result area):
  - `network-details.tsx`: a note ("We think you're on MTN in Lagos. Not right? Correct it below.") and three native selects with explicit `htmlFor` labels (a select wrapped in its label takes the selected option into its accessible name). Detection fills only fields the user hasn't changed; corrections last for the session, not across reloads.
  - `consent-card.tsx`: see "Consent" below.
  - The note reserves 3 lines (Tizeti/Wifi.ng in the FCT at 320 px) and the hint 2 (the Wi-Fi hint). The e2e sweep compares the whole result area (`data-testid="result-area"`) for the placeholder, the longest content and each consent state at every width from 320 to 600 px, and checks that no consent button or status line spills out of the card (a fixed-height row hides spilled text from a height check).
- **Copy:** errors and the method text are in standard English. Pidgin is only in microcopy ("Tap Start. E no go long.", "Your net don finish test!").
- **Cloudflare** is still the endpoint (dev and manual use only, launch blocker below). The page never contacts it until a human presses Start: there is no preconnect.

## ISP and location detection (`apps/web/server`, Phase 3)

- **Flow:** after a run completes (never on load or during a measurement), the page calls `GET /api/network` once. The route reads the client IP, asks the IP provider, maps the ASN to an ISP and answers `{ isp, state }` with `Cache-Control: no-store`. It calls `await connection()`, so it stays request-time even if Cache Components is switched on. It never logs or returns the IP.
- **Server code** lives in `apps/web/server/` (Node runtime, may import shared's values): `client-ip.ts`, `ip-address.ts`, `ip-provider.ts`, `detect.ts`, `ip-hash.ts`, `network-route.ts`, plus Phase 4's sharing modules (see "Results API and storage").
- **Provider:** `IpProvider { id; lookup(ip, signal) }` returns `{ asn, countryCode, stateSlug }` or null. **No provider is chosen yet** (maintainer, 2026-11-02): `activeProvider` is `noneProvider`, so nothing is detected and users pick everything. Each future adapter maps its own region format to a state slug. Choosing one is a launch prerequisite. A third-party provider would see the IP on detection, before consent, so the privacy page must name it, or detection must wait for consent; a local file (MaxMind GeoLite2, downloaded at deploy time) avoids that. IPtoASN was considered and set aside: its site says "Public Domain (PDDL v1.0)" next to "API Source Code", so the data licence is unclear.
- **`detectNetwork`** never throws: no IP, no answer, a provider error or a 1.5 s timeout all mean nothing detected. An unknown ASN is `other`. The state is used only when the country is NG.
- **Client IP:** `CLIENT_IP_HEADER` names the one header the host sets. **Unset by default: no IP is read.** Next 16.4.3 fills `X-Forwarded-For` with the socket address only when it is absent (`base-server.js`, `??=`), so on a directly exposed server a client can forge it, and route handlers get no socket address. Single-value headers (`x-real-ip`, `cf-connecting-ip`, `fly-client-ip`) must hold exactly one value. For `x-forwarded-for` the rightmost entry is used, which is right only behind exactly one appending proxy; behind a CDN plus a load balancer, use the platform's single-value header. IPv4-mapped IPv6 becomes IPv4; ports, brackets and zone IDs are rejected. A configured name that isn't a valid header name (a typo such as `x real ip`) reads nothing instead of failing every request.
- **ASN table** (`packages/shared/asns.ts`, verified 2026-11-02): 14 ASNs for the 10 named ISPs, each with its exact RIPEstat holder string and as-overview URL. Discovery: RIPEstat's country-resource-list for NG (306 ASNs) matched on holder names, cross-checked by the reviewer (mita-fd), who swept all 306 independently. Unannounced ASNs (MTN 36933, Glo 328309, Spectranet 329051) stay in the table. Deliberately unmapped: AS329244 "Connect, Surf and Smile Limited", AS37127 Visafone, and transit networks. Starlink's AS14593 is global. To re-verify, fetch each `source` and compare `data.holder`. Unit tests use real addresses from announced prefixes (each checked with RIPEstat network-info).
- **IP hash** (`ip-hash.ts`, used by Phase 4 on submit): HMAC-SHA256 over the /24 (IPv4) or /48 (IPv6) prefix, keyed by a **random 32-byte salt per UTC day** from a `SaltStore` (`saltForToday()`, no day parameter, nothing derived). Once a day's salt is gone, its hashes can't be brute-forced back (only 2^24 IPv4 /24s exist) or linked across days. **Within a day the hash can identify a connection:** an IPv4 /24 is usually shared (CGNAT), but an IPv6 /48 can be a single home or office (RIPE-690 recommends a /48 per end user), so the privacy page says so and never claims the code "never identifies" anyone (e2e asserts both). `memorySaltStore` is for unit tests. Production uses `kvSaltStore` on Upstash: `SET salt:<day> NX PXAT <next UTC midnight>`, then `GET`, so every process agrees and Redis itself deletes the salt when the day ends (a 48 h TTL from creation would break the consent copy, "can't be traced back after a day"; a test asserts the expiry).
- **Network type:** a selector (default "Not sure" = `unknown`). `navigator.connection.type` (Chromium on Android and ChromeOS only) adds a hint ("Your device says Wi-Fi. If that's a MiFi or hotspot, pick its mobile type.") but never picks. `effectiveType` is never used: MDN says it comes from recent round-trip time and downlink, so it is a speed class, not the radio.

## Results API and storage (Phase 4)

- **Services** (maintainer, 2026-11-02): **Neon** Postgres and **Upstash** Redis, both in AWS eu-central-1 (Frankfurt), created by the maintainer. Nothing in CI or e2e reaches them.
- **Dependencies** (each pinned exactly, every release at least 7 days old): `drizzle-orm` 0.45.4 (Apache-2.0), `postgres` 3.4.9 (postgres.js, Unlicense; not the 4-day-old 4.0.0), `@upstash/redis` 1.40.0 (MIT; not the same-day 1.41.0); dev only: `drizzle-kit` 0.31.11 (MIT), `@electric-sql/pglite` 0.5.11 (Apache-2.0). 414 licences pass. All 5874 files of the new packages were scanned for the worm's markers (none), with a planted probe proving the loader regex matches.
- **Env** (server-only, all in `.env.example`; missing or malformed means sharing answers 503, never a crash):
  - `DATABASE_URL` (Neon pooled), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  - `RESULT_TOKEN_SECRET`: base64 of exactly 32 bytes from a CSPRNG (`bun -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`); `tokenKey` refuses anything else. Never `Get-Random`: it isn't cryptographically secure.
  - `KILOMITA_STORES=memory`: PGlite plus an in-process Redis twin, for dev and e2e. It logs a warning at start and answers `x-kilomita-stores: memory` on every sharing route; check it is unset in production.
  - `CLIENT_IP_HEADER`: without it there is no IP hash, and so no duplicate detection.
- **Files:**
  - `server/db/`: `schema.ts` (one `results` table), `migrations/` (drizzle-kit SQL, committed, no JS), `database.ts` (both drivers; the migrations folder resolves from `process.cwd()`, because compiled server code lives in `.next`), `migrate.ts` (`db:migrate`, `db:purge`)
  - `server/`: `kv.ts` (`Kv`, `upstashKv`, `memoryKv`), `token.ts`, `limits.ts`, `plausibility.ts`, `stats.ts`, `retention.ts`, `stores.ts` (lazy, one per process; nothing connects at import), `http.ts` (8 KB body cap, `guarded()` logs error codes only), the three `*-route.ts` handlers, `testing.ts` and `fixtures.ts` (tests only)
  - `app/api/`: `tokens`, `results`, `results/[id]`, `stats/[dimension]` (thin; `await connection()`; mutations `no-store`)
  - client: `lib/share.ts` (pure send decision, corrections, token reuse), `lib/sharing-api.ts`, `lib/shared-results.ts`, `lib/device-class.ts`, `components/delete-shared.tsx`
- **Tokens:** `POST /api/tokens` before every run (≤ 3 s; the page shows "Starting…" and the Worker starts only afterwards, so the request never overlaps a measurement). `v1.<payload>.<HMAC-SHA256>`, payload `{ jti, iat, low, ev }`, valid 30 min. Issuing stores nothing. A token is **consumed by the insert itself**: `results.token_hash` (SHA-256 of the jti) is UNIQUE. A retry with the same secret gets 200 and the same id; another secret gets 409. "Test again" reuses the previous token only if no POST carrying it was ever sent (a lost response can hide a consumed token), it has 5 minutes left and the same low-data mode.
- **Submit** (`POST /api/results { token, secret, result }`): verify the token → at most 5 attempts per token → zod → impossible values → hash the IP prefix → flag → insert. The browser writes `{ id: null, secret, at }` to `kilomita.shared` **before** the POST, fills the id on 2xx, drops the entry on a definitive refusal (4xx, 503) and keeps it after a network error or 5xx, where the row may exist; it retries an unanswered send once, with the same token and secret.
- **Two tiers of plausibility** (`server/plausibility.ts`):
  - Impossible → 422 with a reason: profile ≠ token, engine version ≠ token's `ev` (the server's version at issuance: a run that straddles a deploy still matches, but a tab loaded before an engine bump is refused until it reloads), unknown server, over the data cap or time limit, a run longer than its token has existed, idle p95 < median, any latency > 60 s or Mbps > 10,000, a grade the engine's own rule doesn't give.
  - Outside the simulated envelope → stored with `flag = 'implausible'`, left out of aggregates. The envelope (`packages/engine/envelope.ts`) comes from the real engine on simulated links from 2G to 1 Gbps, both profiles: the shortest genuine run took 522 ms, and the least data per claimed Mbps was 0.25 s worth (both at 1 Gbps, low-data). The floors are half of those (250 ms, 0.125 s); a test asserts every genuine run clears them twice over.
  - Duplicates: the same IP hash and identical download, upload, idle median and bytes within 24 h → `flag = 'duplicate'`. In practice that means the same UTC day as well: the salt, and so the hash, changes at midnight.
- **Corrections** (`PATCH /api/results/:id { secret, ispSlug?, stateSlug?, networkType? }`): the owner only, for 30 minutes, 20 per result; anything else is a 404. The page sends them 1 s after the selectors settle.
- **Delete** (`DELETE /api/results { secrets }`, at most 100): by the per-result secrets kept on the device, stored server-side only as SHA-256. One secret per result, so the server can't link one device's results to each other. `/privacy#delete` deletes in batches of 100, forgetting each batch once deleted. Clearing site data loses the secrets; the privacy page says so.
- **Rate limits** key on what a request proves it holds, never on the IP hash (CGNAT): attempts per token, corrections per owned result. Before a token exists there is nothing else to key on, so token issuance (1,200/min) and deletes (600/min) have only global ceilings (maintainer's choice, 2026-11-02).
- **Aggregates** (`GET /api/stats/{isp,state,network-type,hour,trend}`, optional `isp`, `state`, `type` filters; anything unknown is 400): `percentile_cont(0.5)` of download, upload and idle latency over 30 days of server time, without flagged rows; hours and days in Africa/Lagos. A group of fewer than 30 results is `{ key, enough: false }`, with no numbers and no count. `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`, plus a 60 s in-process memo. On-demand SQL; an aggregate table only if load demands it.
- **Retention** (`server/retention.ts`): results deleted after 12 months, IP hashes wiped after 48 hours. `purge()` runs from `after()` in the token route at most once an hour (a Redis lock), and from `db:migrate`; `/privacy` says "about 48 hours", because it runs only when someone asks for a token. The day's salt is gone at midnight anyway.
- **Load test** (`scripts/load-test.ts`, against `next start` in memory mode on this machine, 2026-11-02): 20 users × 20 rounds, 1,600 requests, 0 failures, p95 tokens 53 ms, submit 56, correction 78, stats 58; 50 users × 10 rounds, 2,000 requests, 0 failures, every p95 ≤ 127 ms. Uncached stats over ~900 rows answer in under 10 ms. Neon and Upstash add network round trips; that run is a manual step.

## Consent and privacy (NDPA)

- **Ask once, remember** (maintainer, 2026-11-02): after a finished test, the card asks to share; the choice is saved as `kilomita.consent` (`granted` / `declined`, else `unasked`) and stays changeable next to every result. No banner before a test. `lib/stored-choice.ts` holds the storage pattern shared with low-data mode.
- **`mayShare(consent)`** in `lib/consent.ts` is the gate every way a result leaves the device must pass (Phase 4's submit). Contract: granting shares the result on screen (once) and every later one; `unasked` and `declined` share nothing; revoking stops future sharing, and removing shared results is the delete path. `lib/share.ts` (`shareStep`) applies it: a result is sent once `mayShare` holds, a network is chosen and a token is in hand, at most once per result; what already happened to a result stays shown whatever consent becomes. e2e asserts zero `/api/results` requests without consent, exactly one POST when sharing, and the localStorage keys (`lowData`, `consent`, plus `shared` only after sharing).
- **Double-press safety:** after a click, focus moves to the status text (`tabIndex={-1}`, `aria-live="polite"`), never to the next button, and clicks within 600 ms of a change are ignored, so a double tap or a held Enter can't grant and then revoke. The status uses `aria-live`, not `role="status"`, so the page keeps one status role.
- **`/privacy`** (static, plus the `components/delete-shared.tsx` island) describes this version: the test server and our server see the IP; no lookup provider yet; nothing is stored unless the user shares; the on-device choices and secrets; the one-time test pass; what sharing keeps (the fields, Neon and Upstash in AWS Frankfurt, so results leave Nigeria); the IP hash only when the host's header is configured, wiped after about 48 hours, with the /48 disclosure; 12-month retention; publishing only groups of at least 30; stopping and deleting (`#delete`). e2e keeps asserting it never claims the code "never identifies" anyone. Contact is GitHub private vulnerability reporting.

## FOSS and licensing

- **License:** AGPL-3.0-only (`LICENSE`), and every `package.json` says so. All packages are `"private": true`, so nothing is published to npm.
- **AGPL §13:** the footer links to `SOURCE_URL` (`https://github.com/kleenpulse/kilomita`). Keep the source link visible on every deployed page.
- **Contact:** GitHub private vulnerability reporting only, for both security issues and Code of Conduct reports. No email address is published.
- **DCO:** the CI `dco` job requires `Signed-off-by` on every non-merge PR commit. Sign-off certifies a human's rights to the code, so **an agent adds `Signed-off-by` only when the maintainer explicitly says so for that commit** ("sign off as me"). Otherwise the human submitting signs off.
- **Licence check:** `bun run licenses` walks `node_modules/.bun/<entry>/node_modules/<name>/package.json` plus the workspaces, parses SPDX expressions (AND/OR/WITH, parentheses), and fails on a missing licence field. Data exception: `caniuse-lite` (CC-BY-4.0). Optional platform packages differ between Windows and Linux, so the CI (Linux) run is authoritative.
- **Launch blocker: Cloudflare's speed test endpoints.** No Cloudflare document grants or forbids third-party use of `speed.cloudflare.com/__down` and `/__up`. Checked 2026-11-01:
  - against: the general website terms ("may not … overburden", "may not exceed or circumvent … limitations … including on any API calls"), and `robots.txt` disallows both paths
  - for: a Cloudflare contributor said the client can target other endpoints (cloudflare/speedtest#13), and the 2025 blog says "anyone can use our speed test to facilitate their own research"
  - **Maintainer's decision:** the adapter is for development and manual testing only. Never call it from CI or automation. Before any public deploy, get Cloudflare's written OK or switch to self-hosted servers (Phase 6).
- **Future constraints:**
  - MaxMind GeoLite2 data may not be redistributed, so never commit it. If it's chosen in Phase 3, download it at deploy time with the operator's own licence key.
  - The privacy page says that the test contacts the test server (Cloudflare for now), which sees the user's IP address, and that Cloudflare's responses echo the IP and location in `cf-meta-*` headers, which the engine never reads. Keep it true as Phases 5–7 change what is stored.
- **Open legal question (maintainer's):** shared results go to Neon and Upstash in Frankfurt, outside Nigeria. The privacy page discloses it and sharing is opt-in; whether the NDPA's cross-border transfer rules need more than informed consent has not been assessed here.

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

## Phase 1 summary

- **Built:**
  - `@kilomita/engine` 0.1.0: event API, latency/jitter/loss, adaptive multi-stream download and upload, loaded latency with an A–F grade, hard data and time rails, network-loss and endpoint errors (see "Measurement engine")
  - `TestEndpoint` and the Cloudflare adapter (dev/test only, launch blocker above)
  - a deterministic simulated network and 117 engine tests, with a 90% coverage gate on the throughput math
  - engine guards: WebWorker lib, `AbortSignal.timeout`/`any` bans, type-only imports from shared; `isomorphic.test.ts` covers them
- **Known limitations:** see "Measurement engine". No UI uses the engine yet (Phase 2).
- **Manual steps for the maintainer:**
  1. Review the diff, then run `bun install --frozen-lockfile`, then `bun run test` (two commands: Windows PowerShell 5.1 has no `&&`). The engine prints its coverage table. Run `bun run test --force` to bypass the cache.
  2. Optional real-network check, dev use only (≤ 10 MB). Switch WARP or any VPN off for realistic numbers; through WARP, this machine reaches Cloudflare's London edge. Outer double quotes and inner single quotes work in both PowerShell 5.1 (which strips double quotes nested in single quotes when calling programs) and bash:
     `bun -e "import { createSpeedTest, cloudflareEndpoint } from './packages/engine/index.ts'; const t = createSpeedTest({ endpoint: cloudflareEndpoint, lowData: true }); t.on('progress', (e) => console.log(e.phase, e.currentMbps?.toFixed(2) ?? '-', e.latencyMs?.toFixed(0) ?? '-', e.bytesUsed)); console.log(JSON.stringify(await t.start(), null, 2));"`
  3. ~~approve the commit and push, and the DCO sign-off~~ done: approved and signed off by the maintainer on 2026-11-01
  4. Decide whether to ask Cloudflare for written permission now or wait for Phase 6 servers.

## Phase 2 summary

- **Built:**
  - the test screen: one live download number, Start/Stop, a progressive reveal of upload, latency, jitter, the bufferbloat grade and data used, cited plain-language verdicts, a saved low-data switch, dark mode following the system, and an app icon
  - the engine in a Worker; leaving the page stops the test
  - engine 0.2.0: `loadedP95Ms`, the `./limits` subpath, and a warm-up fix (a probe cut short by the 6 s window no longer hides the server's own 4xx/5xx; it was reported as "connection dropped")
  - web unit tests (46), e2e on a paced mock behind a DNS fence (17), and a lint rule that keeps engine and shared values out of client code
  - DCO wording: an agent signs off only on the maintainer's explicit word for that commit
- **Verified 2026-11-01:**
  - every gate from a cold cache, and e2e in CI mode (`next start`) and local mode (`next dev`)
  - Lighthouse 13.5.0 mobile (5 runs): performance 96–97 (median 96), accessibility 100, best practices 100, SEO 100, CLS 0. The Phase 0 page measures performance 95 the same way.
  - 20 of 21 planted bugs were caught by their tests or the lint rule. The survivor is `TEST_LIMITS` imported through the engine's index, checked by the bundle grep alone: Turbopack tree-shakes the engine out of `/` anyway, so the grep has nothing to catch. The lint rule catches the same import.
- **Known limitations:**
  - The Worker and hidden-tab evidence is desktop Chromium on one machine, with 3–8 runs per case. Android and iOS were not measured.
  - Switching apps mid-test (e.g. to answer WhatsApp) stops the run; the data it used is shown, and it must be started again.
  - Verdicts compare against the test server (Cloudflare's edge), not the apps' own servers. The gaming rule (Waveform: p95 ≤ 40 ms) is strict, and many mobile lines fail it.
  - The e2e mock delivers each body in one burst, so the e2e checks the flow and wiring, not accuracy (that is the engine's simulated-network tests). With 450 ms of bloat the mock even reads 2.8 Mbps on a 60 Mbps link, while a byte-paced local link with the same bloat reads about 51 Mbps (low-data cap).
  - Fixed heights are tuned to this machine's system font (Segoe UI) in Chromium. A wider fallback font on another platform could wrap a reserved line. This happened: Phase 3's first CI run failed on Linux. Since the Phase 3 hotfix, every e2e run also checks the layout in a forced wide font (Verdana or DejaVu Sans), and CI checks it in Linux's own font. Roboto on a real Android device and iOS's fonts are still unmeasured.
  - Zero layout shift is asserted in Chromium only.
  - The launch blocker stands: the UI still uses Cloudflare's endpoints, for development only.
- **Manual steps for the maintainer:**
  1. Review the diff. Then run `bun install --frozen-lockfile`, then `bun run test`, then `bun run test:e2e` (separate commands for PowerShell 5.1). The first e2e run needs `bun --filter @kilomita/web playwright:install`.
  2. Run `bun run dev` and open http://localhost:3000 (or set `$env:PORT=3931` first if 3000 is busy). Check light and dark mode, a narrow window, Tab/Enter on Start, and the low-data switch surviving a reload. Switch to another tab mid-test: it stops and says why.
  3. Optional real run, dev use only: switch WARP or any VPN off, turn on low-data mode (≤ 10 MB), press Start. Through WARP this machine reaches Cloudflare in London, so numbers are plumbing checks, not Nigerian speeds.
  4. ~~approve the commit and push, and the sign-off~~ done: `a7e2dae`, signed off by the maintainer on 2026-11-01

## Phase 3 summary

- **Built:**
  - `GET /api/network`: IP → ASN → ISP and state, behind a pluggable `IpProvider`; the production provider is `none` until one is chosen. The client-IP header is opt-in (`CLIENT_IP_HEADER`) and trusts nothing by default.
  - `packages/shared/asns.ts`: 14 ASNs for the 10 named ISPs, each with its RIPEstat holder and source link; the `@kilomita/shared/lists` zod-free subpath; `NETWORK_TYPES`; FibreOne renamed to FiberOne.
  - "Your network" after a result: the detected ISP and state with "Not right? Correct it below.", three selectors, and a connection hint from `navigator.connection.type`
  - consent: ask once, remember, change any time; the `mayShare` gate for Phase 4; nothing is sent in Phase 3
  - the hashed IP prefix with a random, daily, never-derived salt (`SaltStore`), ready for Phase 4
  - `/privacy` for this version, linked from the footer and the consent card
  - tests: shared 28 (was 20), web 122 (was 46), scripts 55 (was 50), engine 122; e2e 32 (was 17; 25 before the hotfix)
- **Verified 2026-11-02:**
  - every gate from a cold cache (15 of 15 turbo tasks), tripwire, licences and format; e2e in CI mode (`next start`) and local mode (`next dev`) through turbo, **on Windows only**. The first CI run on `876b9ad` (Linux, run 41466044659) failed e2e: at 320 px the consent status "Nothing is shared until you choose." spilled out of its one-line row in Ubuntu's wider fallback font. The hotfix commit after it fixes that: the status box reserves 2 lines, the stat label "Latency under load" became "Loaded latency" (in Verdana it was 7 px too wide for its column at 320 px), and the wide-font pass and overflow check were added (see "Zero layout shift"); e2e went from 25 to 32 tests.
  - a clean clone exported through a throwaway index (the real index hash unchanged): frozen install, every gate, e2e (25 of 25, CI mode), and dev → 200 on `/`, `/privacy` and `/api/network`
  - 30 of 30 planted bugs caught (28, plus 2 for the checkpoint-1 fixes: the privacy page claiming the code never identifies anyone, and an invalid header name throwing). Six were re-run to confirm each failed on its own assertion, not on a build error.
  - zero layout shift: the worst-case runs (Pixel 7, 320, 375, 412×1150) now include the longest network note and hint; the 320–600 px sweep covers the placeholder, the longest content and every consent state, and checks that no consent button or status spills out of its card
  - bundle: 140.9 KiB in 7 chunks (Phase 2: 138.0 in 6). No engine, zod, ASN-table or `node:crypto` strings in the initial chunks.
  - Lighthouse 13.5.0 mobile, 5 runs: performance 92–96 (median 95), accessibility, best practices and SEO 100, CLS 0. Interleaved with Phase 2's build on the same machine: medians 92 (Phase 3) and 91 (Phase 2), so the difference is noise.
  - every fixture IP in the detection tests and the WARP prefix (`2a09:bac5::/32` → AS13335) were checked with RIPEstat network-info
- **Known limitations:**
  - No IP provider: real visitors get no detection and pick everything by hand. Choosing one is a launch prerequisite, alongside the Cloudflare blocker. A third-party provider would see the IP before consent (see "ISP and location detection").
  - `CLIENT_IP_HEADER` must match the host; set wrong, the IP can be forged (Phase 3: only the user's own prefill; Phase 4: the anti-abuse hash). `x-forwarded-for` is right only behind exactly one proxy.
  - CGNAT, VPNs (this machine egresses through WARP, which maps to Other) and roaming cause misdetection; that is what the selectors are for. The ASN table covers Nigerian-registered ASNs held by the ISPs themselves.
  - The connection hint exists only in Chromium on Android and ChromeOS. Corrections aren't remembered across reloads.
  - `memorySaltStore` loses the day's salt on a restart and is per process. Phase 4 needs a shared store that expires at the next UTC midnight.
  - Consent granted in Phase 3 sends nothing. The privacy page describes this version only; the full policy, retention and the delete path are Phases 4 and 7.
  - A tap on Start before the page's JavaScript has loaded does nothing (Phase 2 behaves the same); a tap from the moment it loads starts exactly one run (checked at 0–400 ms).
  - Local-mode e2e (`next dev`, 6 workers) is load-sensitive on this machine. Phase 2's own tree failed 2 of 3 local runs here (timing-dependent grades). Phase 3 also showed a rare, unexplained silent "Test stopped." in that mode (compiling routes mid-run and tapping during hydration were both ruled out). The unmount cleanup now stops the run with its own reason (`unmount`), which never reaches the screen, so if a dev-mode remount was the cause, the next repeat shows a run stuck as running instead (reviewer's lead). CI mode passed 7 of 8 full runs outright; one run had 3 tests pass only on retry, and its log was not kept.
- **Manual steps for the maintainer:**
  1. Review the diff. Then run `bun install --frozen-lockfile`, then `bun run test`, then `bun run test:e2e` (separate commands for PowerShell 5.1).
  2. Run `bun run dev` and open http://localhost:3000. Finish a test (low-data mode is enough). Check "Your network": the note asks you to choose (no provider yet), the three selectors work, and a narrow window keeps them on screen. Press Share, reload, finish another test: it still says you're sharing. Press Stop sharing. Open the Privacy link from the footer and from the card.
  3. Check the route: `Invoke-RestMethod http://localhost:3000/api/network` should return `isp` and `state` both empty.
  4. When convenient: choose an IP data provider (a launch prerequisite), and decide whether to ask Cloudflare for written permission or wait for the Phase 6 servers.
  5. Approve the commit and push, and say whether to sign off as you.

## Phase 4 summary

- **Built:**
  - Sharing for people who opt in: one-time signed test tokens fetched before each run ("Starting…"), `POST /api/results` gated by `mayShare` and a chosen network, corrections for 30 minutes, and deletion from `/privacy#delete` by secrets kept on the device. Every rule is in "Results API and storage".
  - Neon Postgres via Drizzle (one `results` table, a committed SQL migration), Upstash Redis for the daily salt (expires at the next UTC midnight) and fixed-window counters, and memory stores (PGlite) for dev and e2e.
  - Anti-abuse: the insert consumes the token; limits key on the token or an owned result, never the IP hash; impossible values get 422; unusual ones and same-day replays are stored flagged and never aggregated.
  - `GET /api/stats/*`: 30-day medians per ISP, state, network type, Lagos hour and day, with nothing published for groups under 30.
  - Retention: 12 months, the IP hash about 48 hours.
  - `/privacy` rewritten for storage. Engine 0.3.0 (`grade.ts`, `envelope.ts` on `./limits`). `bunfig.toml` refuses releases younger than 7 days. A Bun load-test script.
  - Tests: shared 32 (was 28), engine 144 (was 122), web 203 (was 122), scripts 56 (was 55); e2e 43 (was 32).
- **Verified 2026-11-02 (Windows):**
  - every gate from a cold cache (15 of 15 turbo tasks), tripwire, 414 licences, format; e2e 42 of 42 in CI mode (`next start`) and in local mode (`next dev`), the final runs with no retries
  - a clean clone through a throwaway index (real index unchanged): frozen install, every gate, e2e 42 of 42 (CI mode), and `next dev` → 200 on `/`, `/privacy`, `/api/stats/isp`, `/api/network`, plus a token
  - 41 of 41 planted bugs caught, each failing on its own assertion (E08, added at checkpoint 1, puts back the stale-answer guard mita-fd found). Two honest notes: S23 (IP hash kept 72 h) first survived, because the retention test computed its times from the constant under test; the test now pins 48 hours and 12 months in their own numbers, and S23 and S26 are caught. E01–E04 first "failed" through a `next dev` reload loop rather than their bugs; re-run against fresh production builds, each failed on its own assertion.
  - zero layout shift: the 320–600 px sweep and the wide-font pass cover every share status ("Pick your network above…", "Sharing isn't available…", "Couldn't share…", "Shared. Thank you!"), and the `/privacy` delete flow asserts no shift
  - bundle `/` 143.5 KiB (Phase 3: 140.9), `/privacy` 138.3 (135.6), measured against a `d950f20` build the same way; no server strings in client chunks
  - Lighthouse 13.5.0 mobile, 5 runs interleaved with Phase 3's build: performance 91–96 (median 96; Phase 3 87–96, median 94), accessibility, best practices and SEO 100, CLS 0; `/privacy` 97/100/100/100
  - load test: see "Results API and storage"
  - the five new packages and their dependencies scanned for the worm's markers (none); `drizzle-kit generate` works with every esbuild postinstall blocked
- **Known limitations:**
  - **Never run against the real services.** CI and e2e use memory mode; the postgres.js and Upstash paths are covered by types, the mocked `upstashKv` commands and the maintainer's manual run.
  - Launch blockers still stand: Cloudflare's endpoints, no IP provider, no deploy target. `CLIENT_IP_HEADER` must match the host, or there is no IP hash and no duplicate detection.
  - The NDPA cross-border question (results stored in Frankfurt) is open.
  - Token issuance (1,200/min) and deletes (600/min) have only global ceilings: one client can switch sharing off for everyone until the minute ends. Tests still run.
  - Retention runs only when someone asks for a token, so on an idle site deletion lags.
  - The plausibility envelope comes from simulated links; flagged rows are kept so it can be tuned on real data. Duplicate detection needs exact equality, so a slightly edited replay passes.
  - Deleting needs the secrets in this browser; cleared site data means waiting for the 12-month expiry. A below-threshold stats cell still shows that some result exists for that combination (no numbers, no count).
  - Corrections work only while the result is on screen, for 30 minutes.
  - A tab loaded before a deploy that bumps the engine can't share until it reloads: its next token carries the new engine version, so its result gets 422 `engine-mismatch` and the card says "Couldn't share this result." (refusing a stale engine's numbers is deliberate; a "Reload to share" message is the maintainer's call).
  - Two costs have no ceiling: a stranger's PATCH to an unknown id costs one indexed SELECT before its 404, and the stats memo allows about 20,500 valid filter combinations, each one uncached query a minute. A global PATCH ceiling would let one client block corrections for everyone, as with deletes (maintainer's call).
  - e2e: the first CI-mode run had 6 tests pass only on retry, because cold PGlite requests outlasted the 3 s token timeout; fixed by readiness on `/api/stats/isp`. One later CI-mode run had the known timing-dependent grade flake (grade D instead of F). Mutated sources under `next dev` caused a reload loop that is not understood.
  - The clean clone counts 413 licences, the long-lived worktree 414: one package more in the old `node_modules`. CI (Linux) is authoritative.
- **Manual steps for the maintainer** (Windows PowerShell 5.1, one command per line):
  1. Review the diff. Then run `bun install --frozen-lockfile`, then `bun run test`, then `bun run test:e2e`.
  2. Try sharing without any service: `$env:KILOMITA_STORES = 'memory'`, then `$env:RESULT_TOKEN_SECRET = (bun -e "console.log(require('crypto').randomBytes(32).toString('base64'))")`, then `bun run dev`. Finish a low-data test, press Share, pick a network: "Shared. Thank you!". Change the state (one correction). Open "How we handle data, or delete it" and delete. Afterwards: `Remove-Item Env:KILOMITA_STORES`, then `Remove-Item Env:RESULT_TOKEN_SECRET`.
  3. Real services: create a Neon project and an Upstash Redis database, both in AWS eu-central-1 (Frankfurt). Put `DATABASE_URL` (pooled), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and a new `RESULT_TOKEN_SECRET` in `apps/web/.env.local` (git-ignored; leave `KILOMITA_STORES` unset). Run `bun --filter @kilomita/web db:migrate`, then `bun run dev`. Share a result and check it in the Neon SQL editor: `select isp_slug, state_slug, network_type, ip_hash, flag from results;` (`ip_hash` is empty without `CLIENT_IP_HEADER`). Delete it from `/privacy` and check that the table is empty. Optional: `bun run load-test -- --url http://localhost:3000 --users 5 --rounds 5`.
  4. When convenient, decide: the deploy target and its `CLIENT_IP_HEADER`, the NDPA cross-border question, an IP provider, and Cloudflare's permission or the Phase 6 servers.
  5. Approve the commit and its push through a draft PR (Linux CI first, then `main`), and say whether to sign off as you.
