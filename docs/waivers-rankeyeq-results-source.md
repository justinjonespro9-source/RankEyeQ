# Waivers — RankEyeQ final-week-stats results source

Product-approved second source of Waiver results: `rankeyeq-final-week-stats/1`.
It lets WaiverEyeQ grade a week from RankEyeQ's own, already-calculated final
week stats. It is **not** SNG, never claims to be SNG, and does not replace the
SNG canonical artifact path (`sng-canonical-nfl-weekly-performance/1`, imported
through `lib/waivers/artifacts`).

Code: `lib/waivers/rankeyeq-results/`. Storage: `WaiverRankEyeQResultsSnapshot`
and `WaiverRankEyeQParticipationDecision` (migration
`20261013120000_waivers_rankeyeq_results_snapshot`).

## SNG stays distinct

| | SNG canonical artifact | RankEyeQ final-week-stats |
| --- | --- | --- |
| Schema version | `sng-canonical-nfl-weekly-performance/1` | `rankeyeq-final-week-stats/1` |
| Scoring | SNG ruleset `SNG_NFL_HALF_PPR@1` (SNG computes) | `FANTASYTRACK_NFL_HALF_PPR_V2` (RankEyeQ already computed) |
| Authority basis | `OPERATOR_ATTESTED` (SNG publication) | `RANKEYEQ_OPERATOR_ATTESTED` (RankEyeQ participation review) |
| Identity | players `nflcom-bootstrap`, DEF `sng-team` via team crosswalk | players `nflcom-bootstrap`, DEF `def-{TEAM}`; **no SNG crosswalk** |
| Tables | `WaiverCanonicalArtifact*` | `WaiverRankEyeQResultsSnapshot`, `WaiverRankEyeQParticipationDecision` |
| Grading input | `VerifiedSngCanonicalArtifact` | `VerifiedRankEyeQResultsSource` (`ledger.ts`) |
| Series key | `NFL:REG:{season}:{week}:SNG_NFL_HALF_PPR@1:…` | `NFL:{season}:{week}:RANKEYEQ_FINAL_WEEK_STATS@1:FANTASYTRACK_NFL_HALF_PPR_V2` |

The two sources share no tables, schema versions, series keys, checksums or
attestation text. A RankEyeQ snapshot never carries an SNG artifact id,
acceptance id or `sng-*` key, and the verifier rejects the SNG schema version,
SNG ruleset and SNG attestation version. The snapshot attestation says in
plain words that it is not an SNG artifact.

The snapshot stays independent of SNG, but grading storage is dual-source:
`WaiverContestResult`, `WaiverGradeRun`, `WaiverGradeApproval` and
`WaiverContestResultAuthority` reference **exactly one** verified source, either
`WaiverCanonicalArtifact` (`artifactRowId`) or `WaiverRankEyeQResultsSnapshot`
(`rankEyeQSnapshotId`); see "Dual-source grading storage". `WAIVER_EYEQ_V1`,
locked boards and frozen snapshots are untouched.

## Provenance model

```
Week (COMPLETE, fantasyScoringVersion = FANTASYTRACK_NFL_HALF_PPR_V2)
 └─ current FROZEN WaiverSnapshot  ── eligible CANDIDATE entries (the pool)
     └─ frozen identity: identityProviderAtFreeze + identityExternalIdAtFreeze
         └─ RankableEntry.id ──► PlayerWeekStat / DefenseWeekStat
                                   (provider = manual, week = this week,
                                    isProvisional = false, scoringVersion = V2)
                                   └─ fantasyPoints ──toFpHundredths──► pointsHundredths
```

Everything is read, never re-scored: `fantasyPoints` is converted with
`toFpHundredths` (a value that is not representable in hundredths blocks
instead of rounding). RankEyeQ `PlayerWeekStat` / `DefenseWeekStat` writers are
not modified.

### Preconditions (week-level blockers; the build returns no content)

- `Week.status = COMPLETE` and `Week.fantasyScoringVersion = FANTASYTRACK_NFL_HALF_PPR_V2`.
- Every non-`CANCELED` `NflGame` of the week is `FINAL`.
- The week has a current `FROZEN` waiver snapshot; every `WaiverContest` of the
  week is `LOCKED` and pinned to that snapshot.

### Matching

Only by `RankableEntry.id` (the WeekStat `rankableEntryId`) and the frozen
`provider + externalId` (`nflcom-bootstrap`; DEF is `def-{TEAM}` for the
frozen team). The live `RankableEntry` identity must still equal the frozen one.
Names, `externalPlayerId` and abbreviation similarity are never used. Rows
frozen before the identity key existed fall back to the live identity with an
advisory (`IDENTITY_NOT_FROZEN`), as the SNG preflight does.

### Participation classification

| Situation | State | Disposition | Proof | Points |
| --- | --- | --- | --- | --- |
| Final WeekStat, fantasy points ≠ 0 | `PARTICIPATED_WITH_STATS` | `PLAYED` | `WEEK_STAT_LINE` | hundredths |
| Final WeekStat, fantasy points = 0 | `PENDING_ZERO_REVIEW` | `UNRESOLVED` | `NONE` | null |
| No usable final WeekStat (missing, duplicate, provisional, not V2, unrepresentable, game not FINAL / unlinked, identity mismatch) | `ABSENT_UNRESOLVED` | `UNRESOLVED` | `NONE` | null |
| Operator `PLAYED_ZERO` on a pending zero | `PARTICIPATED_ZERO` | `PLAYED` | `OPERATOR_PLAYED_ZERO_REVIEW` | `0` |
| Operator `DID_NOT_PLAY` on a pending zero | `VERIFIED_NON_PARTICIPANT` | `DNP` | `OPERATOR_DID_NOT_PLAY_REVIEW` | null |

- **Zero never infers DNP.** A zero fantasy-point line is ambiguous (played and
  scored nothing vs. did not play); only an operator decision with an evidence
  reference, reason, operator id and timestamp resolves it
  (`participation.ts`). A negative line is a real stat line, not a zero.
- **Missing is not zero.** `ABSENT_UNRESOLVED` can never be turned into a zero
  or a DNP by a decision (`UNRESOLVED_CANNOT_BE_ZEROED`); the WeekStat must be
  corrected and the snapshot rebuilt.
- A positive stat line cannot be overridden by a decision.

## Verification (`verify.ts`)

`verifyRankEyeQFinalWeekStatsSnapshot` recomputes the content checksum
(sha256 over key-sorted canonical JSON with safe integers only; insensitive to
jsonb key reordering), checks every pin (`schemaVersion`, `sourceKind`,
`scoringVersion`, `rankingsWeekStatus = COMPLETE`, `sourceWeekId`, `statProvider`,
series key, authority basis, attestation version), locked/pinned contests,
participant identity, ordering, duplicates, state/disposition/proof/points
coherence, decision evidence for operator-resolved participants, stat evidence
(manual, non-provisional, V2, FINAL games) for scorable ones, and the summary
counts. For `ACCEPTED` publication it additionally refuses any
`PENDING_ZERO_REVIEW` or `ABSENT_UNRESOLVED` participant.
`unresolvedCount` counts both unresolved states; `pendingZeroCount` only the
zero reviews. The database guard also requires both to be `0` for `ACCEPTED`.

## Ledger (`ledger.ts`)

`projectRankEyeQResultsSource` turns a verified snapshot into
`VerifiedRankEyeQResultsSource`, indexed by frozen `nflcom-bootstrap +
externalId` (DEF `def-{TEAM}`), and `matchRankEyeQResultsIdentity` does the
exact match (also requiring the `rankableEntryId` to agree).
`classifyRankEyeQParticipant` maps participants into the existing
`WaiverCanonicalClass` vocabulary: `RANKED`, `NON_PARTICIPANT`, `BLOCKED`.
RankEyeQ has no cancelled/moved/bye dispositions, so there is no
`SYSTEMIC_NEUTRALIZE` or `SNAPSHOT_CONFLICT` class from this source.

## Store (`store.ts`)

- `previewRankEyeQFinalWeekStats({ weekId, decisions })`: SELECT-only. Returns
  the content, checksum, review items (zero reviews and unresolved blockers),
  rejected decisions, next revision and a `previewFingerprint`.
- `commitRankEyeQFinalWeekStats(...)`: runs only when called. In one
  transaction: admin check, week lock, server-side preview rebuild (fingerprint
  must match, zero blockers), one immutable `WaiverRankEyeQResultsSnapshot`
  (content JSON + checksum), its `WaiverRankEyeQParticipationDecision` rows, the
  predecessor's `ACCEPTED → SUPERSEDED` transition and an admin audit row. An
  identical re-commit writes nothing.
- `loadVerifiedRankEyeQResultsSource(db, weekId)`: reloads the current `ACCEPTED`
  snapshot, re-verifies it against its stored checksum and metadata, and projects it.

The snapshot build/commit is not wired to a UI, route or server action yet; the
grading preview is reachable from the grading admin page (RankEyeQ source).

## Grading preview (wired)

`loadWaiverWeekGradingPreviewFromRankEyeQ` (`grading/source.ts`, delegating to
`grading/preview-rankeyeq.ts`) now returns a real `READY` / `BLOCKED`
`WaiverWeekGradingPreview` instead of `NOT_IMPLEMENTED`, and
`isWaiverRankEyeQResultsAvailable()` is `true`. It mirrors the SNG preview
(SELECT only): the week's current `ACCEPTED` snapshot is reloaded, re-verified
and projected, then each contest's pinned snapshot and locked boards go through
`buildWaiverContestResultFromRankEyeQ` (`grading/contest-result-rankeyeq.ts`) and
the same `assembleWaiverWeekGrading` engine (`WAIVER_EYEQ_V1` untouched). The
shared position/board loading lives in `loadWaiverWeekPositions` (`preview.ts`).

- No accepted snapshot, failed verification, a pinned `snapshotId` that is not the
  current one, or a source built from another waiver snapshot → a `BLOCKED`
  preview with explicit issues (never a fallback to SNG).
- Members are the eligible pool plus players called on locked boards outside it,
  matched by exact frozen identity (`matchRankEyeQResultsIdentity`). Treatments:
  `PARTICIPATED_WITH_STATS` / `PARTICIPATED_ZERO` → `RANKED` (a played zero is a
  real 0 score), `VERIFIED_NON_PARTICIPANT` → `NON_PARTICIPANT_ZERO` (DNP),
  non-eligible called players → `INVALIDATED_PRE_LOCK`. Ranks are the shared
  competition ranks (1, 1, 3) over integer hundredths of the post-treatment
  `RANKED` rows.
- No SNG result set exists, so the `sng*` columns carry RankEyeQ equivalents:
  `sngParticipantId = rankeyeq:{rankableEntryId}`, `sngResultFingerprint` = hash
  of participant state + points (ranked only), `sngResultSetChecksum` = per-position
  hash of the source participants, `canonicalPositionRank` = competition rank among
  the source's ranked participants of the position. The grading "artifact" is
  `{ rowId: snapshotRowId, artifactId: rankeyeq-final-week-stats:{contentChecksum},
  seriesKey, revision, contentChecksum }`.
- RankEyeQ has no bye / cancelled / moved dispositions: there is no D2
  neutralization or D3 conflict, and the applied-resolution set is always empty.

### Called players outside the eligible pool

`build.ts` now also includes players called on the contests' locked boards that
are not eligible pool members (the `INVALIDATED_CALLED_PLAYER` category), under
the same frozen-identity and WeekStat rules. A player the snapshot still holds
as an ineligible entry uses that entry; one it no longer holds uses the called
entry (`CALLED_IDENTITY_AMBIGUOUS` blocks if boards called it under two
identities). Their stat lines still need to be final: a missing line is
`ABSENT_UNRESOLVED` (never zero) and a zero line goes to operator review, like
any pool member. Snapshots built before a week has such calls are unchanged; a
new build for a week that has them yields a new revision (new checksum). Grading
blocks with `PARTICIPANT_NOT_IN_LEDGER` for a called player an older accepted
snapshot lacks, so rebuild and accept a new revision.

## Dual-source grading storage

Migration `20261021120000_waivers_dual_source_grading` lets a grading run be
stored from either verified source (`storeWaiverWeekGradingRun` no longer
refuses `RANKEYEQ_SNAPSHOT`; `isWaiverGradingSourceStorable` is true for both):

| Table | SNG source | RankEyeQ source |
| --- | --- | --- |
| `WaiverContestResult`, `WaiverGradeRun`, `WaiverGradeApproval`, `WaiverContestResultAuthority` | `artifactRowId` set, `rankEyeQSnapshotId` null | `rankEyeQSnapshotId` set, `artifactRowId` null |

- **XOR is database-enforced**: `*_source_xor_check` CHECK constraints
  (`num_nonnulls("artifactRowId", "rankEyeQSnapshotId") = 1`) on all four tables.
  Existing rows all carry `artifactRowId`, so nothing is backfilled.
- `artifactContentChecksum` keeps its column name and is now the **source content
  checksum**: the SNG artifact's, or the snapshot's `rankeyeq-final-week-stats/1`
  checksum. The snapshot FKs are `ON DELETE RESTRICT`.
- The trigger functions `waiver_contest_result_guard`, `waiver_grade_run_guard`,
  `waiver_grade_approval_guard`, `waiver_grade_authority_change_guard`,
  `waiver_grade_authority_pointer_guard`, `waiver_week_grade_publication_guard`
  (and the NULL-safe D3 comparison in `waiver_pool_result_guard`) are
  `CREATE OR REPLACE`d. A RankEyeQ source requires: the snapshot's `weekId`
  matches, `publicationState = 'ACCEPTED'` and `contentChecksum` equals the stored
  source checksum. A run's contest results must share the run's exact source.
  Authority change, contest pointers and publication re-require an `ACCEPTED`
  source (`waiver_grading_source_accepted`), exactly as for SNG.
- **Approval** of a RankEyeQ run stores `artifactRevision` = the snapshot revision,
  `artifactImportedByUserId` = the snapshot's `builtByUserId` (the importer
  equivalent for `SEPARATE_APPROVER`), `defCrosswalkVersion = 'rankeyeq-native/1'`
  with `defCrosswalkAcknowledged = true` meaning "not applicable, acknowledged",
  and RankEyeQ-specific attestation text/version
  (`rankeyeq-waiver-grading-approval/rankeyeq-results-1`). The approval cannot be
  recorded in the snapshot's commit transaction. An SNG approval can never carry
  the native crosswalk marker (CHECK).
- Later stages re-verify the run's **own** source: `assertRunMatchesLiveInputs`
  reloads the pinned RankEyeQ snapshot (or the SNG artifact). A newer ACCEPTED
  snapshot makes older RankEyeQ runs `SOURCE_SUPERSEDED`; checksum or input drift
  is `STALE`. A RankEyeQ run is never checked against SNG, and vice versa.
- `WaiverConflictResolution` (D3) stays **SNG-only**: it binds an SNG artifact
  revision. RankEyeQ has no BYE disposition, so no D3 resolution can apply to a
  RankEyeQ-sourced result (`waiver_contest_result_resolutions_current` joins on
  `artifactRowId` and finds none).

## Known gaps / follow-ups

- The RankEyeQ snapshot build/commit is still not wired to a UI, route or server
  action (commit it with `commitRankEyeQFinalWeekStats`).
- Column names `artifactRowId` / `artifactContentChecksum` / `artifactRevision` /
  `artifactImportedByUserId` / `defCrosswalk*` on the grading tables keep their SNG
  names for minimal churn; for a RankEyeQ source they hold the source checksum,
  snapshot revision, snapshot builder and the `rankeyeq-native/1` N/A marker.
- `WaiverContestResultAuthority.rankEyeQSnapshotId` has no foreign key (like its
  `artifactRowId`); the pointer guard requires it to equal the contest result's
  source.
- Staging/Production validation of the migration is still to do (it was exercised
  against the local database only).
