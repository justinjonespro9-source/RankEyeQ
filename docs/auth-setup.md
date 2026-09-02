# RankEYEQ authentication setup

RankEYEQ uses **Auth.js (NextAuth v5)** with the Prisma adapter.

## Methods

- Email magic link (Nodemailer / console in local; Resend when `AUTH_RESEND_KEY` is set)
- Google OAuth when `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` are set

## Identity model

- `User` / `Account` / `Session` — Auth.js account records
- `UniversalProfile` — sports identity used by rankings, leaderboards, and results
- `User.universalProfileId` links an account to exactly one UniversalProfile
- `RankingSubmission` continues to reference `UniversalProfile` only

AI bots (GPT, Claude, DeepSeek, Gemini, Llama, Mistral, Perplexity, Grok) are UniversalProfiles with `profileType = AI` and **no** Auth.js users. See `lib/ai-competitors.ts`.

## Local development

1. Set `AUTH_SECRET` and `AUTH_URL=http://localhost:3000` in `.env`
2. Run migrations + seed
3. Sign in at `/signin` with email — magic link prints to the server console when no email provider is configured
4. Seed admin: `SEED_ADMIN_EMAIL` (default `admin@rankiq.local`) — promote via seed `role = ADMIN`

## Vercel

1. Set `AUTH_SECRET`, `AUTH_URL` (production URL), and `AUTH_TRUST_HOST=true` if needed
2. Configure Resend (`AUTH_RESEND_KEY`, `EMAIL_FROM`) or SMTP (`EMAIL_SERVER`)
3. Google redirect URI: `https://YOUR_DOMAIN/api/auth/callback/google`

Full production env list: `docs/env.md` and `docs/production-checklist.md`.

## Optional debug chrome

`RANKIQ_DEV_PROFILE_SWITCHER=1` in development only shows profile deep-links. It never appears in production and does not control submissions.
