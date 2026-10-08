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

| resultKind              | Played | Avg WaiverEyeQ        | Production denominators |
| ----------------------- | ------ | --------------------- | ----------------------- |
| `SCORED`                | yes    | included              | included                |
| `NA_ZERO_CALL`          | yes    | excluded              | included                |
| `NA_ALL_NEUTRALIZED`    | no     | excluded (no numeric) | excluded                |
| `NA_NO_EFFECTIVE_SLOTS` | no     | excluded (no numeric) | excluded                |

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

Stage 4B.2 (canonical artifact authority): V1 publication authority is
`OPERATOR_ATTESTED`, a deliberate operator-trust model labeled "Operator
verified — SNG publication not independently authenticated". The checksum
proves integrity, never authorship. Imports are manual, verified by the 4A
verifier, immutable, and never grade. Revisions import contiguously; a
superseded artifact may later be recorded WITHDRAWN without restoring any
other artifact.

- **Grading approval (future requirement).** An imported artifact cannot
  become authoritative for competitive grading solely through the importing
  operator's attestation. A separate, explicit grading approval is required.
- **DEF crosswalk acknowledgment (future requirement).** Until SNG producer
  fixture confirmation, the grading preflight must require explicit
  acknowledgment even for an otherwise clean DEF crosswalk.

Stage 4B.3 (results and grading authority storage, storage only):

- **Approval policy (option A).** V1 policy is `SINGLE_ADMIN_EXPLICIT`: the
  importing admin may also approve, but only through a separate, explicit,
  timestamped, immutable `WaiverGradeApproval` bound to the run's artifact
  revision, snapshot set, D3 resolution set and output fingerprint, with the
  DEF crosswalk acknowledged. Importing never approves (the database refuses
  an approval in the import transaction). `SEPARATE_APPROVER` is stored and
  enforced (approver differs from importer and run initiator); a week approved
  under it cannot later be approved under `SINGLE_ADMIN_EXPLICIT`.
- **Authority.** Week grading authority moves only through an append-only
  `WaiverGradeAuthorityChange` naming an approved run, plus week, contest and
  board pointers, all checked at commit: all five contests and every graded
  board, or nothing. A regrade appends a new change and new result versions
  and grades; nothing earlier is modified.
- **D3 spelling.** The stored treatment is `NON_PARTICIPANT_ZERO` (the Stage
  4A vocabulary); decision 5's `NONPARTICIPANT_ZERO` means the same value.
- Fingerprints: `docs/waivers-grading-fingerprints.md`.

Stage 4B.3 final hardening (confirmed 2026-10-07):

- All five positions are represented in every official grading run. The
  fixed `WAIVER_EYEQ_V1` contract is unchanged. Full artifact-to-pool
  reconciliation is mandatory in Stage 4B.4. TEAM_CHANGED detection stays in
  application logic. Existing authoritative grades stay visible with a notice
  when their source is superseded or withdrawn; no new apply is accepted
  against a withdrawn or non-current artifact. Approval stays
  `SINGLE_ADMIN_EXPLICIT` with a distinct approval event; `SEPARATE_APPROVER`
  remains supported.
- **Empty eligible position.** A position whose current frozen snapshot has
  no eligible candidate has no contest (opening refuses `EMPTY_ELIGIBLE_POOL`).
  The run represents it with an immutable `WaiverEmptyPositionResult`
  (eligible pool size 0, cited current frozen snapshot, no contest at that
  position); no players, pool rows or grades are fabricated. Each run position
  holds exactly one of a contest result or an empty-position result, and at
  least one contest result. Apply is refused if a contest has since appeared
  at an empty position.
- **Shrunken pool (approved 2026-10-08).** A pre-lock
  snapshot correction can leave an original submission with more calls than
  the corrected available slots `K`. Every call on a corrected-pool member
  still fits in `K`, so only C2-invalidated calls can overflow. Storage keeps
  the board and every call exactly as submitted: invalidated calls stay
  `INVALIDATED_PRE_LOCK` scored misses (0 points, counted in max), never
  silently neutralized. No slot is added: `availableSlots` = the corrected
  `K`. Stored separately: `submittedCallCount`, `scoreableCallCount`,
  `neutralizedCallCount`, `invalidatedCallCount`, `effectiveAvailableSlots`
  (= max(K − neutralized, 0)), `coverageCallCount` (= min(scoreable,
  effective)) and `slotOverflow`. For positive effective slots, coverage =
  `coverageCallCount` / `effectiveAvailableSlots`, so it stays within 0–100%.
  The cap affects coverage only, never call quality or exact hits. Normal
  boards are unaffected (scoreable ≤ effective). The Stage 4A evaluator is
  updated in Stage 4B.4; the storage stage only enforces the rule.

Stage 4B.3 final corrections (approved 2026-10-08):

- **No effective scoring slots: `NA_NO_EFFECTIVE_SLOTS`.** Used only when
  `effectiveAvailableSlots` = 0 and at least one scoreable (non-neutralized)
  call remains. The submission, every call and each call's individual
  outcome (including an EXACT hit) are kept; scoreable calls are never
  converted to neutralized. WaiverEyeQ, coverage, board FP/Call and board
  FP/Available Slot are N/A; no board honor; Played = NO. The stored
  `ungradableReason` is `CORRECTED_POOL_EMPTY` (K = 0) or
  `NEUTRALIZATIONS_CONSUMED_SLOTS` (K > 0, neutralized calls ≥ K), and the
  honor-ineligible reason is `NO_EFFECTIVE_SLOTS`. It is distinct from
  `NA_ZERO_CALL` (no calls) and `NA_ALL_NEUTRALIZED` (no scoreable call);
  all three are database-enforced from the board's counts.
- **Existing contest, empty corrected pool.** When no contest exists, the
  position uses `WaiverEmptyPositionResult`. When a contest exists but its
  corrected eligible pool is empty, the contest and its historical
  submissions are kept (nothing is deleted or invalidated) and the run uses a
  zero-field `WaiverContestResult`: eligible, effective pool, effective field
  and effective available slots all 0, plus only the invalidated called
  players (no fabricated players or slots). Its boards are graded against
  K = 0: an all-neutralized board stays `NA_ALL_NEUTRALIZED`, a board with
  scoreable calls is `NA_NO_EFFECTIVE_SLOTS` (`CORRECTED_POOL_EMPTY`), and a
  zero-call board stays `NA_ZERO_CALL`. An empty-position record is refused
  while the contest exists, so five-position coverage holds.
- **Zero-call board with zero slots (approved 2026-10-08).** `NA_ZERO_CALL`,
  Played = YES, WaiverEyeQ, FP/Call and FP/Available Slot all NULL, no honor.
  Ordinary zero-call boards with available slots keep FP/Available Slot 0.00.
  No new result kind.
- **Set-based contest-result validation.** Each contest result is validated
  once at commit (or `SET CONSTRAINTS ... IMMEDIATE`) in one pass: exact
  eligible and invalidated membership, effective pool size, competition
  ranks (1, 1, 3, negative totals included) computed with `rank()` over the
  post-treatment RANKED rows (D3 and neutralization exclusions are applied
  before ranking), and the current D3 set. Pool rows have no deferred check
  of their own; their guard refuses any row the pass could not see (written
  in a later transaction, or after the pass ran in this one).
- **Approval separation.** The database refuses a grading approval whose
  artifact row was inserted by the current transaction or any of its
  subtransactions (savepoints, nested savepoints, PL/pgSQL exception
  blocks), using the row's `xmin` widened to 64 bits and `pg_xact_status`
  (shared helper `waiver_xmin_is_current_transaction`).

## Timing and preflight

15. **Week 5.** Not graded until artifact authority, durable results and
    orchestration/admin preview+apply all exist, and an ACCEPTED SNG Week 5
    artifact is available.
16. **Pool sizes.** The read-only preflight shows the actual eligible frozen
    pool size for every position. Never assume 3/5 availability.
