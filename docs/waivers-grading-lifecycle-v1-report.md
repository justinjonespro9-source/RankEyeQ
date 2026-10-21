# WaiverEyeQ Grading & Publication V1 — Feature Report

**Branch:** `feat/waivereyeq-rankeyeq-results-grading-v1`  
**Status:** Implemented on isolated feature branch. **Not merged. Not deployed. No Production grading.**

## 1. Results-source architecture

| Source | Schema | Tables | Authority |
| --- | --- | --- | --- |
| SNG Labs | `sng-canonical-nfl-weekly-performance/1` | `WaiverCanonicalArtifact*` | `OPERATOR_ATTESTED` |
| RankEyeQ | `rankeyeq-final-week-stats/1` | `WaiverRankEyeQResultsSnapshot`, `WaiverRankEyeQParticipationDecision` | `RANKEYEQ_OPERATOR_ATTESTED` |

RankEyeQ reads finalized `PlayerWeekStat` / `DefenseWeekStat` (`manual`, non-provisional, `FANTASYTRACK_NFL_HALF_PPR_V2`) joined by `RankableEntry.id` / frozen identity. It never re-scores FantasyTrack lines and never claims to be an SNG artifact.

## 2. Participation-review workflow

Zero fantasy points → `PENDING_ZERO_REVIEW` (operator queue).  
Missing stats → `ABSENT_UNRESOLVED` (not zero; blocks ACCEPTED).  
Operator decisions: `PLAYED_ZERO` → `PARTICIPATED_ZERO`; `DID_NOT_PLAY` → `VERIFIED_NON_PARTICIPANT`/`DNP` with evidence.

## 3. Admin screens & actions

- `/admin/waivers/grading` — source select (SNG / RankEyeQ), preview, create run, approve, apply, publish
- Server actions in `lib/waivers/grading/actions.ts` (admin-gated, audited)
- Preview is SELECT-only
- Apply sets week authority; **Publish** is a separate stage (`WaiverWeekGradePublication`) required for public leaderboards

## 4. Public results

`loadGradedWaiverBoards` reads `WaiverWeekGradeAuthority` + board grades **only when published**.

## 5. Production discovery (read-only)

| Week | Eligible pool | Contests | Locked boards | Grade runs | SNG artifacts | Final WeekStats |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | **102** | 5 LOCKED | **45** (9×5) | 0 | 0 | 473 player / 30 DEF |
| 6 | **87** | QB+WR LOCKED; **RB/TE/DEF OPEN** | **16** (QB 8 + WR 8) | 0 | 0 | 428 player / 28 DEF |

## 6. Test report (local disposable DB / unit)

| Suite | Result |
| --- | --- |
| `lib/waivers/rankeyeq-results/*` | PASS |
| `contest-result-rankeyeq.test.ts` | PASS (23) |
| `grading/lifecycle.integration.test.ts` | PASS |
| `grading/preview.integration.test.ts` | PASS |
| `results/grading-authority.integration.test.ts` | PASS |
| Focused unit pack (152 tests) | PASS |

Week 5/6 **Production staging grading** was **not** executed (stop condition + dual-source store gap).

## 7. Remaining blockers / decisions

1. **Dual-source storage** — RankEyeQ preview works; `storeWaiverWeekGradingRun` refuses `RANKEYEQ_SNAPSHOT` with `SOURCE_UNSUPPORTED` until `WaiverContestResult` / `WaiverGradeRun` accept `rankEyeQSnapshotId` XOR `artifactRowId` and DB triggers are patched.
2. **Week 6 contest lock** — RB, TE, DEF still `OPEN` (16/40 boards locked). Cannot grade full Week 6 until contests lock.
3. **Called-outside-pool ABSENT_UNRESOLVED** — missing WeekStat for invalidated called players blocks ACCEPTED snapshot; product may want a softer rule.
4. **Week 5 identity** — pre-4B.1 NULL frozen keys remain advisory (`IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT`); match uses live RankableEntry.
5. **No unpublish** — publication is append-only.
6. **MHJ ALT-1** — RankEyeQ snapshot reads attributed WeekStat as stored; does not rewrite ContestEntry/team/game.

## 8. GO / NO-GO

### NO-GO for Production RankEyeQ grading/publication of Weeks 5–6

Reasons: dual-source store not landed; Week 6 contests incomplete; no disposable staging E2E against Production-cloned data.

### CONDITIONAL GO for merging this feature branch (code only)

Safe to merge when owner approves **code merge only** (still no Production grading):

- SNG grading lifecycle (store → approve → apply → publish) + leaderboard wiring is complete and tested
- RankEyeQ snapshot build / participation review / grading **preview** is complete and tested
- Follow-up PR required: dual-source FK + trigger patches + Week 6 lock ops + staging E2E

**Stop:** no merge, deploy, Production snapshot commit, grading or publication without separate owner approval.
