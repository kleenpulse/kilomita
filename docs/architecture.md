# Architecture

This is an overview for contributors and operators: the parts of KiloMita, how a test flows through them, where trust changes hands, and where each secret lives. The detailed rules (and why each one exists) are in `CLAUDE.md`. The product requirements are in `mita-frd.md`.

## Parts

| Part                         | Where                               | Runs on                                                           | What it does                                                                        |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Web app                      | `apps/web` (Next.js 16, App Router) | Vercel, functions in `fra1` (Frankfurt)                           | The test page, the insight pages, `/privacy`, `/status`, and the API under `/api/*` |
| Measurement engine           | `packages/engine`                   | The visitor's browser, inside a dedicated Web Worker              | Latency, download, upload and loaded latency against a test server                  |
| Test server                  | `apps/server` (Fastify 5)           | A Linux VM in Lagos, behind Caddy                                 | `/ping`, `/down`, `/up`, `/health`; logs nothing, reads no client address           |
| Shared constants and schemas | `packages/shared`                   | Imported by the web app and the engine (types only in the engine) | Brand, ISP and state lists, zod schemas                                             |
| Database                     | Neon Postgres                       | AWS eu-central-1 (Frankfurt)                                      | One `results` table, shared results only                                            |
| Key-value store              | Upstash Redis                       | AWS eu-central-1 (Frankfurt)                                      | The day's salt, rate-limit counters, `/status` counters                             |

## A test, end to end

1. The visitor opens `/`. The page is prerendered and served from Vercel's CDN. Nothing is contacted until Start is pressed.
2. On Start the page asks for two things at once:
   - `POST /api/tokens`: a one-time token, so the result can be shared later (only if sharing is configured)
   - `POST /api/test-servers`: the servers to test against, the Cloudflare fallback setting, and a signed run ticket (120 s, capped at the profile's data limit)
     Both are rate-limited per address when the host reports the address (`CLIENT_IP_HEADER`), and both fail open if Redis is down.
3. The page starts a Worker. The engine picks the lowest-latency server, then measures. All test traffic goes from the Worker to the test server, carrying the ticket in the query string. The page itself only ever talks to its own origin.
4. When the run ends, the page sends `POST /api/outcomes` once, with the outcome code, the profile and the server id. It adds one to an hourly and a daily counter, and stores nothing else.
5. If the visitor has agreed to share and picked a network, the page sends `POST /api/results`. The server checks the token, the plausibility of the numbers and the per-address share limit, hashes the IP prefix with the day's salt, and stores the row.
6. The insight pages (`/isps`, `/states`, ...) read aggregates through `server/insights.ts`. They publish only groups of at least 30 results: count bands, rounded medians and rounded ranges.

## Trust boundaries

- **Browser → web app.** Nothing from the browser is trusted. Every body is capped at 8 KB and parsed strictly, and every submitted result is checked against what the engine can produce. The client IP is read only from the one header the host sets (`CLIENT_IP_HEADER=x-real-ip` on Vercel, which Vercel overwrites itself).
- **Browser → test server.** The server trusts only a run ticket signed with `KILOMITA_SERVER_TICKET_SECRET`. CORS limits which pages may read its answers, but CORS is not an abuse control. The monthly budget with its daily slice is what protects the VM's transfer allowance.
- **Web app → Neon and Upstash.** These are reached only from server code (`apps/web/server/`). A lint rule keeps that code out of anything that could reach the browser. The only pages allowed in are the insight pages (through `@/server/insights` only) and the share-card image route (through `@/server/card-limit` only).
- **Security headers.** Every page has a CSP: same-origin scripts, styles, images and connections, no framing, no plugins, no `<base>`. Scripts keep `'unsafe-inline'`, because Next's streamed payload scripts carry no hash on static pages, so the CSP is defence in depth, not a guarantee. Static files under `/_next/static/` get no CSP: in Chromium a dedicated Worker follows its own script's policy, and the Worker must reach the test servers configured at runtime.

## Secrets

| Secret                          | Lives in                                                         | Used for                                               | If it leaks                                                                   |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `RESULT_TOKEN_SECRET`           | Vercel (Production only)                                         | Signing one-time sharing tokens                        | Anyone can mint tokens. Rotate it (see the runbook).                          |
| `KILOMITA_SERVER_TICKET_SECRET` | Vercel (Production only) and every test server's `deploy/.env`   | Signing and checking run tickets                       | Anyone can use the test servers without the web app. Rotate it on both sides. |
| `DATABASE_URL`                  | Vercel (Production only), the maintainer's `apps/web/.env.local` | Neon                                                   | Read and write access to shared results. Rotate it in Neon.                   |
| `UPSTASH_REDIS_REST_TOKEN`      | Vercel (Production only)                                         | Upstash                                                | Salts and counters can be read or reset. Rotate it in Upstash.                |
| `CRON_SECRET`                   | Vercel (Production only)                                         | Authenticating Vercel Cron's call to `/api/cron/purge` | Anyone can trigger a purge (at most hourly, harmless).                        |

Preview deployments never get these: they use `KILOMITA_STORES=memory` and throwaway secrets, so a forged branch can build but reaches nothing real.

## What is logged

- The web app writes one JSON line per event: a time, a level, a fixed event name and at most an error code. It never writes a message, an address, a body or a secret, and a test captures every handler's output to check.
- The test server writes almost nothing (`logger: false`), and Caddy's error log has every client address field removed. A CI job proves no client address reaches `docker compose logs`.
- Vercel keeps its own request logs (1 hour on Hobby), which include request metadata. `/privacy` says so.
