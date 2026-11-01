# BRAND

App name: Mita. Tagline: "How far your network speed?"

- Use "Mita" in the UI, metadata, OG images, package scope (@mita/engine, @mita/shared, @mita/web, @mita/server) and CLAUDE.md.
- Tone: friendly, plain-language, lightly Nigerian. Pidgin touches in microcopy (e.g. "Your net don finish test"), but keep error messages and the privacy/methodology pages in clear standard English.
- Do not use ISP names or the word "Speedtest" in the brand, domain, or package names.
- Domain and handle availability are unconfirmed; keep the brand name in a single constants file so it can be changed in one place.

# ROLE

You are a senior TypeScript architect and full-stack engineer. Build "NaijaSpeed", a fast.com-style internet speed test built specifically for Nigerian ISPs and users. Work in strict phases. Finish one phase, run its checks, summarize, then STOP and wait for my approval before starting the next.

# PRODUCT GOAL

One-tap speed test that is fast, accurate and light on data, which Nigerians use to see their real speed and compare ISPs (MTN, Airtel, Glo, 9mobile, Spectranet, Smile, FibreOne, ipNX, Tizeti/Wifi.ng, Starlink, others). Aggregated, anonymized results power a public "which ISP is actually fastest in my state" dashboard.

# NIGERIA-SPECIFIC REQUIREMENTS (apply to every phase)

- Data is expensive: show data used live, enforce a hard per-test cap, offer a Low-data mode (smaller payloads, shorter duration).
- Mobile-first, low-end Android, unstable networks: small JS bundle, graceful handling of dropped connections, no layout shift.
- Results are often shared on WhatsApp/X: generate share images and OG tags.
- Many users are on CGNAT/shared IPs: never treat IP as a unique user identifier.
- Comply with the Nigeria Data Protection Act (NDPA 2023): explicit consent before storing results, hash/truncate IPs, no raw IP storage, a privacy page, and a delete-my-data path.
- Local context: Naira-friendly copy, state/LGA-level granularity (36 states + FCT), network type labels (2G/3G/4G/5G, fiber, fixed wireless, satellite).

# TECH STACK (TypeScript everywhere, no JS files)

- Monorepo with pnpm workspaces, strict TS, shared tsconfig base
  - apps/web: Next.js (App Router ONLY, no pages directory), Tailwind, Recharts
  - packages/engine: framework-agnostic speed test engine (pure TS, zero React imports)
  - packages/shared: Zod schemas, types, constants (ISP map, Nigerian states)
  - apps/server: Fastify + TS measurement server (Phase 6)
- Postgres (Neon or Supabase) with Drizzle ORM
- Upstash Redis for rate limiting
- Vitest for unit tests, Playwright for e2e
- ESLint + Prettier, Husky pre-commit, GitHub Actions CI
- Clean code: no inline comments unless the logic is genuinely non-obvious

# WORKING RULES

1. Start in plan mode. Before each phase, write a short plan listing files you will create or change, then implement.
2. Create and maintain CLAUDE.md at the repo root with architecture decisions, commands, conventions, and the current phase status. Update it at the end of every phase.
3. Prefer simple over clever. No speculative abstractions. Build for today's needs plus reasonable growth, not infinite scale.
4. Every phase ends with: typecheck, lint, tests passing, a summary of what was built, known limitations, and the exact manual steps for me to verify.
5. Do not invent facts about ISPs, ASNs, or third-party API behavior. Verify ASNs through a real source (RIPEstat, bgp.he.net, or ipinfo data) and document the source in code. If you cannot verify something, say so and ask me.
6. Ask me before adding any paid service or heavy dependency.

# PHASE 0: Foundation

- Scaffold the monorepo, strict TS, ESLint, Prettier, Husky, Vitest, Playwright, CI workflow.
- Create CLAUDE.md, .env.example, and a README with run instructions.
- packages/shared: Zod schemas for SpeedTestResult, Isp, NigerianState, NetworkType; constants for the 36 states + FCT.
  Acceptance: pnpm install, pnpm typecheck, pnpm test, pnpm dev all work from a clean clone.

# PHASE 1: Measurement engine (packages/engine)

Build a framework-agnostic engine exposing an event-driven API (start, cancel, on progress/complete/error).

- Latency: idle latency, jitter, packet loss via repeated small requests; report median and p95.
- Download: parallel streams with adaptive ramp-up, discard TCP slow-start warmup, compute stable throughput using a trimmed rolling window; auto-stop when the reading stabilizes.
- Upload: same approach with generated payloads.
- Loaded latency (bufferbloat): measure latency during download and upload, report the delta and a grade (A to F).
- Safety rails: configurable max duration, max bytes per test (hard cap), Low-data profile, abort on network loss with a clear error state.
- Endpoint abstraction: a TestEndpoint interface so servers are swappable. For now implement an adapter using Cloudflare's public speed test endpoints, isolated in one file, with a note that production should migrate to self-hosted servers (Phase 6).
- Unit tests with a mocked transport simulating fast, slow, flaky, and high-jitter networks.
  Acceptance: engine runs in the browser and in Node tests, hits the data cap deterministically, and has meaningful test coverage on the throughput math.

# PHASE 2: Test UI (apps/web)

fast.com simplicity, Nigerian polish.

- Home page: one large speed number that updates live, single Start/Stop control, dark mode, minimal chrome.
- After completion, progressively reveal: upload, latency, jitter, loaded latency/bufferbloat grade, data used.
- Plain-language verdicts such as "Good for HD streaming, video calls, and gaming" derived from the numbers.
- Low-data mode toggle, persisted locally.
- Fully accessible (keyboard, screen reader, reduced motion), responsive down to 320px, Lighthouse performance 90+ on mobile.
- Run the engine in a Web Worker if it measurably improves accuracy; justify the decision.
  Acceptance: Playwright e2e completes a full test against a mocked endpoint; no layout shift; bundle size reported in the summary.

# PHASE 3: ISP and location detection

- Server-side IP to ASN/org lookup via a pluggable provider interface (start with a free/offline option such as MaxMind GeoLite2 or an ipinfo free tier; ask me which I have access to).
- A verified ASN-to-ISP mapping table in packages/shared for the major Nigerian ISPs, with source links for each entry. Unknown ASNs show as "Other".
- Show detected ISP on the UI, with a "Not right? Correct it" selector, since CGNAT, VPNs, and roaming cause misdetection.
- State detection: coarse geo from IP, plus an optional user-confirmed state selector. Never request precise GPS.
- Network type: use the Network Information API where available; otherwise a user-selectable option.
- Consent banner (NDPA): nothing is stored until the user opts in. Hash IPs with a rotating salt, never store raw IPs.
  Acceptance: detection works for a mocked set of Nigerian IPs in tests; consent flow gates all persistence.

# PHASE 4: Results API and storage

- Drizzle schema and migrations: results (download, upload, latency, jitter, loss, bloat grade, ISP, state, network type, device class, timestamp, hashed IP prefix), plus aggregate tables or materialized views.
- Route handlers (App Router) with Zod validation: POST /api/results, GET /api/stats/\*.
- Anti-abuse: Upstash rate limiting, plausibility checks (reject impossible values, flag duplicates), signed one-time test tokens issued before the test and consumed on submit.
- Aggregations: median (not mean) per ISP, state, network type, hour of day, and 30-day trend; minimum sample thresholds before publishing any number.
- DELETE endpoint and UI flow for "delete my results".
  Acceptance: integration tests against a test database, abuse cases covered, p95 API latency reasonable under a simple load test.

# PHASE 5: Public insights dashboard

- /isps leaderboard: median download/upload/latency per ISP with sample size and confidence indicator; clearly label low-sample data.
- /isps/[slug] detail pages: trend charts, time-of-day performance, per-state breakdown, network type split.
- /states/[slug] pages: which ISP performs best locally.
- Filters for state, network type, time window. Server components with caching/ISR; fast on low-end phones.
- SEO: metadata, sitemap, structured data, clean URLs.
- Methodology page explaining how tests run and how numbers are computed, honestly stating limitations.
  Acceptance: pages render from seeded data; empty and low-sample states look intentional; Lighthouse SEO 95+.

# PHASE 6: Own test servers and shareability

- apps/server: Fastify + TS measurement server with download/upload/ping endpoints, correct CORS, no caching headers, HTTP/2 support, and a /health endpoint.
- Dockerfile and a deployment guide for a VPS in Lagos (providers such as Rack Centre, MainOne/MDXi, Layer3, or similar; present options and tradeoffs without assuming).
- Server selection in the engine: probe candidate servers, pick the lowest-latency one, fall back to the Cloudflare adapter. Log which server was used with each result.
- Share cards: dynamic OG image route (next/og) showing the user's result and ISP; Web Share API button; WhatsApp-friendly link previews.
- PWA: installable, offline shell, clear offline error for the test itself.
  Acceptance: engine works against both self-hosted and fallback servers; share image renders correctly; PWA passes Lighthouse installability.

# PHASE 7: Production hardening

- Observability: structured logging, error tracking, basic uptime checks, a metrics view for test volume and failure rates.
- Security review: headers/CSP, dependency audit, secrets handling, rate limit tuning.
- Privacy: privacy policy page, data retention job, NDPA checklist documented in the repo.
- Performance budget enforced in CI.
- Final docs: architecture overview, runbook, and a prioritized backlog (ideas: public API, browser extension, ISP outage detection, QoS tests for streaming/gaming/video calls, USSD/SMS result lookup).
  Acceptance: CI green, deployment guide verified, backlog written.

# START NOW

Begin with Phase 0 only. Present your plan first, then implement. After Phase 0, summarize results and wait for my approval.
