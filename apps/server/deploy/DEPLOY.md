# Deploying a KiloMita test server in Lagos

This guide sets up one measurement server (`apps/server`) behind Caddy on a Linux VM. It is written for whoever operates the server. Nothing in it is bought for you: choose a provider below, then follow the steps.

## What you are deploying

- **`server`**: the Fastify app. It answers `/ping`, `/down?bytes=N`, `/up` and `/health`, logs nothing, and never reads the client's address. It refuses any request without a run ticket, which the KiloMita web app signs for each test.
- **`caddy`**: Caddy 2 in front. It gets a TLS certificate automatically, speaks HTTP/1.1, 2 and 3 to browsers, and forwards to the server over h2c on the private Docker network. It keeps no access log, and its error log has every client address removed (see `Caddyfile`).

Both images are pinned by digest in `Dockerfile` and `compose.yaml`.

## Choosing a provider

Seen on 2026-11-03. Prices and terms change, so check them again before you buy.

| Provider                                                                                        | What it sells in Lagos                                               | Price (as seen)                                                                           | Transfer                                                                  | IXPN Lagos                          | Sources                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AFRICLOUD                                                                                       | Self-serve VMs (VM1–VM8), "Deploy in Lagos"                          | VM1 (1 vCPU, 1 GB, 20 GB NVMe, 1 Gbps): ₦28,000 a month list, ₦14,000 with its 50NEW code | 1 TB a month on VM1; past it the port drops to **8 Mbps**, no overage fee | Yes, 10G (PeeringDB)                | [africloud.com/ng](https://africloud.com/ng), [PeeringDB AS209179](https://www.peeringdb.com/net?asn=209179)                                 |
| Melbicom                                                                                        | KVM VPS plans in "Lagos (LOS1)"                                      | Not published on its page                                                                 | 1 TB on KVM-1; past it **10 Mbps**, no overage fee                        | Listed (IXPN logo; PeeringDB entry) | [melbicom.net/virtualserver/lagos](https://www.melbicom.net/virtualserver/lagos), [PeeringDB AS8849](https://www.peeringdb.com/net?asn=8849) |
| AWS                                                                                             | Local Zone `af-south-1-los-1a` (opt in from Cape Town)               | Not checked                                                                               | Metered egress, no throttle                                               | Amazon peers at IXPN                | [AWS Local Zones](https://aws.amazon.com/about-aws/global-infrastructure/localzones/locations/)                                              |
| Rack Centre, Equinix LG1/LG2 (formerly MainOne MDXi), Digital Realty, OADC, Africa Data Centres | Colocation only (your own hardware)                                  | Sales                                                                                     | —                                                                         | All are IXPN facilities             | [PeeringDB IXPN Lagos facilities](https://www.peeringdb.com/api/ixfac?ix_id=488)                                                             |
| Layer3                                                                                          | Says it has Lagos and Abuja zones; self-serve checkout not confirmed | Not published                                                                             | Not found                                                                 | Yes, 1G (PeeringDB)                 | [layer3.cloud](https://www.layer3.cloud/virtual-servers)                                                                                     |

**Why the throttle matters.** One full test moves up to 50 MB, so a 1 TB allowance covers about 20,000 full tests a month. A throttled port would cap every reading at about 8–10 Mbps and the results would look real. The server's budget (below) stops serving before that happens, so the test moves to another server or says no server is available.

A VM with IPv6, a 1 Gbps port and peering at IXPN Lagos (the exchange Nigerian ISPs meet at) gives Nigerian users the shortest path.

## Before you start

- A Linux VM (Ubuntu 24.04 LTS) with a public IPv4 address, ideally IPv6 too, and SSH access.
- A DNS name for it, such as `lagos-1.kilomita.com.ng`, with an `A` record (and `AAAA` for IPv6) pointing at the VM.
- The KiloMita web app's origin (for example `https://kilomita.com.ng`) and its `KILOMITA_SERVER_TICKET_SECRET`. The server and the web app must have the same value.

## Steps

1. **Firewall.** Allow only SSH (22/tcp), HTTP (80/tcp, for certificate checks), HTTPS (443/tcp) and HTTP/3 (443/udp):
   ```sh
   sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
   ```
2. **Docker.** Install Docker Engine and the Compose plugin from Docker's own instructions: <https://docs.docker.com/engine/install/ubuntu/>.
3. **The code.** Clone the repository and check out the **full SHA of a reviewed commit**, never a branch name: a branch can be force-pushed between review and deploy.
   ```sh
   git clone https://github.com/kleenpulse/kilomita.git && cd kilomita
   git checkout --detach <full reviewed SHA>
   git rev-parse HEAD
   sh scripts/tripwire.sh
   cd apps/server/deploy
   ```
   `git rev-parse HEAD` must print exactly the SHA you were given, and the tripwire must report the tree clean (exit 0). If either doesn't, stop.
4. **Settings.** Create `.env` in this folder (it is git-ignored; never commit it):
   ```sh
   KILOMITA_SERVER_HOST=lagos-1.kilomita.com.ng
   KILOMITA_SERVER_ORIGINS=https://kilomita.com.ng
   KILOMITA_SERVER_TICKET_SECRET=<the web app's value>
   KILOMITA_EGRESS_BUDGET_GB=900
   ```
   Set the budget to about **90% of the plan's monthly allowance** (900 for 1 TB). The server counts the payload it sends and receives per UTC month, and gives each UTC day a share of what is left, so a burst of abuse costs one day, not the month. It doesn't count TLS overhead, and your provider's month may not start on the 1st, hence the margin. Uploads aren't reserved in advance, so transfers in flight can overshoot by up to 2 GB (256 × 8 MB).
5. **Start.**
   ```sh
   docker compose up -d --build
   ```
6. **Check.** `curl https://lagos-1.kilomita.com.ng/health` should print `{"status":"ok"}` (`over-daily` or `over-budget` when the budget is used up). `curl -i https://lagos-1.kilomita.com.ng/ping` should answer **403**: no ticket, no test.
7. **Connect the web app.** On the web app, set `KILOMITA_TEST_SERVERS=lagos-1=https://lagos-1.kilomita.com.ng` (and the ticket secret), restart it, and run a test. The result's server is `lagos-1`.

## Running it

- **Updates:** `git fetch`, then step 3's `git checkout --detach <full reviewed SHA>`, `git rev-parse HEAD` and the tripwire, then `docker compose up -d --build` in `apps/server/deploy`. More in `docs/runbook.md`.
- **Budget alert:** also set your provider's usage alert at about 80% of the allowance, as a second guard.
- **Logs:** `docker compose logs` shows errors and certificate messages, rotated at 3 × 10 MB per container. They hold no client addresses. **Never add a `log` directive** to the site in `Caddyfile`: that turns on access logs, which record every visitor's address.
- **The budget counter** lives in the `server-state` volume (`/data/egress.json`) and survives restarts.

## The web app on Vercel

The web app (`apps/web`) runs on Vercel, with its functions in Frankfurt next to Neon and Upstash (`apps/web/vercel.json`).

1. **Project.** In Vercel, import `kleenpulse/kilomita`, set the root directory to `apps/web` and keep the detected framework (Next.js). Vercel installs with Bun from the committed `bun.lock`.
2. **Environment variables.** Set every variable in `docs/runbook.md` ("Vercel environment variables") on the **Production** target only. Give **Preview** `KILOMITA_STORES=memory`, `KILOMITA_SEED=demo` and throwaway secrets, so a branch build never reaches real data.
3. **Domain.** Add `kilomita.com.ng` to the project and point its DNS at Vercel as the dashboard says. Add `lagos-1.kilomita.com.ng` as an `A` (and `AAAA`) record to the test server's VM.
4. **Deploy** by merging to `main`. Then check, as in the runbook:
   - the production deployment's commit SHA equals `main`
   - pages carry `content-security-policy` and `strict-transport-security`
   - a file under `/_next/static/` carries **no** CSP (otherwise the speed test's Worker can't reach the test server)
   - one low-data test on the live site completes against `lagos-1`
5. **Uptime.** Set the repository variables `KILOMITA_WEB_URL` and `KILOMITA_SERVER_URLS` (Settings, Secrets and variables, Actions, Variables), then run the `Uptime` workflow once by hand.

## Known limits

- Abuse is limited by the budget's daily slice, and per address by the web app when `CLIENT_IP_HEADER` is set (`x-real-ip` on Vercel): 60 runs an hour and 300 a day per IPv4 address or IPv6 /64, 10 times that per IPv6 /48. Someone with several addresses can still use up one day's share.
- Run tickets expire two minutes after they are issued.
