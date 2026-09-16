import { prisma } from "@/lib/db";
import { resolveScoringConfigForContest } from "@/lib/ranking-scoring-versions";
import { scoreContest, type ScoreablePick } from "@/lib/scoring";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import {
  isGradeablePickCount,
  submissionDepthFromScoring,
} from "@/lib/contest-defaults";
import { scoreableEffectivePicks } from "@/lib/reserves/from-submission";
import { logServerEvent } from "@/lib/log";

export class GradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingError";
  }
}

export type GradeSkipDiagnostic = {
  submissionId: string;
  profileId: string;
  status: string;
  pickCount: number;
  rankingDepth: number;
  reserveCount: number;
  expectedSubmissionDepth: number;
  reason: string;
};

export type GradeContestResult = {
  contestId: string;
  position: string;
  status: string;
  graded: number;
  skipped: number;
  skips: GradeSkipDiagnostic[];
};

/**
 * Grade all eligible submissions for a contest using stored ContestEntry results
 * and lib/scoring.ts. Idempotent: re-running updates scores in place.
 *
 * Each submission is graded in its own short transaction so a large field
 * cannot leave the contest stuck in GRADING after an interactive-tx timeout.
 */
export async function gradeContest(
  contestId: string,
): Promise<GradeContestResult> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      entries: true,
      submissions: {
        include: {
          picks: {
            orderBy: { predictedRank: "asc" },
            include: { rankableEntry: { include: { game: true } } },
          },
        },
      },
    },
  });

  if (!contest) throw new GradingError("Contest not found");

  const reserveCount = contest.reserveCount ?? 0;
  const expectedSubmissionDepth = submissionDepthFromScoring(
    contest.rankingDepth,
    reserveCount,
  );

  const { versionId, config } = await resolveScoringConfigForContest(contestId);

  const rankedEntries = contest.entries.filter(
    (entry) => entry.actualRank != null && entry.actualRank > 0,
  );

  if (rankedEntries.length < contest.rankingDepth) {
    throw new GradingError(
      `Need actualRank for at least the Top ${contest.rankingDepth} entries before grading (have ${rankedEntries.length})`,
    );
  }

  const actualByEntryId = new Map(
    contest.entries
      .filter((entry) => entry.actualRank != null)
      .map((entry) => [
        entry.rankableEntryId,
        {
          actualRank: entry.actualRank as number,
          fantasyPoints: entry.fantasyPoints,
        },
      ]),
  );

  const eligible = contest.submissions.filter((submission) =>
    submissionIsEligible(submission.status),
  );

  const priorStatus = contest.status;
  await prisma.rankIQContest.update({
    where: { id: contestId },
    data: { status: "GRADING" },
  });

  const skips: GradeSkipDiagnostic[] = [];
  let graded = 0;

  try {
    for (const submission of eligible) {
      if (
        !isGradeablePickCount(submission.picks.length, contest.rankingDepth)
      ) {
        skips.push({
          submissionId: submission.id,
          profileId: submission.universalProfileId,
          status: submission.status,
          pickCount: submission.picks.length,
          rankingDepth: contest.rankingDepth,
          reserveCount,
          expectedSubmissionDepth,
          reason:
            submission.picks.length < contest.rankingDepth
              ? `incomplete: pickCount ${submission.picks.length} < rankingDepth ${contest.rankingDepth}`
              : `over-depth: pickCount ${submission.picks.length} > max gradeable ${submissionDepthFromScoring(contest.rankingDepth, 2)}`,
        });
        continue;
      }

      const effective = scoreableEffectivePicks({
        picks: submission.picks,
        scoringDepth: contest.rankingDepth,
      });

      const scoreable: ScoreablePick[] = effective.map((pick) => {
        const result = actualByEntryId.get(pick.playerId);
        return {
          playerId: pick.playerId,
          playerName: pick.playerId,
          predictedRank: pick.predictedRank,
          actualRank: result?.actualRank ?? contest.rankingDepth + 100,
        };
      });

      const summary = scoreContest(scoreable, contest.rankingDepth, config);

      await prisma.$transaction(async (tx) => {
        await tx.rankingPick.updateMany({
          where: { submissionId: submission.id },
          data: {
            actualRank: null,
            fantasyPoints: null,
            basePoints: null,
            accuracyPoints: null,
            podiumPoints: null,
            totalPoints: null,
          },
        });

        for (const row of summary.players) {
          const pick = submission.picks.find(
            (p) => p.rankableEntryId === row.playerId,
          );
          if (!pick) continue;
          const result = actualByEntryId.get(row.playerId);

          await tx.rankingPick.update({
            where: { id: pick.id },
            data: {
              actualRank: row.actualRank,
              fantasyPoints: result?.fantasyPoints ?? null,
              basePoints: row.basePoints,
              accuracyPoints: row.accuracyPoints,
              podiumPoints: row.podiumPoints,
              totalPoints: row.totalPoints,
            },
          });
        }

        await tx.rankingSubmission.update({
          where: { id: submission.id },
          data: {
            status: "GRADED",
            lockedAt: submission.lockedAt ?? new Date(),
            rawScore: summary.rawPoints,
            normalizedScore: summary.rankIqScore,
          },
        });
      });

      graded += 1;
    }

    await prisma.rankIQContest.update({
      where: { id: contestId },
      data: {
        status: "FINAL",
        ...(versionId
          ? {
              rankingScoringVersionId:
                contest.rankingScoringVersionId ?? versionId,
              rankingScoringConfig:
                contest.rankingScoringConfig ?? (config as object),
            }
          : {}),
      },
    });
  } catch (error) {
    // Restore prior status when possible so public Results does not stay stuck
    // on GRADING / UNOFFICIAL after a mid-grade failure.
    const restoreTo =
      priorStatus === "GRADING" || priorStatus === "FINAL"
        ? "LOCKED"
        : priorStatus;
    await prisma.rankIQContest
      .update({
        where: { id: contestId },
        data: { status: restoreTo },
      })
      .catch(() => undefined);
    logServerEvent(
      "contest.grade_failed",
      {
        contestId,
        position: contest.position,
        graded,
        skipped: skips.length,
        error: error instanceof Error ? error.message : "unknown",
      },
      "error",
    );
    throw error;
  }

  if (skips.length > 0) {
    logServerEvent(
      "contest.grade_skips",
      {
        contestId,
        position: contest.position,
        skipped: skips.length,
        samples: skips.slice(0, 10),
      },
      "warn",
    );
  }

  return {
    contestId,
    position: contest.position,
    status: "FINAL",
    graded,
    skipped: skips.length,
    skips,
  };
}
