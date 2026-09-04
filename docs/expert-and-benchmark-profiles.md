# Expert identities vs publisher affiliations

## Model

Public **Experts** are competitive identities stored as `UniversalProfile` with
`profileType: BENCHMARK` (historical enum name; UI says Expert).

| Concept | Representation |
|---------|----------------|
| **Expert (person)** | `UniversalProfile.displayName` + `ExpertSourceProfile.analystName`, `sourceKind = ANALYST` |
| **Publisher (affiliation)** | `ExpertSourceProfile.publicationName` (Yahoo Fantasy, ESPN, CBS Sports, …) |
| **Staff / unattributed consensus** | Allowed only when rankings are genuinely unattributed — use `sourceKind = SITE_CONSENSUS` or `PUBLISHER` and import to that shell only |

Official publisher shells (`espn-fantasy`, `yahoo-fantasy`, …) remain in the database for history and affiliation labels. They are **`competitorActive: false`** so they are not expected Week competitors when individual analysts exist.

## Public display

- Primary: analyst name (`analystName` / `displayName`)
- Badge: `EXPERT · {publicationName}`

## Consensus / leaderboards

- Expert Consensus uses only **submitted** Expert (`BENCHMARK`) ballots for that week
- Do **not** import both a publisher shell ballot and an analyst ballot for the same source board
- EYEQ grading engine is unchanged

## Admin

- `/admin/experts` — create analysts, set publisher/URL/positions, activate/deactivate (no delete)
- `/admin/benchmarks` — week-specific import availability/status

## Seeding ~20 Week 1 analysts

Use Admin → Experts → “Add Expert analyst”, or a scripted loop calling `createExpertAnalyst` with:

- `analystName` (person)
- `publicationName` (Yahoo Fantasy / ESPN Fantasy / …)
- optional `sourceUrl`, `positionsCovered`, `competitorActive: true`

Then import each analyst’s Week 1 boards from `/admin/benchmarks` (not the inactive publisher shells).
