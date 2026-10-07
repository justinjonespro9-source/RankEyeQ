# Waivers V1 grading — authoritative product decisions

Accepted by the product owner on 2026-10-07 after the authoritative-grading
architecture review. These decisions govern every later Waivers grading stage
(artifact authority, durable results, orchestration, admin preview/apply,
leaderboard and profile). Where Stage 4A code differs, the decision wins and
the code is corrected in the stage named below; Stage 4A code is not changed
outside that stage unless frozen identity requires it.

## Coverage and neutralization

1. **D2 coverage.** A systemically neutralized slot leaves both the numerator
   and the denominator of coverage. Example: WR, 5 submitted, 1 neutralized →
   coverage 4/4 = 100%. A cancelled or moved game never lowers coverage.
2. **All-neutralized board.** `resultKind = NA_ALL_NEUTRALIZED`; WaiverEyeQ,
   FP/Call and FP/Available Slot are all N/A; no honor; Played = NO.
   Contrast `NA_ZERO_CALL`: WaiverEyeQ N/A, FP/Call N/A, FP/Available Slot
   0.00, no honor, Played = YES. Season aggregation preserves the distinction.

## Result semantics

Played is never derived from the mere existence of a `WaiverBoardGrade` row.

| resultKind           | Played | Avg WaiverEyeQ        | Production denominators |
| -------------------- | ------ | --------------------- | ----------------------- |
| `SCORED`             | yes    | included              | included                |
| `NA_ZERO_CALL`       | yes    | excluded              | included                |
| `NA_ALL_NEUTRALIZED` | no     | excluded (no numeric) | excluded                |

`submittedCalls` and `scoreableCalls` are stored separately.

## Leaderboard terminology

3. The individual exact-slot hit metric is **EXACT** (not "Perfect Calls").
   **Perfect Call** remains the board-level honor. Leaderboard **Calls** =
   submitted calls. The FP/Call denominator = scoreable calls after
   neutralization. One field is never overloaded for both concepts.

## Honors

4. **Small-pool honors.** A full *effective* official board can earn the
   full-board honor. Example: QB pool of 2, effective depth 2, both exact →
   WaiverEyeQ 100 and PERFECT PODIUM. The same applies to WR and PERFECT FIVE.
   Future grading policy and tests follow this.

## D3 canonical conflicts

5. **Pool rank.** A `NONPARTICIPANT_ZERO` or `NEUTRALIZED` resolution removes
   the player from the Waiver pool ranking universe (no `waiverPoolRank`
   consumed). `SCORE_AS_RANKED` participates normally. This differs from
   Stage 4A and is corrected in the grading-orchestration stage.
6. **Scope.** Every conflict affecting an eligible frozen pool member is
   resolved before apply, even when nobody selected that player.
7. **Carry-forward.** Never automatic. The operator explicitly reconfirms; the
   new decision may reference the old one for lineage.

## Lifecycle and apply

8. **During review.** Current grades stay visible during `REGRADE_AVAILABLE`
   and `SOURCE_WITHDRAWN`. No automatic regrade. A later UI may show a notice.
9. **Apply granularity.** V1 apply is WEEK-ATOMIC: all five contests grade in
   one transaction or none do.

## Identity

10. **Missing identity.** Missing or ambiguous canonical identity is a
    blocker. No operator identity override in V1.
11. **DEF crosswalk.** Week 5 may proceed with a clean verified DEF crosswalk
    plus an explicit stored operator acknowledgment. Block on an actual
    ambiguous or missing mapping; do not block solely because producer
    fixtures do not exist.

Stage 4B.1 (frozen identity): official snapshot entries frozen from 4B.1 on
store `identityProviderAtFreeze` / `identityExternalIdAtFreeze`, verified by
the database against the referenced `RankableEntry` at insertion and immutable
afterwards. Canonical preflight uses the frozen key as authority and blocks on
frozen-vs-live drift. Week 5 rows predate 4B.1 and stay NULL (never
backfilled); they keep the `IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT` advisory and
current-identity matching, and are not blocked solely for predating 4B.1.

## Artifacts and scoring

12. **Artifact content.** The full exact canonical artifact text is stored in
    a separate 1:1 content table so it can be re-verified later.
13. **Breakout position.** Future Breakout evaluation uses the canonical SNG
    position. A position mismatch remains durable evidence / advisory.
14. **Fantasy engine.** Waivers uses `SNG_NFL_HALF_PPR@1`. It is not
    reconciled with or reused from the Rankings engine.

## Timing and preflight

15. **Week 5.** Not graded until artifact authority, durable results and
    orchestration/admin preview+apply all exist, and an ACCEPTED SNG Week 5
    artifact is available.
16. **Pool sizes.** The read-only preflight shows the actual eligible frozen
    pool size for every position. Never assume 3/5 availability.
