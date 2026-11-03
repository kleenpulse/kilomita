# KiloMita

**How far your network speed?**

KiloMita is a light, honest internet speed test built for Nigeria. One tap shows your real download and upload speed, latency and bufferbloat, plain-language verdicts (is it good enough for HD video, calls, gaming?), and exactly how much data the test used. People who choose to share their results build a public picture of which networks actually perform best in each state.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

> **Status:** the speed test, sharing, the public dashboard, KiloMita's own test server, share cards and the installable app are built (phases 0–6). It is not deployed yet: a Lagos test server still has to be set up. See [CLAUDE.md](CLAUDE.md) for the phase plan and the open launch items.

## What it does

- **The test:** a live download reading, then upload, idle and loaded latency, jitter and an A–F bufferbloat grade. A hard data cap (50 MB, or 10 MB in low-data mode) and a time limit (30 s / 15 s). The engine runs in a Web Worker so a busy page can't skew the timing.
- **Its own test servers:** a small [Fastify](https://fastify.dev) server ([apps/server](apps/server)) that the test picks by lowest latency. Every request needs a short-lived ticket, and a monthly and daily data budget stops it before a hosting plan's throttle could distort readings. A Docker and Caddy setup plus a [Lagos deployment guide](apps/server/deploy/DEPLOY.md) come with it.
- **Network and place:** pick your network, state and connection type after a test. Detection by IP address is pluggable, but no lookup service is connected yet.
- **Sharing (opt-in):** results are stored only if you say yes, with no IP address (only a scrambled code of part of it, wiped after about 48 hours), and you can delete them from the privacy page.
- **The dashboard:** `/isps` and `/states` rank providers from shared results. Groups under 30 results show no numbers, and every number is rounded and shown with a range.
- **Share cards:** a link that carries your result, with a preview picture for WhatsApp and X. Nothing is stored for it.
- **Installable:** add it to your home screen; the installed app opens offline and says clearly that the test needs a connection.

## Requirements

- [Bun](https://bun.com) 1.4.4 (package manager and script runner)
- [Node.js](https://nodejs.org) 20.9 or newer, 24 for the test server (Next.js, TypeScript, ESLint, Vitest, Playwright and the test server run on Node). The repo pins 24 in `.node-version`.

## Getting started

```sh
bun install
bun run dev          # the web app on http://localhost:3000
```

In development the test falls back to Cloudflare's public speed test servers, for manual testing only. To test against KiloMita's own server instead, make a secret and start the server next to the web app:

```sh
# one secret, shared by both (base64 of 32 random bytes)
bun -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# terminal 1: the test server on http://127.0.0.1:3940
KILOMITA_SERVER_ORIGINS=http://localhost:3000 KILOMITA_SERVER_TICKET_SECRET=<secret> bun run dev:server

# terminal 2: the web app, told about it
KILOMITA_TEST_SERVERS=local=http://127.0.0.1:3940 KILOMITA_SERVER_TICKET_SECRET=<secret> bun run dev
```

Sharing and the dashboard work without any service: set `KILOMITA_STORES=memory` (and `KILOMITA_SEED=demo` for sample data) plus a `RESULT_TOKEN_SECRET`. Every setting is explained in [.env.example](.env.example).

## Commands

| Command              | What it does                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `bun run dev`        | Start the web app in development mode                                                         |
| `bun run dev:server` | Start the test server in development mode (needs its settings, above)                         |
| `bun run build`      | Production build of the web app                                                               |
| `bun run start`      | Serve the production build                                                                    |
| `bun run typecheck`  | Type-check every workspace                                                                    |
| `bun run lint`       | ESLint across the repo                                                                        |
| `bun run format`     | Format with Prettier (`format:check` to verify only)                                          |
| `bun run test`       | Unit tests (Vitest)                                                                           |
| `bun run test:e2e`   | End-to-end tests (Playwright). Run `bun --filter @kilomita/web playwright:install` once first |
| `bun run licenses`   | Check every dependency's licence is AGPL-3.0-compatible                                       |
| `bun run tripwire`   | Scan the repo for known malware markers                                                       |

The end-to-end tests never reach a real test server: they answer every speed test request from mocks, and the browser can't resolve any other hostname.

## Repository layout

A [Turborepo](https://turborepo.com) monorepo on Bun workspaces. Workspace tasks (`build`, `typecheck`, `lint`, `test`, `test:e2e`) run through `turbo`, which caches results and only reruns what changed.

```
apps/web                    Next.js App Router site, API routes and dashboard (@kilomita/web)
apps/server                 Fastify measurement server, Dockerfile and deploy guide (@kilomita/server)
packages/engine             Framework-agnostic speed test engine (@kilomita/engine)
packages/shared             Zod schemas, types and constants: states, ISPs, brand (@kilomita/shared)
packages/eslint-config      Shared ESLint presets (@kilomita/eslint-config)
packages/typescript-config  Shared tsconfig presets (@kilomita/typescript-config)
scripts                     Repo tooling: licence check, tripwire, load test (@kilomita/scripts)
```

## Privacy

KiloMita is designed around the Nigeria Data Protection Act 2023. Nothing from a test is stored unless you choose to share it. KiloMita never stores your IP address, and its test servers keep no record of it. You can delete what you shared from the privacy page. The [privacy page](apps/web/app/privacy/page.tsx) describes exactly what is kept and published, including the limits of what rounding and minimum group sizes protect.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

KiloMita is free software, licensed under the [GNU Affero General Public License v3.0 only](LICENSE). If you run a modified version of KiloMita as a network service, the AGPL requires you to offer its source code to your users.
