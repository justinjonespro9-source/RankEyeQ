# Expert identities vs benchmark datasets

## Current model

Public **Expert** rankers (fantasy analysts, publisher consensus boards, editorial ranking sources) are stored as `UniversalProfile` rows with `profileType: BENCHMARK`. The UI label is **Expert**; the database enum retains the historical `BENCHMARK` name.

`ExpertSourceProfile` holds publication metadata (display name, analyst, URL, positions covered, active flag). Expert weekly rankings flow through `BenchmarkSnapshot` → `RankingSubmission` and grade with the same RankEyeQ EYEQ engine as Human and AI ballots.

## Future separation (not migrated yet)

RankEyeQ may later distinguish:

| Concept | Examples | Public role |
|---------|----------|-------------|
| **Expert** | Analysts, site consensus boards | Competitive ranker identity, consensus segment, leaderboards |
| **Benchmark** | ADP, projection systems, market prices, statistical models | Reference data — not necessarily “fantasy experts” |

The current schema does **not** block this split:

- `BENCHMARK` profiles can be reclassified or aliased when a dedicated type is introduced.
- `ExpertSourceProfile.sourceKind` can distinguish publisher vs analyst vs other.
- Official seed sources (`OFFICIAL_BENCHMARK_SOURCES`) are a subset; custom expert profiles already coexist.

No schema migration is required until non-expert benchmark datasets need separate UX and consensus treatment.
