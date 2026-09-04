# Creator competitor identities

## Model

Public **Creators** are competitive identities stored as `UniversalProfile` with
`profileType: CREATOR`, plus metadata on `CreatorCompetitorProfile`.

This is **distinct** from monetization `CreatorProfile` (HUMAN payout / board reveal opt-in on `/admin/creators`).

| Concept | Representation |
|---------|----------------|
| **Creator (person)** | `UniversalProfile.displayName` + `CreatorCompetitorProfile.personName` |
| **Brand / show (affiliation)** | `CreatorCompetitorProfile.brandName` (e.g. TCO Fantasy Show) |
| **Directory active** | `competitorActive` + `CreatorCompetitorProfile.active` |
| **Weekly participation** | Only when a real ballot is imported/submitted for that week/position |

## Public display

- Primary: person name
- Badge: `CREATOR · {brandName}`

## Consensus / leaderboards

- Creator Consensus uses only **submitted** Creator ballots for that week/position
- Missing weeks never create empty ballots and never hurt scores
- Overall leaderboard includes Humans + Experts + Creators + AI (graded submissions only)
- Filters: Consensus and Leaderboards expose a Creators chip
- One `UniversalProfile` cannot be both Creator and Expert/Human/AI (seed refuses conversion)

## Admin / seeding

```bash
DATABASE_URL=... npx tsx scripts/seed-creator-competitors.ts
```

Then import boards from `/admin/benchmarks` (same capture path as Experts). Creator Consensus is computed live until snapshot schema gains Creator columns.
