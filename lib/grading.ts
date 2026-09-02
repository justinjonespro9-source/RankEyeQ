import { prisma } from "@/lib/db";
import { resolveScoringConfigForContest } from "@/lib/ranking-scoring-versions";
import { scoreContest, type ScoreablePick } from "@/lib/scoring";
import { submissionIsEligible } from "@/lib/contest-lifecycle";

export class GradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingError";
  }
}

/**
 * Grade all eligible submissions for a contest using stored ContestEntry results
 * and lib/scoring.ts. Idempotent: re-running updates scores in place.
 */
export async function gradeContest(contestId: string) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      entries: true,
      submissions: {
        include: {
          picks: { orderBy: { predictedRank: "asc" } },
        },
      },
    },
  });

  if (!contest) throw new GradingError("Contest not found");

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

  await prisma.rankIQContest.update({
    where: { id: contestId },
    data: { status: "GRADING" },
  });

  try {
    await prisma.$transaction(async (tx) => {
      for (const submission of eligible) {
        if (submission.picks.length !== contest.rankingDepth) {
          // Incomplete eligible states shouldn't happen for SUBMITTED/LOCKED,
          // but skip rather than invent picks.
          continue;
        }

        const scoreable: ScoreablePick[] = submission.picks.map((pick) => {
          const result = actualByEntryId.get(pick.rankableEntryId);
          return {
            playerId: pick.rankableEntryId,
            playerName: pick.rankableEntryId,
            predictedRank: pick.predictedRank,
            actualRank: result?.actualRank ?? contest.rankingDepth + 100,
          };
        });

        const summary = scoreContest(scoreable, contest.rankingDepth, config);

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
      }

      await tx.rankIQContest.update({
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
    });
  } catch (error) {
    // Leave contest in GRADING on failure so admin can retry
    throw error;
  }

  return prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      _count: {
        select: {
          submissions: true,
          entries: true,
        },
      },
      submissions: {
        where: { status: "GRADED" },
        select: { id: true, normalizedScore: true },
      },
    },
  });
}
