# SEO, indexing, and crawler defense

`robots.txt` is crawl guidance only. Authentication, admin guards, and **Vercel Firewall** remain the security layers.

## Canonical host

Public canonical origin: `https://www.rankeyeq.com`

- Prefer `NEXT_PUBLIC_SITE_URL=https://www.rankeyeq.com`
- `AUTH_URL` may match the same host for Auth.js callbacks
- Bare `https://rankeyeq.com` is normalized to `www` in SEO helpers

## Recommended Vercel Firewall rules

Apply in Vercel project → Firewall (tune thresholds after observing traffic):

1. **`/api/**`** — rate-limit aggressive clients; challenge suspicious ASNs / datacenter traffic. Keep Auth.js callbacks working for real users.
2. **`/api/auth/**`** — stricter rate limits than general API; protect magic-link / OAuth endpoints from credential stuffing and mail bombing.
3. **`/go`** — rate-limit redirect endpoint (app also has a process-local limiter). Block scrapers hammering sponsor clicks.
4. **`/rank/**` and `/leaderboards/live/**`** — challenge or rate-limit high RPS (expensive Prisma + timing). Still allow occasional human hits; these routes are noindex/disallow for SEO crawlers.
5. **`/admin/**`** — deny or challenge unless allowlisted ops IPs when practical.
6. **`/account/**`, `/creator`, `/following`** — rate-limit authenticated surfaces; challenge anonymous floods.
7. **Global** — challenge known bad bots / empty UA floods, but **do not** block Googlebot / Bingbot for allowlisted public pages (`/`, `/how-it-works`, `/results`, `/leaderboards`, `/players`, `/rankers`, `/profile/*`, `/legal/*`).

## High crawler-cost routes (app)

| Route | Why expensive | SEO posture |
|---|---|---|
| `/rank/[position]` | Auth + contest + pool + draft submission + research | noindex + robots disallow |
| `/leaderboards` | Multi-filter leaderboard queries + profile joins | index landing; canonical strips filters |
| `/consensus` | Consensus aggregation | index landing; canonical strips filters |
| `/profile/[username]` | Stats, badges, receipts, follow counts | index public only |
| `/players/[playerId]` | Detail + week history + badges | index |
| `/` | Homepage composites + receipts | index |

Sitemap dynamic segments are cached (`unstable_cache`, 1h) and bounded (profiles ≤300, players ≤200).
