# Waivers results and grading fingerprints (Stage 4B.3)

Implementation: `lib/waivers/results/fingerprints.ts` (pure). Version tag:
`rankeyeq-waiver-grading-fp/1`. Any change to a payload, ordering rule or
envelope requires a new version tag; stored fingerprints are never recomputed
in place.

## Envelope and serialization

Every fingerprint is

```
canonicalExportChecksum({ v: "rankeyeq-waiver-grading-fp/1", kind, ...payload })
```

`canonicalExportChecksum` is the Stage 4A `sng-canonical-json/1` checksum:
SHA-256 (lowercase hex) of canonical JSON with object keys sorted by code
unit, arrays kept in the order given, safe integers only, explicit `null`s,
and no `undefined`. The `kind` string separates domains so equal payloads of
different kinds never collide.

## What is excluded

- Generated row ids of results/grading rows (`WaiverContestResult.id`,
  `WaiverPoolResult.id`, `WaiverConflictResolution.id`, grade ids).
  A D3 resolution is referenced by `{ conflictKey, sequence }`.
- Timestamps (`createdAt`, `approvedAt`, `recordedAt`, `resolvedAt`).
- Operator identity, reasons and evidence references.
- Run numbers and result versions (a replay must reproduce the same
  fingerprint regardless of how many runs preceded it).

Immutable competitive identities **are** included: frozen snapshot entry ids,
`RankableEntry` ids, submission, revision and call ids, SNG participant ids,
artifact ids and checksums. These rows are themselves immutable, so including
them binds a grade to the exact board and pool it graded.

## Deterministic ordering

Collections are sorted inside the fingerprint functions, so caller iteration
order never matters:

| Collection                    | Order                                       |
| ----------------------------- | ------------------------------------------- |
| Week positions                | `QB, RB, WR, TE, DEF`; exactly once each    |
| D3 resolutions in a set       | `conflictKey` (one current per conflict)    |
| SNG participants              | `participantId`                             |
| Pool rows                     | `category`, then `rankableEntryId`          |
| Called players                | de-duplicated, then code unit               |
| Board calls                   | `slot`; must be contiguous from 1           |
| Boards in a run / week output | `submissionId`                              |

All string sorts compare UTF-16 code units (never locale collation).

## Fingerprint kinds

| kind                        | Stored in                                      | Binds                                                                                              |
| --------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `artifact-identity`         | (component)                                    | series key, revision, SNG artifact id, content checksum                                            |
| `snapshot-identity`         | `WaiverContestResult.snapshotFingerprint`      | season, week, snapshot version, frozen `entriesFingerprint`                                        |
| `snapshot-set`              | `WaiverGradeRun.snapshotSetFingerprint`        | the five positions' snapshots (contest pin, or the frozen snapshot an empty position cites)        |
| `empty-position-result`     | `WaiverEmptyPositionResult.resultFingerprint`  | policy version, position, cited snapshot, eligible pool size 0                                     |
| `conflict-resolution-input` | `WaiverConflictResolution.inputFingerprint`    | artifact, position, conflict key and kind, frozen entry, SNG participant                           |
| `resolution-set`            | contest result / grade run / approval          | the applied current resolutions (`conflictKey`, `sequence`, kind, resolution)                      |
| `contest-source`            | `WaiverContestResult.sourceFingerprint`        | artifact, position, SNG result-set checksum, every interpreted participant fact                     |
| `pool-row`                  | `WaiverPoolResult.rowFingerprint`              | the row's identity, SNG facts, treatment, FP, pool rank, precedence, resolution key, invalidation   |
| `contest-result`            | `WaiverContestResult.resultFingerprint`        | sizes (field, eligible, effective pool/field/slots, invalidated) and every pool row fingerprint     |
| `contest-result-input`      | `WaiverContestResult.inputFingerprint`         | policy version, position, artifact, snapshot, source, resolution set, players called on locked boards |
| `call-grade-input`          | `WaiverCallGrade.inputFingerprint`             | slot, call, frozen entry, player, pool row fingerprint, result field size                          |
| `call-grade-output`         | `WaiverCallGrade.outputFingerprint`            | every stored call outcome                                                                          |
| `board-grade-input`         | `WaiverBoardGrade.inputFingerprint`            | submission, locked revision and its fingerprint, position, contest result, available slots, calls  |
| `board-grade-output`        | `WaiverBoardGrade.outputFingerprint`           | every stored board outcome (including invalidated, coverage and slot-overflow counts, result kind and ungradable reason) plus the call output fingerprints in slot order |
| `grade-run-input`           | `WaiverGradeRun.inputFingerprint`              | ruleset and scoring versions, season/week, artifact, snapshot set, resolution set, five positioned results, board inputs |
| `week-grade-output`         | `WaiverGradeRun.outputFingerprint`             | run input plus the five positioned result fingerprints and every board output                      |

Each of the five positioned results carries a `kind`: `CONTEST_RESULT`
(contest result input and result fingerprints) or `EMPTY_ELIGIBLE_POOL`
(input `null`, the empty-position result fingerprint). At least one position
must be a contest result. The kind is hashed, so an empty position can never
share identity with a contest result.

## Idempotency and approval binding

- `WaiverContestResult (contestId, inputFingerprint)` and
  `WaiverGradeRun (weekId, inputFingerprint)` are unique: identical inputs
  cannot be stored twice, and a replay recomputes the same fingerprints.
- A grading approval copies the run's artifact revision and checksum,
  `snapshotSetFingerprint`, `resolutionSetFingerprint`, `inputFingerprint`
  and `outputFingerprint`; the database verifies every copy. The authority
  change and the week pointer carry the same `outputFingerprint`.

## What the database verifies

The database cannot compute SHA-256 over canonical JSON, so fingerprints are
stored as computed by the pure module, with format checks (`^[a-f0-9]{64}$`)
and exact-copy checks where one row binds another. Determinism is proven by
tests (permutation invariance and rebuild equality). Full replay
verification against the stored artifact text is a later-stage tool.
