# WaiverEyeQ Grading Lifecycle V1 — Completion Report

**Branch:** `feat/waivereyeq-rankeyeq-results-grading-v1`  
**Base:** `72d1116a2fec451a28570cc5add6a96b3e5defd3`  
**Status:** Dual-source storage complete on feature branch. **Not merged. Not deployed. No Production grading, contest-lock stamp, or publication.**

## 1. Dual-source storage (`SOURCE_UNSUPPORTED` resolved)

Migration `20261021120000_waivers_dual_source_grading` makes grading storage accept exactly one verified source:

| Table | SNG | RankEyeQ |
| --- | --- | --- |
| `WaiverContestResult`, `WaiverGradeRun`, `WaiverGradeApproval`, `WaiverContestResultAuthority` | `artifactRowId` set | `rankEyeQSnapshotId` set |

- Database XOR: `num_nonnulls("artifactRowId", "rankEyeQSnapshotId") = 1`
- Existing SNG rows keep `artifactRowId`; no destructive backfill
- Superseded / non-ACCEPTED RankEyeQ snapshots cannot be stored, approved, applied, or published (`SOURCE_SUPERSEDED` / DB guards)
- `WAIVER_EYEQ_V1` unchanged
- `isWaiverGradingSourceStorable` is true for both `SNG_ARTIFACT` and `RANKEYEQ_SNAPSHOT`

`SOURCE_UNSUPPORTED` remains only as a defensive error code; both product sources are storable.

## 2. Week 6 Production lifecycle (read-only)

Week id `cmv7egzsb000006l7axfb8mvx`. All five contests share `locksAt = 2026-10-15 03:00:00 UTC` (= approved Wed Oct 14, 2026, 10:00 PM CDT).

| Position | Contest status | Boards | Board status | Call counts (current rev) |
| --- | --- | --- | --- | --- |
| QB | LOCKED | 8 | 8 LOCKED | all 3 |
| WR | LOCKED | 8 | 8 LOCKED | 3 (commish) + 5×7 AI |
| RB | OPEN | 8 | 8 SUBMITTED | all 3 |
| TE | OPEN | 8 | 8 SUBMITTED | all 3 |
| DEF | OPEN | 8 | 8 SUBMITTED | 2 (deepseek) + 3×7 |

- **40 boards total** (8 per position × 5). Prior “8 per position” matches; **16 locked** = QB+WR only.
- Profiles: `commish` + 7 AI (`claude`, `deepseek`, `gemini`, `gpt`, `grok`, `mistral`, `perplexity`). **`llama` has zero Week 6 boards** (not a lock defect).
- Every `submittedAt` is before `locksAt` / the Oct 14 10pm CDT deadline. No late entries, competitive overrides, or post-lock revisions. Draft revisions exist only as pre-submit history (commish).
- Root cause: **lazy lock stamp not executed** for RB/TE/DEF. `ensureWaiverContestLocked` stamps `OPEN→LOCKED` and `SUBMITTED→LOCKED` with `lockedAt = locksAt` only when invoked after `locksAt`. QB/WR were stamped that way; RB/TE/DEF were not. Play layer already treats past-`locksAt` as locked for writes (`waiverPhaseAt`), so this is a **database-status / lifecycle-execution gap**, not a display bug and not wrong submission data.
- Stamp readiness: all 24 OPEN-contest SUBMITTED boards have a pre-`locksAt` SUBMISSION revision (`submitted_MISSING_prelock_revision = 0`).

### Proposed correction (owner approval required; not executed)

1. Call production `ensureWaiverContestLocked` for:
   - RB `cmv7kj0l7000106jtdvzcy5xm`
   - TE `cmv7kj0nn000306jt5tz2ovju`
   - DEF `cmv7kj0ov000406jtc7wqt6g8`
2. Expect: each returns `{ locked: true, stampedSubmissions: 8 }`; contests → LOCKED; 40 boards LOCKED; `lockedAt = locksAt`.
3. Read-only verify; stop. Do **not** backdate submissions, create picks, late-entry, or grade.

## 3. Staging (disposable DB)

Database `rankiq_glv1_stage` (local Postgres): `prisma migrate deploy` through `20261021120000_waivers_dual_source_grading`, then representative fixture lifecycle pack:

| Suite | Result |
| --- | --- |
| Dual-source schema + foundation | PASS |
| `lifecycle-rankeyeq.integration.test.ts` (store→approve→apply→publish→regrade/supersede + XOR guards) | PASS |
| `lifecycle.integration.test.ts` (SNG path) | PASS |
| Preview / contest-result-rankeyeq / rankeyeq-results / grading-hardening / grading-authority / AI boards / lock-authority | PASS |
| **Total** | **14 files, 224 passed** |

Covers RankEyeQ snapshot build+commit, zero-point decisions, frozen identities via fixtures, five-position preview (DEF empty-pool when unused), D3 on SNG path, versioned runs, approval/apply/publish separation, supersession, SNG compatibility, idempotency, historical week isolation. Grading services do not mutate Rankings WeekStats or original waiver call rows.

**Not run:** Production-cloned Week 5/6 end-to-end grading on a dump (would require a separate approved clone). Week 6 Production staging grading is blocked until the three contests are stamped LOCKED.

## 4. Validation

| Check | Result |
| --- | --- |
| Focused staging pack (224) | PASS |
| `tsc --noEmit` | PASS (no errors) |
| `eslint` | Pre-existing error in `stat-components-full-volume.staging.test.ts` (unrelated to this branch) |
| `npm run build` | PASS |

## 5. Remaining blockers

1. Week 6 RB/TE/DEF still OPEN in Production until owner-approved lock stamp.
2. No Production-cloned W5/W6 grading rehearsal yet.
3. RankEyeQ snapshot commit still has no admin UI/route (service API only).
4. Called-outside-pool `ABSENT_UNRESOLVED` can still block ACCEPTED snapshots when WeekStats are missing.
5. Week 5 pre-4B.1 NULL frozen identity keys remain advisory.
6. Publication is append-only (no unpublish).

## 6. GO / NO-GO

### NO-GO for Production deploy / grading / publication / contest-lock changes

Owner has not approved merge or deploy. Week 6 lock stamp and any Production grading require separate approval.

### CONDITIONAL GO for merging **code only** (still no Production ops)

Safe when owner approves a code-only merge: dual-source storage + RankEyeQ lifecycle are implemented and tested on disposable DB; SNG historical path preserved.

**Stop:** no merge, deploy, Production snapshot commit, contest lock stamp, grading, or publication without separate owner approval.
