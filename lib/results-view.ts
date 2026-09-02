import { prisma } from "@/lib/db";
import { getContestConsensus } from "@/lib/consensus";
import { getWeeklyLeaderboard } from "@/lib/leaderboards";
import { getLeagueWeeklyResults } from "@/lib/player-research-queries";
import { scoreContest } from "@/lib/scoring";
import type { ContestScoreSummary } from "@/types/scoring";

export async function getContestResultsView(
  contestId: string,
  activeProfileId?: string | null,
) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: true,
      season: true,
      entries: {
        include: { rankableEntry: true },
        orderBy: [{ actualRank: "asc" }, { rankableEntry: { name: "asc" } }],
      },
    },
  });

  if (!contest) return null;
  if (contest.week.isTest) return null;

  const consensus = await getContestConsensus(contestId, "ALL");
  const leagueResults = await getLeagueWeeklyResults({
    contestId,
    limit: 40,
    segment: "ALL",
  });
  const topPerformers = await getWeeklyLeaderboard({
    weekId: contest.weekId,
    position: contest.position,
    filter: "ALL",
  });

  const actualById = new Map<string, number>();
  for (const row of leagueResults) {
    actualById.set(row.rankableEntryId, row.actualRank);
  }
  // Fallback to contest entries for legacy weeks without league stat ranks.
  for (const entry of contest.entries) {
    if (entry.actualRank != null && !actualById.has(entry.rankableEntryId)) {
      actualById.set(entry.rankableEntryId, entry.actualRank);
    }
  }

  let userScore: ContestScoreSummary | null = null;
  let userSubmissionStatus: string | null = null;

  if (activeProfileId) {
    const submission = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: activeProfileId,
        },
      },
      include: {
        picks: {
          include: { rankableEntry: true },
          orderBy: { predictedRank: "asc" },
        },
      },
    });

    if (submission && submission.picks.length > 0) {
      userSubmissionStatus = submission.status;
      const actualRankMap = new Map(
        [...actualById.entries()].map(([id, rank]) => [id, rank]),
      );

      userScore = scoreContest(
        submission.picks.map((pick) => ({
          playerId: pick.rankableEntryId,
          playerName: pick.rankableEntry.name,
          predictedRank: pick.predictedRank,
          actualRank:
            actualRankMap.get(pick.rankableEntryId) ??
            contest.rankingDepth + 100,
        })),
        contest.rankingDepth,
      );
    }
  }

  return {
    contest,
    consensus,
    leagueResults,
    topPerformers: topPerformers.slice(0, 10),
    userScore,
    userSubmissionStatus,
  };
}
