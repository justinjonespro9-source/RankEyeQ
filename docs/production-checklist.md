# RankEYEQ production checklist

> **Brand note:** RankEYEQ is the public product brand. Internal code and database identifiers may still use the historical RankIQ name.

Use this before the first live NFL week. Do not enable Stripe in this pass.

## Database

- [ ] Provision PostgreSQL (production, not local)
- [ ] Set `DATABASE_URL` with SSL if required (`?sslmode=require`)
- [ ] Run `npx prisma migrate deploy`
- [ ] Confirm backups / point-in-time recovery are enabled
- [ ] Optional: `npm run db:seed` once for AI bots + admin email (never on a dirty prod DB without review)
- [ ] Confirm 8 active AI competitors (GPT, Claude, DeepSeek, Gemini, Llama, Mistral, Perplexity, Grok) via `/admin/diagnostics` or `npx tsx scripts/sync-ai-competitors.ts`

## Environment

Copy `.env.example` and set production values. Strict validation runs when `VERCEL_ENV=production` or `RANKIQ_STRICT_ENV=1`.

Required:

- [ ] `DATABASE_URL`
- [ ] `AUTH_SECRET` (≥32 chars, not the example value)
- [ ] `AUTH_URL` (canonical public URL, e.g. `https://rankeyeq.com`)
- [ ] `EMAIL_FROM` plus `AUTH_RESEND_KEY` **or** `EMAIL_SERVER`
- [ ] `NFL_DATA_PROVIDER=manual` (recommended without paid sports API), `mock`, or `sportsdataio`

If SportsDataIO is selected:

- [ ] `SPORTSDATAIO_API_KEY`
- [ ] Optional `SPORTSDATAIO_BASE_URL`

If manual is selected:

- [ ] Confirm `/admin` Manual weekly ops is used for schedule/pools/results
- [ ] Confirm live pages do **not** imply an automatic sports feed
- [ ] Follow `docs/manual-weekly-operations.md`

Optional:

- [ ] `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` (both or neither)
- [ ] `AUTH_TRUST_HOST=true` on Vercel
- [ ] `SEED_ADMIN_EMAIL` for first admin (seed only)

Never set `RANKIQ_DEV_PROFILE_SWITCHER=1` in production.

## Auth.js

- [ ] Magic-link callback host matches `AUTH_URL`
- [ ] Google redirect URI: `https://YOUR_DOMAIN/api/auth/callback/google`
- [ ] Verify `/signin` and `/account/setup`
- [ ] Promote at least one `User.role = ADMIN`

## Vercel / domain

- [ ] Production env vars attached to Production (and Preview as needed)
- [ ] Custom domain + DNS
- [ ] `AUTH_URL` uses the public domain (not `*.vercel.app` if you have a custom domain)
- [ ] Cron / live refresh: live RankEYEQ pages are on-demand; add a cron later only if you cache live stats

## Week setup smoke

- [ ] Open `/admin/diagnostics` (admin-only) or run `npm run smoke`
- [ ] Active NFL season + non-test week
- [ ] Five position contests
- [ ] Player pools imported (manual paste or provider)
- [ ] Pool audit READY for QB/RB/WR/TE/DEF (manual mode)
- [ ] AI UniversalProfiles exist
- [ ] Timing windows: Tue open / Sun 10am CT lock / noon public
- [ ] Fantasy scoring version `RANKIQ_NFL_PPR_V1`

## Historical provider rehearsal (recommended)

- [ ] `/admin/test-week` — create `[TEST]` week on `NFL-TEST` season
- [ ] Fetch schedule → pools → stats → finishes → seed bots → grade
- [ ] Review `/consensus?test=1` and `/leaderboards?test=1` only
- [ ] Confirm live `/leaderboards` and homepage do **not** include test weeks

## Live week verification

- [ ] Bot submissions in `/admin/ai`
- [ ] Contest lock (SUBMITTED only compete)
- [ ] Consensus visible after Sunday 10:00 AM America/Chicago
- [ ] Individual boards follow FREE/PREMIUM reveal until noon, then public
- [ ] Finalize Week blocked until pools ready + final points/ranks complete
- [ ] Manual mode: Finalize requires “results entered and verified” confirmation (no SportsDataIO key)
- [ ] Grade / finalize confirmations used

## Rate limiting note

In-process rate limits cover draft save, submit, follow, auth email, unlock writes, and admin import/parser.

Multi-instance production should later add Redis/Upstash (or Vercel Firewall) for distributed limits. Page GETs (consensus/live) currently rely on the host/CDN.

## Observability

Server logs are JSON lines via `lib/log.ts` (no secrets). Wire the same sink to Vercel/Sentry later. Analytics events are emitted as `analytics.*` log events with no PII.
