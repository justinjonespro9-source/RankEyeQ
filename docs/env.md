# RankEYEQ environment variables

> **Brand note:** RankEYEQ is the public product brand. Some internal technical identifiers (for example `RankIQContest`, `RANKIQ_*` env vars) retain the historical RankIQ name intentionally to avoid unnecessary migration/refactor risk.

See also `.env.example`, `docs/production-checklist.md`, and `docs/manual-weekly-operations.md`.

Validation lives in `lib/env.ts`.

- **Always required:** `DATABASE_URL`
- **Production strict** (`VERCEL_ENV=production` or `RANKIQ_STRICT_ENV=1`):
  - `AUTH_SECRET` (≥32 characters, not the example placeholder)
  - `AUTH_URL`
  - Email: `AUTH_RESEND_KEY` or `EMAIL_SERVER`, plus `EMAIL_FROM`
- **Optional Google:** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` together
- **All consensus:** `RANKEYEQ_CONSENSUS_ALL_MODE=group_weighted` | `ballot_union` (legacy alias: `RANKEQ_CONSENSUS_ALL_MODE`)
- **NFL provider:** `NFL_DATA_PROVIDER=manual` | `mock` | `sportsdataio`
  - **`manual`** — recommended for production without a paid sports-data API. Operator pastes schedule, pools, and fantasy points. SportsDataIO credentials are **not** required and are not flagged as missing.
  - **`mock`** — local/dev fixtures
  - **`sportsdataio`** — requires `SPORTSDATAIO_API_KEY`
- **SportsDataIO:** `SPORTSDATAIO_API_KEY` required **only** when `NFL_DATA_PROVIDER=sportsdataio`

Dev-only (never production):

- `RANKIQ_DEV_PROFILE_SWITCHER=1`
- `RANKIQ_BOARD_REVEAL_ENTITLED=1` (dev fallback for premium reveal)

Secrets are never sent to the client. `instrumentation.ts` fails startup in strict production if required vars are missing.
