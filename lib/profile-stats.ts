import { prisma } from "@/lib/db";
import {
  getSeasonLeaderboard,
  getWeeklyLeaderboard,
  type LeaderboardRow,
} from "@/lib/leaderboards";
import type {
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { RankIQProfileStats } from "@/types/user";
import { toUiPosition } from "@/lib/contest-defaults";

export type { ProfileContestHistoryItem };

export type RankIQProfileView = {
  profileId: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
  status: "ACTIVE" | "SUSPENDED";
  universalUserId: string | null;
  avatarUrl: string | null;
  stats: RankIQProfileStats;
  history: ProfileContestHistoryItem[];
  contestsPlayed: number;
};

function rankOnBoard(
  board: LeaderboardRow[],
  profileId: string,
): number | null {
  return board.find((row) => row.universalProfileId === profileId)?.rank ?? null;
}

export async function getRankIQProfileView(
  username: string,
  options?: { includeTest?: boolean },
): Promise<RankIQProfileView | null> {
  const profile = await prisma.universalProfile.findUnique({
    where: { username },
  });
  if (!profile) return null;
  if (!profile.publicVisible && profile.status === "SUSPENDED") return null;

  const activeSeason = await prisma.season.findFirst({
    where: { active: true },
  });

  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      universalProfileId: profile.id,
      status: "GRADED",
      contest: options?.includeTest ? undefined : { week: { isTest: false } },
    },
    include: {
      contest: { include: { week: true } },
      picks: true,
    },
    orderBy: [
      { contest: { week: { weekNumber: "desc" } } },
      { updatedAt: "desc" },
    ],
  });

  const scores = submissions
    .map((s) => s.normalizedScore)
    .filter((value): value is number => value != null);

  const contestsPlayed = submissions.length;
  const averageRankingScore =
    scores.length === 0
      ? null
      : scores.reduce((sum, value) => sum + value, 0) / scores.length;

  const bestWeek =
    scores.length === 0
      ? null
      : (() => {
          const best = submissions.reduce((current, submission) => {
            if (
              (submission.normalizedScore ?? -1) >
              (current.normalizedScore ?? -1)
            ) {
              return submission;
            }
            return current;
          }, submissions[0]);
          return `${best.contest.week.label} · ${best.contest.position} · ${(best.normalizedScore ?? 0).toFixed(1)}`;
        })();

  let topNHits = 0;
  let topNOpportunities = 0;
  let exactHits = 0;
  let numberOneHits = 0;
  let podiumHits = 0;

  for (const submission of submissions) {
    const depth = submission.contest.rankingDepth;
    topNOpportunities += depth;
    for (const pick of submission.picks) {
      if (
        pick.actualRank != null &&
        pick.actualRank >= 1 &&
        pick.actualRank <= depth
      ) {
        topNHits += 1;
      }
      if (
        pick.actualRank != null &&
        pick.actualRank === pick.predictedRank &&
        pick.actualRank <= depth
      ) {
        exactHits += 1;
      }
      if (pick.actualRank === 1) numberOneHits += 1;
      if (
        pick.predictedRank <= 3 &&
        pick.actualRank != null &&
        pick.actualRank >= 1 &&
        pick.actualRank <= 3
      ) {
        podiumHits += 1;
      }
    }
  }

  let overallRank: number | null = null;
  const positionRanks: RankIQProfileStats["positionRanks"] = {
    qb: null,
    rb: null,
    wr: null,
    te: null,
    def: null,
  };

  if (activeSeason) {
    const classFilter =
      profile.profileType === "BENCHMARK"
        ? "EXPERT"
        : profile.profileType === "AI"
          ? "AI"
          : "ALL";
    const overall = await getSeasonLeaderboard({
      seasonId: activeSeason.id,
      filter: classFilter,
      includeTest: options?.includeTest,
    });
    overallRank = rankOnBoard(overall, profile.id);

    for (const position of ["QB", "RB", "WR", "TE", "DEF"] as ContestPosition[]) {
      const board = await getSeasonLeaderboard({
        seasonId: activeSeason.id,
        position,
        filter: classFilter,
        includeTest: options?.includeTest,
      });
      positionRanks[toUiPosition(position)] = rankOnBoard(board, profile.id);
    }
  }

  const weekRankCache = new Map<string, LeaderboardRow[]>();

  const history: ProfileContestHistoryItem[] = [];
  for (const submission of submissions) {
    let weekly = weekRankCache.get(submission.contest.weekId);
    if (!weekly) {
      weekly = await getWeeklyLeaderboard({
        weekId: submission.contest.weekId,
        filter: "ALL",
        includeTest: options?.includeTest,
      });
      weekRankCache.set(submission.contest.weekId, weekly);
    }

    const depth = submission.contest.rankingDepth;
    let topN = 0;
    let exact = 0;
    let numberOne = false;
    for (const pick of submission.picks) {
      if (
        pick.actualRank != null &&
        pick.actualRank >= 1 &&
        pick.actualRank <= depth
      ) {
        topN += 1;
      }
      if (
        pick.actualRank != null &&
        pick.actualRank === pick.predictedRank &&
        pick.actualRank <= depth
      ) {
        exact += 1;
      }
      if (pick.actualRank === 1) numberOne = true;
    }

    history.push({
      submissionId: submission.id,
      contestId: submission.contestId,
      weekLabel: submission.contest.week.label,
      weekNumber: submission.contest.week.weekNumber,
      position: submission.contest.position,
      normalizedScore: submission.normalizedScore,
      rawScore: submission.rawScore,
      topNHits: topN,
      exactHits: exact,
      numberOneHit: numberOne,
      weeklyRank: rankOnBoard(weekly, profile.id),
    });
  }

  return {
    profileId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    profileType: profile.profileType,
    status: profile.status,
    universalUserId: profile.universalUserId,
    avatarUrl: profile.avatarUrl,
    contestsPlayed,
    stats: {
      overallRank,
      averageRankingScore,
      topHitRate:
        topNOpportunities === 0 ? null : topNHits / topNOpportunities,
      exactRankingHits: exactHits,
      numberOneHits,
      podiumHits,
      bestWeek,
      currentStreak: null,
      positionRanks,
    },
    history,
  };
}
