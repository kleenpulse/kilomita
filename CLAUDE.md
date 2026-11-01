# KiloMita: agent and maintainer guide

KiloMita ("How far your network speed?") is a fast.com-style internet speed test for Nigerian users, with an aggregated, anonymised per-ISP/per-state dashboard. The full requirements are in `mita-frd.md`. That file calls the app "Mita" in its brand section and "NaijaSpeed" in one other place. On 2026-11-01 the maintainer renamed the product to **KiloMita**, with package scope `@kilomita/*`. The FRD is left as written, so read its "Mita" as KiloMita. The display name lives only in `packages/shared/brand.ts`.

## Phase status

| Phase | Scope                                              | Status             |
| ----- | -------------------------------------------------- | ------------------ |
| 0     | Foundation: monorepo, tooling, CI, shared schemas  | **Done** (295d397) |
| 1     | Measurement engine (`packages/engine`)             | **Done** (e7d504f) |
| 2     | Test UI (`apps/web`)                               | **Done**           |
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
bun run test                             # turbo: Vitest in shared, engine (+ coverage gate), web, scripts
bun --filter @kilomita/web playwright:install && bun run test:e2e   # turbo, builds first
bun run licenses                         # dependency licence check
bun run tripwire                         # malware-marker scan (exit 0 clean, 1 found, 2 scan error)
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
    1. **Compile time (primary):** the package `tsconfig.json` sets `types: []` and excludes `eslint.config.ts`, so any Node API (`process`, `globalThis.Buffer`, `node:*` imports) fails `tsc`. Shared compiles against `ES2023` only. The engine adds the **WebWorker** lib (maintainer's choice, 2026-11-01): fetch, streams, abort and timers type-check, but `document`, `window` and `localStorage` don't, so the engine stays runnable in a Web Worker. TypeScript 6 already defaults `types` to `[]` (verified: without it, `tsc --listFiles` includes no `@types/node`), but it stays explicit so the guard doesn't hang on a default; the real risk is adding `"node"` to it. `eslint.config.ts` is type-checked separately by `tsconfig.config.json` (with Node types) as the second step of `typecheck`, and linted without type information.
    2. **Lint (backstop, clearer messages):** bans Node built-in imports, Node-only globals, and the same names reached through `globalThis`, `window` or `self`. The engine adds, through the preset's `extra` option: a React/Next import ban; bans on `AbortSignal.timeout` (runs on real time, so fake-timer tests can't drive it) and `AbortSignal.any` (Chrome 116 / Safari 17.4, above Next 16's Chrome/Edge/Firefox 111, Safari 16.4 baseline); and in non-test files, type-only imports from `@kilomita/shared` (`@typescript-eslint/no-restricted-imports` with `allowTypeImports`, plus `no-import-type-side-effects`, because `import { type X }` still compiles to a module-loading `import {}`). Extra `no-restricted-properties` entries must go through the preset: redefining the rule in a package config would replace the Node bans.
    - `scripts/isomorphic.test.ts` probes both guards against the real shared and engine configs, plus the engine's DOM ban and its lint rules. It must keep failing if any guard regresses.
  - `next` (web): `eslint-config-next/core-web-vitals`, with `settings.next.rootDir` set to the package.
  - `jiti` lets ESLint load TS configs on Node.
- **TypeScript:** each workspace's `tsconfig.json` extends `@kilomita/typescript-config/base.json` or `nextjs.json` and every `.ts` file in the package is type-checked: by `tsconfig.json`, or for shared and engine's `eslint.config.ts`, by `tsconfig.config.json`. There is no root tsconfig, because there are no root TS files.
- **PostCSS config is JSON** (`apps/web/postcss.config.json`). There are no JS config files, and a data-only file cannot hide injected code.
- **`.gitattributes` forces LF.** The maintainer's system git has `core.autocrlf=true`, which would otherwise break `prettier --check` on Windows checkouts.
- **Vitest** runs per workspace with defaults (shared, engine, web and scripts have a `test` script). The only config file is `apps/web/vitest.config.ts`: it excludes `e2e/**`, because Playwright's `test()` throws under Vitest. Web unit tests run in the node environment (no jsdom); browser behaviour is covered by e2e.
  - **Engine coverage gate:** `@vitest/coverage-v8` (maintainer-approved 2026-11-01, engine devDependency only). The engine's `test` script passes the options as CLI flags (still no config file): v8, text report, `stats.ts` + `throughput.ts` + `transfer.ts`, 90% lines, branches and functions. Below that, `test` fails.
- **Playwright** runs `bun run dev` locally (reusing a running server) and `bun run start` after the build in CI.
  - **No Cloudflare traffic from e2e, by three layers:** `e2e/mock-endpoint.ts` answers `https://speed.cloudflare.com/**` through `context.route` (which also catches dedicated Worker requests, verified with Playwright 1.64); `playwright.config.ts` launches Chromium with `--host-resolver-rules=MAP speed.cloudflare.com ~NOTFOUND`, so an unrouted request fails DNS (proven on localhost, never against Cloudflare); and every full-run test asserts issued = routed > 0.
  - The mock is a processor-shared link (in-flight transfers split the capacity, like TCP flows). `route.fulfill` delivers a body in one burst, so readings are only roughly the mock's rates and the e2e bounds are loose. Every answer must come within 5 s (asserted); the engine aborts a request silent for 6 s.
  - Playwright can't make a tab `hidden` (all methods tried, headless and headed), so the stop-on-hide test overrides `document.visibilityState` and dispatches `visibilitychange`.
  - Layout shift is a test: an init script records every `layout-shift` entry, including those right after input, and full-run tests assert there are none. Next's dev route announcer also has `role="alert"`, so tests look for alerts inside `<main>`.
- **`apps/web/AGENTS.md` is generated by `next dev`** (Next 16.4 `agentRules`), and `next dev` re-creates it if it's deleted. It is committed as-is. It points agents to the version-matched docs in `apps/web/node_modules/next/dist/docs/`, so read those before writing Next.js code. Next 16 differs from older training data.
- **Bundle:** measured by gzipping (level 9) each JS chunk that the prerendered `.next/server/app/index.html` references. Phase 0 (`e7d504f`, same method): 132.0 KiB, 5 chunks, all Next 16 + React 19 runtime (Phase 0 originally reported 131.5 with other gzip settings). Phase 2: 138.0 KiB, 6 chunks (+6.0 KiB, the UI); the Worker's engine chunk (5.7 KiB) loads only on Start. Legacy browsers also fetch a 38.6 KiB `noModule` polyfill. The engine is not in the initial chunks: it loads with the Worker when Start is pressed. Keep it that way: the main thread imports only types and `@kilomita/engine/limits` (the engine has no `sideEffects` declaration, so importing its index would likely pull it all in).

## Measurement engine (`packages/engine`)

- **API:** `createSpeedTest({ endpoint, lowData?, maxBytes?, maxDurationMs?, fetch? })` returns `{ start, cancel, on }`.
  - `start()` resolves to `{ status: "complete", result }` or `{ status: "error", error }` and never rejects. A second call returns the same promise.
  - Exactly one terminal event per instance: `complete`, or `error` with code `cancelled`, `network-lost` or `endpoint-error`. `cancel()` before `start()` is the outcome; after the end it does nothing.
  - `progress` comes per latency probe and every 250 ms tick, with `bytesUsed` for the live data counter. Events are plain objects (structured-cloneable), so the engine can run in a Web Worker.
  - The result is the measurement part of `SpeedTestResult`, plus `addedLatencyMs` (the graded delta), `loadedP95Ms` (95th-percentile latency under load per direction, from the same post-warm-up probes as the loaded medians; added in 0.2.0 for the verdicts) and `stoppedBy` (`stable`, `time` or `data-cap` per direction).
  - `@kilomita/engine/limits` exports `TEST_LIMITS` (frozen caps and durations per profile) and imports only `profiles.ts`, so a page can show the caps without bundling the engine.
  - A caller's `fetch` is always called as a plain function: a native fetch called as a method throws "Illegal invocation" in browsers (Node doesn't care, so only a test with a `this`-checking fetch catches it).
- **Files:** `engine.ts` (orchestration, deadlines, events), `latency.ts` (probes, warm-up, loaded probes, grade), `transfer.ts` (streams, ramp, sizing, budget, stall), `throughput.ts` (segment meter, warm-up end, estimate, stability), `stats.ts`, `profiles.ts`, `endpoint.ts` (`TestEndpoint`), `cloudflare.ts` (the only file that knows Cloudflare), `runtime.ts` (run context, failures, timers), `types.ts`. `simulated-network.ts` is a test helper and isn't exported.
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
  - Chromium counts a centred text node that re-centres as a shift. So text that changes inside a fixed box (the big number, the status line, the button label, the cap hint) is keyed by its content, which renders a new node each time. The boxes never move.
- **Copy:** errors and the method text are in standard English. Pidgin is only in microcopy ("Tap Start. E no go long.", "Your net don finish test!").
- **Cloudflare** is still the endpoint (dev and manual use only, launch blocker below). The page never contacts it until a human presses Start: there is no preconnect.

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
  - The privacy page (Phase 3/7) must say that the test contacts the test server (Cloudflare for now), which sees the user's IP address. Cloudflare's responses also echo the IP and location in `cf-meta-*` headers; the engine never reads them.

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
  - Fixed heights are tuned to this machine's system font (Segoe UI) in Chromium. A wider fallback font on another platform could wrap a reserved line.
  - Zero layout shift is asserted in Chromium only.
  - The launch blocker stands: the UI still uses Cloudflare's endpoints, for development only.
- **Manual steps for the maintainer:**
  1. Review the diff. Then run `bun install --frozen-lockfile`, then `bun run test`, then `bun run test:e2e` (separate commands for PowerShell 5.1). The first e2e run needs `bun --filter @kilomita/web playwright:install`.
  2. Run `bun run dev` and open http://localhost:3000 (or set `$env:PORT=3931` first if 3000 is busy). Check light and dark mode, a narrow window, Tab/Enter on Start, and the low-data switch surviving a reload. Switch to another tab mid-test: it stops and says why.
  3. Optional real run, dev use only: switch WARP or any VPN off, turn on low-data mode (≤ 10 MB), press Start. Through WARP this machine reaches Cloudflare in London, so numbers are plumbing checks, not Nigerian speeds.
  4. Approve the commit and push, and say whether to sign off as you.
