# Runbook

What to do to run KiloMita in production, and what to do when something goes wrong. Written for the operator. Commands for the maintainer's Windows machine are for Windows PowerShell 5.1 (no `&&`: run one line at a time). Commands on the VM are for its Linux shell.

## The deployment at a glance

| Piece                 | Where                                                                                   | Config                                                          |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Web app               | Vercel project, root directory `apps/web`, functions in `fra1` (`apps/web/vercel.json`) | Vercel env vars, **Production** target only (below)             |
| Test server `lagos-1` | AFRICLOUD VM1, Lagos, Docker Compose (`apps/server/deploy/`)                            | `apps/server/deploy/.env` on the VM                             |
| Database              | Neon, AWS eu-central-1                                                                  | `DATABASE_URL`                                                  |
| Redis                 | Upstash, AWS eu-central-1                                                               | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`            |
| Uptime                | `.github/workflows/uptime.yml`, every 15 minutes                                        | Repository variables `KILOMITA_WEB_URL`, `KILOMITA_SERVER_URLS` |
| `main`                | Ruleset "Protect main": no force-push, no deletion, no bypass                           | GitHub repository settings, Rules                               |

## Vercel environment variables

Set these on the **Production** target only. Previews must never get them: a forged branch would otherwise build with real data access.

| Variable                                             | Production value                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                               | `https://kilomita.com.ng`                                             |
| `CLIENT_IP_HEADER`                                   | `x-real-ip` (Vercel overwrites it; a client can't forge it)           |
| `DATABASE_URL`                                       | Neon's pooled connection string                                       |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | From the Upstash console                                              |
| `RESULT_TOKEN_SECRET`                                | base64 of 32 random bytes                                             |
| `KILOMITA_SERVER_TICKET_SECRET`                      | base64 of 32 random bytes, **the same value as on every test server** |
| `KILOMITA_TEST_SERVERS`                              | `lagos-1=https://lagos-1.kilomita.com.ng`                             |
| `KILOMITA_CLOUDFLARE_FALLBACK`                       | `off` (on only with Cloudflare's written OK)                          |
| `CRON_SECRET`                                        | Any long random string                                                |

**Preview** target: `KILOMITA_STORES=memory`, `KILOMITA_SEED=demo`, and throwaway values for `RESULT_TOKEN_SECRET` and `KILOMITA_SERVER_TICKET_SECRET`.

Leave `KILOMITA_TEST_SERVERS` **unset** on Preview: previews then say "No test server is reachable right now", and run no test. If it were set to `lagos-1`, the test would start and then fail, because `lagos-1` accepts neither the preview's origin (CORS) nor its throwaway tickets (403). **Either way is intended:** previews can't spend the VM's transfer budget. Never "fix" it by copying the production ticket secret into Preview.

Make a secret (PowerShell or any shell with Bun):

```
bun -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

On Vercel any change to an env var takes effect only with a new deployment: redeploy after changing one.

## Deploying

Always deploy a **full commit SHA that was reviewed**, never a branch name: this repository has had forged pushes before (see the maintainer's incident record).

**Web app.** Merging to `main` deploys production through Vercel's Git integration. Afterwards:

1. In the Vercel dashboard, open the production deployment and check its commit SHA equals `git rev-parse origin/main`.
2. Check the headers: `curl.exe -sI https://kilomita.com.ng/` shows `content-security-policy`, `strict-transport-security` and `x-content-type-options: nosniff`.
3. Check a static file has **no** CSP: `curl.exe -sI https://kilomita.com.ng/_next/static/chunks/<any>.js`. If it has one, the Worker can't reach the test servers and every test fails.
4. Run one low-data test on the live site.

**Roll back the web app:** in Vercel, Deployments, pick the previous production deployment, "Promote to Production". Then revert the bad commit on `main` through a pull request.

**Test server.** Follow `apps/server/deploy/DEPLOY.md`. To update one:

```sh
cd ~/kilomita && git fetch origin
git checkout --detach <full reviewed SHA>
git rev-parse HEAD            # must print the same SHA
sh scripts/tripwire.sh        # must say clean
cd apps/server/deploy && docker compose up -d --build
curl -s https://lagos-1.kilomita.com.ng/health
```

**Roll back the test server:** the same steps with the previous reviewed SHA.

## Rotating secrets

**`KILOMITA_SERVER_TICKET_SECRET`** (web app and every test server must agree):

1. Make a new value.
2. Set it on each test server (`deploy/.env`) and restart it: `docker compose up -d`. From now until step 3 is live, tests fail with 403 ("The test server refused the test").
3. Set it on Vercel (Production) and redeploy at once.
   The gap is the time between steps 2 and 3, usually a minute or two. Tickets live 120 s, so runs in flight at the switch fail. Do it at a quiet hour.

**`RESULT_TOKEN_SECRET`:** set the new value on Vercel and redeploy. Tokens issued under the old secret (valid 30 minutes) are refused when they share, so a few results in flight can't be shared. Nothing else breaks.

**`CRON_SECRET`:** set the new value and redeploy. Vercel Cron picks it up automatically.

**`DATABASE_URL`, Upstash token:** rotate in the Neon or Upstash console, set the new value on Vercel, redeploy. Rotating Upstash keeps its data. A new Upstash database loses the day's salt (harmless) and every counter.

## Budgets and quotas

- **The test server's transfer budget.** `KILOMITA_EGRESS_BUDGET_GB` is about 90% of the plan's allowance (900 for AFRICLOUD VM1's 1 TB). The server counts payload per UTC month, and each UTC day gets a fair share of what is left. Out of today's share, `/health` says `over-daily` and tests get "The test server is full right now". Set the provider's own usage alert at 80% too (DEPLOY.md, "Running it").
- **One full test moves up to 50 MB**, so 1 TB is about 20,000 full tests a month.
- **Upstash commands.** A run costs 25 commands without sharing and 6 more to share (counted by `apps/web/server/command-count.test.ts`), plus 2 per process per day for the salt. `/status` costs up to 54 reads a minute when someone is looking, and `/api/health` 1 per check (96 a day). The free plan's 500,000 commands a month therefore covers about 18,000–20,000 runs a month: about the same as the VM's transfer allowance. Past the free plan, adding a card makes the database pay-as-you-go at $0.20 per 100,000 commands (Upstash pricing, read 2026-11-04). If Redis refuses commands, fails or hangs, tests keep working: each limit check gives up after 500 ms and lets the request through, and each counter write gives up after 2 s, after the response. A test then starts at most about half a second later than usual; only sharing stops.
- **Neon compute.** `/api/health` asks the database at most once an hour, so the uptime check doesn't keep the compute awake. Every other database query comes from a visitor sharing, deleting or reading the insight pages.
- **Vercel Hobby.** 1,000,000 function invocations, 4 hours of active CPU and 100 GB of transfer a month. Most cost comes from the dynamic insight pages, `/status` and the share-card images (rate-limited per address, and cached by Vercel's CDN once rendered). Usage is under Settings, Usage. If usage approaches a limit, move to Pro ($20/month) or cut traffic: a Hobby project over its limits can be paused.

## Reading /status

`/status` shows, for the last 24 hours and 30 days, how many tests started (server lists handed out), how many browsers reported an ending, how many finished, and why the others didn't. It also shows refusals by reason and errors on our side by code. The counts come from browsers and are not checked, so a sudden spike can be forged; compare it with the Vercel usage graphs before acting on it.

- **Many "Test server refused or failed"**: check the test server's `/health`. If it says `over-daily`, the day's budget is used up (abuse, or real growth). If 403s are high right after a deploy, the ticket secrets probably differ: compare them.
- **Many "No test server available"**: the web app has no usable server. Check `KILOMITA_TEST_SERVERS`, the ticket secret, and the server's `/health`.
- **Many "Connection dropped"**: usually a bad network on the visitors' side, unless it is concentrated on one server.
- **Many "Old copy of the page"**: the installed app's offline copy is stale after a deploy. It clears itself when the visitor reloads.
- **"Too many tests from one connection" climbing**: one address is hammering the API. That is the per-address limit working; a large CGNAT pool can also hit it at peak hours.
- **Errors on our side**: each row is an event and an error code. `ECONNREFUSED` or `ETIMEDOUT` usually means Neon or Upstash is unreachable. A five-character code like `57P01` is a Postgres SQLSTATE.

For detail, Vercel's runtime logs hold our JSON lines (`{"level":"error","event":"tokens","code":"…"}`), but only for 1 hour on Hobby.

## Uptime alerts

The `Uptime` workflow checks `/api/health` on the web app and `/health` on each server. A failed run emails the repository's owner.

- GitHub may delay or drop scheduled runs, so a missing run is not an outage.
- GitHub disables scheduled workflows in a public repository after **60 days without activity**. If the repository is quiet for that long, re-enable the workflow under Actions.
- To check by hand: Actions, Uptime, "Run workflow".
- Set the variables under Settings, Secrets and variables, Actions, Variables: `KILOMITA_WEB_URL=https://kilomita.com.ng` and `KILOMITA_SERVER_URLS=https://lagos-1.kilomita.com.ng` (space-separated for more servers).

When `/api/health` says `degraded`, Neon or Upstash is unreachable: tests still run, sharing and the insight pages don't. Check the providers' status pages. When a server's `/health` doesn't answer, SSH in and run `docker compose ps` and `docker compose logs --tail 100 server`.

## Certificates

Caddy gets and renews the test server's certificate by itself. It needs port 80 open for the HTTP challenge. Check the expiry:

```sh
echo | openssl s_client -connect lagos-1.kilomita.com.ng:443 -servername lagos-1.kilomita.com.ng 2>/dev/null | openssl x509 -noout -enddate
```

If renewal fails, `docker compose logs caddy` shows why (it never logs client addresses). Vercel renews the web app's certificate.

## Database chores

- **Migrations** (the maintainer, from their machine with `apps/web/.env.local`): `bun --filter @kilomita/web db:migrate`. It applies pending migrations, then purges expired data.
- **Purge only:** `bun --filter @kilomita/web db:purge`. Vercel Cron also calls `/api/cron/purge` daily at 03:00 UTC.

## Dependency audit

CI runs `bun audit --audit-level=high`. When it fails:

1. Read the advisory. If a fixed version exists **and is at least 7 days old** (`bunfig.toml`'s minimum release age), upgrade it in a pull request.
2. If the fix is younger than 7 days, or the advisory doesn't apply, add `--ignore=GHSA-…` to the root `audit` script **with a removal date**, and record the reason and the date in CLAUDE.md ("Dependency audit"). Remove the ignore on that date.

## Incidents

- **A secret leaked:** rotate it (above), then check `/status` and Vercel's usage for abuse in the meantime.
- **A personal data breach** (shared results, IP hashes or salts exposed): the NDPA asks the controller to notify the Nigeria Data Protection Commission within 72 hours of becoming aware of a breach likely to cause risk (s.40; see `docs/ndpa-checklist.md`). Write down what was exposed, when, and what was done, at the time.
- **A suspicious commit or push:** follow the maintainer's incident record. Run `bun run tripwire` and check incoming commits' author and committer time zones before pulling. Never deploy a SHA that wasn't reviewed.
