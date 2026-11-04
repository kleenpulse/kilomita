# Backlog

What is left, in priority order. P0 blocks a public launch. P1 is a known weakness worth fixing soon. P2 is a new idea. The known limitations each phase recorded are in `CLAUDE.md`; this list picks the ones that need work.

## P0: before a public launch

1. **Deploy and verify the production stack.** Buy kilomita.com.ng and the AFRICLOUD VM, create the Vercel project, and follow `apps/server/deploy/DEPLOY.md` and `docs/runbook.md` (Phase 7, step 10).
2. **NDPA open items** (`docs/ndpa-checklist.md`): the cross-border basis for Neon, Upstash and Vercel (ss.41–43), legitimate interests for the outcome counter and the limiter keys, processor terms, and breach-notification contacts. Ideally reviewed by a Nigerian data protection practitioner.
3. **Network detection.** No IP-to-ISP provider is connected, so every visitor picks their ISP and state by hand. Options:
   - Vercel's own `x-vercel-ip-country-region` header gives the state for free, with no new processor.
   - MaxMind GeoLite2 (downloaded at deploy time, never committed) would give the ASN, and so the ISP, without a third party seeing the address.

## P1: known weaknesses

4. **Ticket minting and insertion attacks.** Per-address limits make them cost several IPv4 addresses, but one IPv6 home with a /56, or a few proxies, still gets through. Options: proof-of-work on `/api/test-servers`, delaying a newly visible group, or noise on published values. Each needs the maintainer's call.
5. **A second test server.** With one server, its outage or exhausted daily budget means no test. With several, selection waits out a dead candidate's whole 6 s warm-up. It needs a short grace once one candidate answers (Phase 6 limitation).
6. **Export my shared results** (NDPA access and portability): a `/privacy` button that downloads what the device's secrets can find.
7. **A "Reload to share" message** for a tab loaded before an engine bump, instead of "Couldn't share this result" (Phase 4).
8. **A data licence notice on `/api/stats` responses** (a `Link: <…>; rel="license"` header) so API users see CC BY 4.0 without the page.
9. **The `next dev` reload loop**: still unexplained (CLAUDE.md, "Insights dashboard").
10. **Measurement accuracy above about 63 Mbps** and on 2G uploads (CLAUDE.md, "Measurement engine", known limitations).
11. **An aggregate table** if a group passes about 10^5 results (the interval query uses `array_agg`).
12. **Real devices**: the zero-layout-shift and font checks have run in Chromium only, never on Android with Roboto or on iOS.
13. **Cross-Origin-Opener-Policy**: dropped in Phase 7 because `same-origin` cost about 4 Lighthouse points. Reconsider if KiloMita gains accounts, payments or any cross-window feature.

## P2: ideas (from the FRD)

14. **A public API** with documented, versioned endpoints for the aggregates (beyond today's `/api/stats`), and rate limits keyed on API keys.
15. **ISP outage detection**: a sudden drop in completed tests or speeds for one ISP and state, from the counters and shared results, shown on `/status` or as an alert.
16. **QoS tests** for streaming, gaming and video calls: sustained throughput, jitter under load and packet-loss-like behaviour, beyond today's verdicts.
17. **USSD or SMS result lookup** for people without a smartphone or data: a short code that returns their area's medians.
18. **A browser extension** that runs a low-data test on demand and keeps a local history.
