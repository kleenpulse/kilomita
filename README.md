# KiloMita

**How far your network speed?**

KiloMita is a light, honest internet speed test built for Nigeria. One tap shows your real download and upload speed, latency and bufferbloat, and how much data the test used. Results people choose to share build a public picture of which networks actually perform best in each state.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

> **Status:** Phase 0 (foundation). The speed test itself is not built yet. See [CLAUDE.md](CLAUDE.md) for the phase plan.

## Requirements

- [Bun](https://bun.com) 1.4.4 (package manager and script runner)
- [Node.js](https://nodejs.org) 20.9 or newer (Next.js, TypeScript, ESLint, Vitest and Playwright run on Node). The repo pins 24 in `.node-version`.

## Getting started

```sh
bun install
bun run dev          # http://localhost:3000
```

## Commands

| Command             | What it does                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `bun run dev`       | Start the web app in development mode                                                         |
| `bun run build`     | Production build of the web app                                                               |
| `bun run start`     | Serve the production build                                                                    |
| `bun run typecheck` | Type-check every workspace                                                                    |
| `bun run lint`      | ESLint across the repo                                                                        |
| `bun run format`    | Format with Prettier (`format:check` to verify only)                                          |
| `bun run test`      | Unit tests (Vitest)                                                                           |
| `bun run test:e2e`  | End-to-end tests (Playwright). Run `bun --filter @kilomita/web playwright:install` once first |
| `bun run licenses`  | Check every dependency's licence is AGPL-3.0-compatible                                       |
| `bun run tripwire`  | Scan the repo for known malware markers                                                       |

## Repository layout

```
apps/web          Next.js App Router site (@kilomita/web)
packages/shared   Zod schemas, types and constants: states, ISPs, brand (@kilomita/shared)
packages/engine   Framework-agnostic speed test engine (@kilomita/engine)
scripts           Repo tooling (licence check, tripwire)
```

## Privacy

KiloMita is designed around the Nigeria Data Protection Act 2023: nothing is stored without explicit consent, raw IP addresses are never stored, and you will be able to delete your results. Details will live on the privacy page once results are stored (Phase 3 onward).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

KiloMita is free software, licensed under the [GNU Affero General Public License v3.0 only](LICENSE). If you run a modified version of KiloMita as a network service, the AGPL requires you to offer its source code to your users.
