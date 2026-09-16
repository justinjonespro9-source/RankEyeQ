/**
 * Read-only Week 1 repair planning.
 * Builds exact snapshot / grading / lifecycle plans without writing.
 */
import type { PrismaClient } from "@/lib/generated/prisma/client";
import {
  isGradeablePickCount,
  submissionDepthFromScoring,
} from "@/lib/contest-defaults";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { evaluateReconstructionEligibility } from "@/lib/consensus-snapshot-rebuild";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export const WEEK1_CANONICAL_LOCK = new Date("2026-09-13T15:00:00.000Z");

export type SegmentKey = "HUMAN" | "AI" | "EXPERT" | "CREATOR" | "PUBLISHER";

export type SnapshotSampleCounts = {
  sampleSizeAll: number;
  sampleSizeHuman: number;
  sampleSizeAi: number;
  sampleSizeExpert: number;
  sampleSizeCreator: number;
  sampleSizePublisher: number;
};

export type OverDepthGradePlan = {
  displayName: string;
  submissionId: string;
  status: string;
  pickCount: number;
  rankingDepth: number;
  action: "GRADE_TOP_N";
  scoringDepthUsed: number;
};

export type GradeSkipPlan = {
  displayName: string;
  submissionId: string;
  status: string;
  pickCount: number;
  rankingDepth: number;
  reason: string;
};

export type SnapshotRebuildPositionPlan = {
  position: string;
  contestId: string;
  existingSnapshotId: string | null;
  existingLockedAt: string | null;
  existingSampleCounts: SnapshotSampleCounts | null;
  existingEntryCount: number;
  replacementLockedAt: string;
  reconstructedCounts: Record<SegmentKey, number>;
  allBallots: number;
  contributingGroups: SegmentKey[];
  contributingGroupCount: number;
  wouldDeleteSnapshotRows: number;
  wouldDeleteSnapshotEntries: number;
  wouldCreateSnapshotRows: number;
  wouldCreateSnapshotEntries: number;
  qualifyingSubmissionIds: string[];
};

export type GradingPositionPlan = {
  position: string;
  contestId: string;
  currentStatus: string;
  rankingDepth: number;
  reserveCount: number;
  rankedEntryCount: number;
  consideredCount: number;
  willGradeCount: number;
  skipCount: number;
  alreadyGradedCount: number;
  skipReasons: Record<string, number>;
  overDepthBoards: OverDepthGradePlan[];
  skips: GradeSkipPlan[];
  expectedFinalStatus: "FINAL" | "BLOCKED_MISSING_ACTUAL_RANKS";
  normalizedScoreWrites: number;
};

export type Week1RepairPlan = {
  weekId: string;
  weekLabel: string;
  weekStatus: string;
  canonicalLock: string;
  snapshotPlans: SnapshotRebuildPositionPlan[];
  gradingPlans: GradingPositionPlan[];
  lifecycle: {
    expectedContestStatuses: Record<string, string>;
    expectedWeekStatus: "COMPLETE" | "BLOCKED";
    totalGradedSubmissions: number;
    totalNormalizedScoreWrites: number;
    totalSkippedIncompletes: number;
    pickMutations: false;
    actualRankFantasyPointsMutations: false;
  };
  allQualifyingSubmissionIds: string[];
};

function segmentLabel(input: {
  profileType: string;
  sourceKind: string | null;
}): SegmentKey | "OTHER" {
  if (input.profileType === "HUMAN") return "HUMAN";
  if (input.profileType === "AI") return "AI";
  if (input.profileType === "CREATOR") return "CREATOR";
  if (input.profileType === "BENCHMARK") {
    if (
      input.sourceKind === "PUBLISHER_CONSENSUS" ||
      input.sourceKind === "SITE_CONSENSUS"
    ) {
      return "PUBLISHER";
    }
    return "EXPERT";
  }
  return "OTHER";
}

export function emptySegmentCounts(): Record<SegmentKey, number> {
  return { HUMAN: 0, AI: 0, EXPERT: 0, CREATOR: 0, PUBLISHER: 0 };
}

export function contributingGroupsFromCounts(
  counts: Record<SegmentKey, number>,
): SegmentKey[] {
  return (["HUMAN", "EXPERT", "CREATOR", "AI"] as const).filter(
    (key) => (counts[key] ?? 0) > 0,
  );
}

export function allBallotsFromGroups(
  counts: Record<SegmentKey, number>,
  groups: SegmentKey[],
): number {
  return groups.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

/** Over-depth but gradeable → Top-N scoring; extras ignored (not reserves). */
export function classifyOverDepthGrade(input: {
  pickCount: number;
  rankingDepth: number;
}): { action: "GRADE_TOP_N"; scoringDepthUsed: number } | null {
  if (input.pickCount <= input.rankingDepth) return null;
  if (!isGradeablePickCount(input.pickCount, input.rankingDepth)) return null;
  return {
    action: "GRADE_TOP_N",
    scoringDepthUsed: input.rankingDepth,
  };
}

export async function buildWeek1RepairPlan(
  db: PrismaClient,
  options?: { canonicalLock?: Date; weekId?: string },
): Promise<Week1RepairPlan> {
  const canonicalLock = options?.canonicalLock ?? WEEK1_CANONICAL_LOCK;

  const week = options?.weekId
    ? await db.week.findUnique({
        where: { id: options.weekId },
        include: {
          season: true,
          contests: {
            orderBy: { position: "asc" },
            include: {
              pregameSnapshot: {
                include: { _count: { select: { entries: true } } },
              },
              entries: { select: { id: true, actualRank: true } },
            },
          },
        },
      })
    : await db.week.findFirst({
        where: {
          weekNumber: 1,
          isTest: false,
          season: { year: 2026, sport: "NFL" },
        },
        include: {
          season: true,
          contests: {
            orderBy: { position: "asc" },
            include: {
              pregameSnapshot: {
                include: { _count: { select: { entries: true } } },
              },
              entries: { select: { id: true, actualRank: true } },
            },
          },
        },
      });

  if (!week) {
    throw new Error("Production 2026 NFL Week 1 not found");
  }

  const snapshotPlans: SnapshotRebuildPositionPlan[] = [];
  const gradingPlans: GradingPositionPlan[] = [];
  const allQualifyingSubmissionIds: string[] = [];

  for (const position of CONTEST_POSITIONS) {
    const contest = week.contests.find((c) => c.position === position);
    if (!contest) continue;

    const submissions = await db.rankingSubmission.findMany({
      where: { contestId: contest.id },
      include: {
        picks: {
          orderBy: { predictedRank: "asc" },
          select: {
            predictedRank: true,
            rankableEntryId: true,
            committedAt: true,
            lockedAt: true,
          },
        },
        universalProfile: {
          include: {
            expertSource: true,
            creatorCompetitor: true,
            publicFromWeek: true,
          },
        },
      },
    });

    const segmentCounts = emptySegmentCounts();
    const qualifyingIds: string[] = [];

    const considered = submissions.filter((sub) =>
      submissionIsEligible(sub.status),
    );
    const overDepthBoards: OverDepthGradePlan[] = [];
    const skips: GradeSkipPlan[] = [];
    const skipReasons: Record<string, number> = {};
    let willGradeCount = 0;
    let alreadyGradedCount = 0;

    for (const sub of submissions) {
      const profile = sub.universalProfile;
      const sourceKind = profile.expertSource?.sourceKind ?? null;
      const segment = segmentLabel({
        profileType: profile.profileType,
        sourceKind,
      });
      const displayName =
        profile.displayName ||
        profile.username ||
        profile.expertSource?.publicationName ||
        profile.creatorCompetitor?.brandName ||
        sub.id;

      const statusOk = submissionIsEligible(sub.status);
      const consensusEligible =
        filterEligibleConsensusSubmissions(
          [
            {
              status: sub.status,
              profileType: profile.profileType,
              sourceKind,
              picks: sub.picks,
              competitorActive: profile.competitorActive,
              publicVisible: profile.publicVisible,
              publicFromWeekId: profile.publicFromWeekId,
              publicFromWeek: profile.publicFromWeek
                ? {
                    id: profile.publicFromWeek.id,
                    seasonId: profile.publicFromWeek.seasonId,
                    weekNumber: profile.publicFromWeek.weekNumber,
                    startsAt: profile.publicFromWeek.startsAt,
                  }
                : null,
              week: {
                id: week.id,
                seasonId: week.seasonId,
                weekNumber: week.weekNumber,
                startsAt: week.startsAt,
              },
            },
          ],
          segment === "PUBLISHER"
            ? "PUBLISHER"
            : segment === "EXPERT"
              ? "EXPERT"
              : segment === "CREATOR"
                ? "CREATOR"
                : segment === "AI"
                  ? "AI"
                  : segment === "HUMAN"
                    ? "HUMAN"
                    : "ALL",
        ).length > 0;

      const eligibility = evaluateReconstructionEligibility(
        {
          status: sub.status,
          submittedAt: sub.submittedAt,
          rankingDepth: contest.rankingDepth,
          picks: sub.picks,
          publicConsensusEligible: consensusEligible,
          statusEligible: statusOk,
        },
        canonicalLock,
      );

      if (eligibility.qualifies && segment !== "OTHER") {
        segmentCounts[segment] += 1;
        qualifyingIds.push(sub.id);
        allQualifyingSubmissionIds.push(sub.id);
      }

      if (!statusOk) continue;

      if (sub.status === "GRADED") {
        alreadyGradedCount += 1;
      }

      if (!isGradeablePickCount(sub.picks.length, contest.rankingDepth)) {
        const reason =
          sub.picks.length < contest.rankingDepth
            ? `incomplete: pickCount ${sub.picks.length} < rankingDepth ${contest.rankingDepth}`
            : `over-depth: pickCount ${sub.picks.length} > max gradeable ${submissionDepthFromScoring(contest.rankingDepth, 2)}`;
        skips.push({
          displayName,
          submissionId: sub.id,
          status: sub.status,
          pickCount: sub.picks.length,
          rankingDepth: contest.rankingDepth,
          reason,
        });
        skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
        continue;
      }

      willGradeCount += 1;
      const topN = classifyOverDepthGrade({
        pickCount: sub.picks.length,
        rankingDepth: contest.rankingDepth,
      });
      if (topN) {
        overDepthBoards.push({
          displayName,
          submissionId: sub.id,
          status: sub.status,
          pickCount: sub.picks.length,
          rankingDepth: contest.rankingDepth,
          action: "GRADE_TOP_N",
          scoringDepthUsed: topN.scoringDepthUsed,
        });
      }
    }

    const groups = contributingGroupsFromCounts(segmentCounts);
    const allBallots = allBallotsFromGroups(segmentCounts, groups);
    const snap = contest.pregameSnapshot;
    const existingEntryCount = snap?._count.entries ?? 0;
    const newEntryCount = contest.entries.length;
    const rankedEntryCount = contest.entries.filter(
      (e) => e.actualRank != null && e.actualRank > 0,
    ).length;
    const canFinalize = rankedEntryCount >= contest.rankingDepth;

    snapshotPlans.push({
      position,
      contestId: contest.id,
      existingSnapshotId: snap?.id ?? null,
      existingLockedAt: snap?.lockedAt.toISOString() ?? null,
      existingSampleCounts: snap
        ? {
            sampleSizeAll: snap.sampleSizeAll,
            sampleSizeHuman: snap.sampleSizeHuman,
            sampleSizeAi: snap.sampleSizeAi,
            sampleSizeExpert: snap.sampleSizeExpert,
            sampleSizeCreator: snap.sampleSizeCreator,
            sampleSizePublisher: snap.sampleSizePublisher,
          }
        : null,
      existingEntryCount,
      replacementLockedAt: canonicalLock.toISOString(),
      reconstructedCounts: segmentCounts,
      allBallots,
      contributingGroups: groups,
      contributingGroupCount: groups.length,
      wouldDeleteSnapshotRows: snap ? 1 : 0,
      wouldDeleteSnapshotEntries: existingEntryCount,
      wouldCreateSnapshotRows: 1,
      wouldCreateSnapshotEntries: newEntryCount,
      qualifyingSubmissionIds: qualifyingIds,
    });

    gradingPlans.push({
      position,
      contestId: contest.id,
      currentStatus: contest.status,
      rankingDepth: contest.rankingDepth,
      reserveCount: contest.reserveCount ?? 0,
      rankedEntryCount,
      consideredCount: considered.length,
      willGradeCount,
      skipCount: skips.length,
      alreadyGradedCount,
      skipReasons,
      overDepthBoards: overDepthBoards.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
      skips,
      expectedFinalStatus: canFinalize
        ? "FINAL"
        : "BLOCKED_MISSING_ACTUAL_RANKS",
      normalizedScoreWrites: willGradeCount,
    });
  }

  const totalGradedSubmissions = gradingPlans.reduce(
    (sum, p) => sum + p.willGradeCount,
    0,
  );
  const totalSkippedIncompletes = gradingPlans.reduce(
    (sum, p) => sum + p.skipCount,
    0,
  );
  const allContestsFinal = gradingPlans.every(
    (p) => p.expectedFinalStatus === "FINAL",
  );

  const expectedContestStatuses: Record<string, string> = {};
  for (const plan of gradingPlans) {
    expectedContestStatuses[plan.position] = plan.expectedFinalStatus;
  }

  return {
    weekId: week.id,
    weekLabel: week.label,
    weekStatus: week.status,
    canonicalLock: canonicalLock.toISOString(),
    snapshotPlans,
    gradingPlans,
    lifecycle: {
      expectedContestStatuses,
      expectedWeekStatus: allContestsFinal ? "COMPLETE" : "BLOCKED",
      totalGradedSubmissions,
      totalNormalizedScoreWrites: totalGradedSubmissions,
      totalSkippedIncompletes,
      pickMutations: false,
      actualRankFantasyPointsMutations: false,
    },
    allQualifyingSubmissionIds,
  };
}

export function formatWeek1RepairDryRun(
  plan: Week1RepairPlan,
  options?: { dryRun?: boolean },
): string {
  const dryRun = options?.dryRun !== false;
  const lines: string[] = [];
  const pp = (value: unknown) => JSON.stringify(value, null, 2);

  lines.push(
    dryRun
      ? "=== WEEK 1 REPAIR DRY_RUN (read-only; zero writes) ==="
      : "=== WEEK 1 REPAIR PLAN (pre-live) ===",
  );
  lines.push(
    pp({
      weekId: plan.weekId,
      label: plan.weekLabel,
      currentWeekStatus: plan.weekStatus,
      canonicalLock: plan.canonicalLock,
      writes: dryRun ? 0 : "pending live execution",
    }),
  );

  lines.push("\n=== 1. SNAPSHOT REBUILD PLAN ===");
  for (const snap of plan.snapshotPlans) {
    lines.push(`\n--- ${snap.position} ---`);
    lines.push(
      pp({
        existingSnapshotId: snap.existingSnapshotId,
        existingLockedAt: snap.existingLockedAt,
        existingSampleCounts: snap.existingSampleCounts,
        replacementLockedAt: snap.replacementLockedAt,
        reconstructedCounts: {
          HUMAN: snap.reconstructedCounts.HUMAN,
          AI: snap.reconstructedCounts.AI,
          EXPERT: snap.reconstructedCounts.EXPERT,
          CREATOR: snap.reconstructedCounts.CREATOR,
          PUBLISHER: snap.reconstructedCounts.PUBLISHER,
          allBallots: snap.allBallots,
          contributingGroups: snap.contributingGroups,
          contributingGroupCount: snap.contributingGroupCount,
        },
        wouldDelete: {
          snapshotRows: snap.wouldDeleteSnapshotRows,
          snapshotEntries: snap.wouldDeleteSnapshotEntries,
        },
        wouldCreate: {
          snapshotRows: snap.wouldCreateSnapshotRows,
          snapshotEntries: snap.wouldCreateSnapshotEntries,
        },
      }),
    );
  }

  lines.push("\n=== 2. GRADING PLAN ===");
  for (const grade of plan.gradingPlans) {
    lines.push(`\n--- ${grade.position} ---`);
    lines.push(
      pp({
        contestStatus: grade.currentStatus,
        consideredLockedSubmittedGraded: grade.consideredCount,
        willGrade: grade.willGradeCount,
        skipped: grade.skipCount,
        skipReasons: grade.skipReasons,
        alreadyGraded: grade.alreadyGradedCount,
        expectedFinalContestStatus: grade.expectedFinalStatus,
        rankedEntryCount: grade.rankedEntryCount,
        rankingDepth: grade.rankingDepth,
        reserveCount: grade.reserveCount,
      }),
    );
    if (grade.overDepthBoards.length > 0) {
      lines.push(`Over-depth boards (GRADE_TOP_N, scoringDepth=${grade.rankingDepth}):`);
      for (const board of grade.overDepthBoards) {
        lines.push(
          `  - ${board.displayName}: pickCount=${board.pickCount} rankingDepth=${board.rankingDepth} GRADE_TOP_N Top-${board.scoringDepthUsed}`,
        );
      }
    } else {
      lines.push("Over-depth boards: none");
    }
    if (grade.skips.length > 0) {
      lines.push("Skips:");
      for (const skip of grade.skips) {
        lines.push(
          `  - ${skip.displayName}: pickCount=${skip.pickCount} (${skip.reason})`,
        );
      }
    }
  }

  lines.push("\n=== 3. FINAL LIFECYCLE PLAN ===");
  lines.push(
    pp({
      expectedContestStatuses: plan.lifecycle.expectedContestStatuses,
      expectedWeekStatus: plan.lifecycle.expectedWeekStatus,
      totalGradedSubmissions: plan.lifecycle.totalGradedSubmissions,
      totalNormalizedScoreWrites: plan.lifecycle.totalNormalizedScoreWrites,
      totalSkippedIncompletes: plan.lifecycle.totalSkippedIncompletes,
      pickMutations: plan.lifecycle.pickMutations,
      actualRankOrFantasyPointsChanges:
        plan.lifecycle.actualRankFantasyPointsMutations,
      notes: [
        "no RankingPick identity/order mutations",
        "no ContestEntry.actualRank / fantasyPoints changes",
        "grading writes scores only (normalizedScore / pick score fields)",
        "over-depth boards use Top-N truncation; extras ignored, not reserves",
      ],
    }),
  );

  lines.push("\n=== 4. SAFETY ===");
  lines.push(
    pp({
      DRY_RUN: dryRun,
      writesExecuted: dryRun ? 0 : "see live execution logs",
      snapshotDeletes: dryRun ? 0 : "only if CONFIRM_SNAPSHOT_REBUILD=1",
      gradingWrites: dryRun ? 0 : "pending",
      contestStatusWrites: dryRun ? 0 : "pending",
      weekStatusWrites: dryRun ? 0 : "pending",
      liveCommand:
        "CONFIRM_WEEK1_REPAIR=1 CONFIRM_SNAPSHOT_REBUILD=1 DRY_RUN=0 npx tsx scripts/repair-week1-regrade.ts",
    }),
  );

  return lines.join("\n");
}
