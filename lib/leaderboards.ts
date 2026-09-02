import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";

export type LeaderboardFilter = "ALL" | "HUMAN" | "AI" | "EXPERT";

export type LeaderboardRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
  contestsPlayed: number;
  averageScore: number;
  bestScore: number;
  topNHits: number;
  topNOpportunities: number;
  topNHitRate: number;
  exactHits: number;
  numberOneHits: number;
  rank: number;
};

function filterToProfileType(
  filter: LeaderboardFilter,
): ProfileType | undefined {
  if (filter === "HUMAN") return "HUMAN";
  if (filter === "AI") return "AI";
  if (filter === "EXPERT") return "BENCHMARK";
  return undefined;
}

type GradedAgg = {
  universalProfileId: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
  scores: number[];
  topNHits: number;
  topNOpportunities: number;
  exactHits: number;
  numberOneHits: number;
};

function toRows(aggs: GradedAgg[]): LeaderboardRow[] {
  const rows = aggs
    .filter((agg) => agg.scores.length > 0)
    .map((agg) => {
      const averageScore =
        agg.scores.reduce((sum, value) => sum + value, 0) / agg.scores.length;
      const bestScore = Math.max(...agg.scores);
      return {
        universalProfileId: agg.universalProfileId,
        username: agg.username,
        displayName: agg.displayName,
        profileType: agg.profileType,
        contestsPlayed: agg.scores.length,
        averageScore,
        bestScore,
        topNHits: agg.topNHits,
        topNOpportunities: agg.topNOpportunities,
        topNHitRate:
          agg.topNOpportunities === 0
            ? 0
            : agg.topNHits / agg.topNOpportunities,
        exactHits: agg.exactHits,
        numberOneHits: agg.numberOneHits,
        rank: 0,
      };
    })
    .sort((a, b) => {
      if (b.averageScore !== a.averageScore) {
        return b.averageScore - a.averageScore;
      }
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      return a.displayName.localeCompare(b.displayName);
    });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

function emptyAgg(profile: {
  id: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
}): GradedAgg {
  return {
    universalProfileId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    profileType: profile.profileType,
    scores: [],
    topNHits: 0,
    topNOpportunities: 0,
    exactHits: 0,
    numberOneHits: 0,
  };
}

async function loadGradedSubmissions(where: {
  weekId?: string;
  seasonId?: string;
  position?: ContestPosition;
  profileType?: ProfileType;
  includeTest?: boolean;
}) {
  return prisma.rankingSubmission.findMany({
    where: {
      status: "GRADED",
      normalizedScore: { not: null },
      ...(where.profileType
        ? { universalProfile: { profileType: where.profileType } }
        : {}),
      contest: {
        status: { in: ["FINAL", "ARCHIVED"] },
        week: where.includeTest ? undefined : { isTest: false },
        ...(where.weekId ? { weekId: where.weekId } : {}),
        ...(where.seasonId ? { seasonId: where.seasonId } : {}),
        ...(where.position ? { position: where.position } : {}),
      },
    },
    include: {
      universalProfile: true,
      contest: true,
      picks: true,
    },
  });
}

function accumulate(
  submissions: Awaited<ReturnType<typeof loadGradedSubmissions>>,
): GradedAgg[] {
  const map = new Map<string, GradedAgg>();

  for (const submission of submissions) {
    const profile = submission.universalProfile;
    const agg = map.get(profile.id) ?? emptyAgg(profile);
    agg.scores.push(submission.normalizedScore ?? 0);

    const depth = submission.contest.rankingDepth;
    agg.topNOpportunities += depth;

    for (const pick of submission.picks) {
      if (
        pick.actualRank != null &&
        pick.actualRank >= 1 &&
        pick.actualRank <= depth
      ) {
        agg.topNHits += 1;
      }
      if (
        pick.actualRank != null &&
        pick.actualRank === pick.predictedRank &&
        pick.actualRank <= depth
      ) {
        agg.exactHits += 1;
      }
      if (pick.actualRank === 1) {
        agg.numberOneHits += 1;
      }
    }

    map.set(profile.id, agg);
  }

  return [...map.values()];
}

/** Minimum contests concept for future filtering — currently informational only. */
export const DEFAULT_MIN_CONTESTS = 1;

export async function getWeeklyLeaderboard(input: {
  weekId: string;
  position?: ContestPosition;
  filter?: LeaderboardFilter;
  minContests?: number;
  includeTest?: boolean;
}): Promise<LeaderboardRow[]> {
  const profileType = filterToProfileType(input.filter ?? "ALL");
  const submissions = await loadGradedSubmissions({
    weekId: input.weekId,
    position: input.position,
    profileType,
    includeTest: input.includeTest,
  });
  const rows = toRows(accumulate(submissions));
  const min = input.minContests ?? DEFAULT_MIN_CONTESTS;
  return rows.filter((row) => row.contestsPlayed >= min);
}

export async function getSeasonLeaderboard(input: {
  seasonId: string;
  position?: ContestPosition;
  filter?: LeaderboardFilter;
  minContests?: number;
  includeTest?: boolean;
}): Promise<LeaderboardRow[]> {
  const profileType = filterToProfileType(input.filter ?? "ALL");
  const submissions = await loadGradedSubmissions({
    seasonId: input.seasonId,
    position: input.position,
    profileType,
    includeTest: input.includeTest,
  });
  const rows = toRows(accumulate(submissions));
  const min = input.minContests ?? DEFAULT_MIN_CONTESTS;
  return rows.filter((row) => row.contestsPlayed >= min);
}

export async function getActiveSeasonAndWeek() {
  const season = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: {
      weeks: {
        where: { isTest: false },
        orderBy: { weekNumber: "asc" },
      },
    },
  });
  if (!season) return null;
  const week =
    season.weeks.find((w) => w.status === "OPEN" || w.status === "LOCKED") ??
    season.weeks.find((w) => w.status === "COMPLETE") ??
    season.weeks[0];
  return { season, week };
}
