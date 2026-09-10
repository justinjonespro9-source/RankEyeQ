import { prisma } from "@/lib/db";
import {
  profileAppearsOnPublicSurfaces,
  weekIsPubliclyVisibleForProfile,
} from "@/lib/competitor-visibility";
import {
  EXPERT_SOURCE_KIND,
  isPublisherConsensusSource,
} from "@/lib/expert-identity";
import type {
  ContestPosition,
  ProfileType,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type LeaderboardFilter =
  | "ALL"
  | "HUMAN"
  | "AI"
  | "EXPERT"
  | "CREATOR"
  | "PUBLISHER";

export type LeaderboardRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileType: ProfileType;
  expertPublisher: string | null;
  expertSourceKind: string | null;
  creatorBrand: string | null;
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

/**
 * Official competitive leaderboards (weekly / season / class filters) only
 * include competitors who actually competed in the selected scope.
 *
 * Qualification:
 * - status GRADED
 * - non-null normalizedScore
 * - at least one ranking pick
 *
 * Profiles with no submissions, DRAFT-only boards, empty shells, or scores
 * without picks never appear — including seeded Experts, tracked Creators,
 * newly created AI identities, and empty Publisher Consensus profiles.
 */
export function gradedSubmissionQualifiesForLeaderboard(submission: {
  status: SubmissionStatus;
  normalizedScore: number | null;
  picks: readonly unknown[];
}): boolean {
  return (
    submission.status === "GRADED" &&
    submission.normalizedScore != null &&
    submission.picks.length > 0
  );
}

function profileWhereForFilter(filter: LeaderboardFilter) {
  if (filter === "HUMAN") return { profileType: "HUMAN" as const };
  if (filter === "AI") return { profileType: "AI" as const };
  if (filter === "CREATOR") return { profileType: "CREATOR" as const };
  if (filter === "EXPERT") {
    return {
      profileType: "BENCHMARK" as const,
      OR: [
        { expertSource: { sourceKind: EXPERT_SOURCE_KIND.ANALYST } },
        { expertSource: null },
      ],
    };
  }
  if (filter === "PUBLISHER") {
    return {
      profileType: "BENCHMARK" as const,
      expertSource: {
        sourceKind: {
          in: [
            EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
            EXPERT_SOURCE_KIND.SITE_CONSENSUS,
          ],
        },
      },
    };
  }
  return undefined;
}

type GradedAgg = {
  universalProfileId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileType: ProfileType;
  expertPublisher: string | null;
  expertSourceKind: string | null;
  creatorBrand: string | null;
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
        avatarUrl: agg.avatarUrl,
        profileType: agg.profileType,
        expertPublisher: agg.expertPublisher,
        expertSourceKind: agg.expertSourceKind,
        creatorBrand: agg.creatorBrand,
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
  avatarUrl: string | null;
  profileType: ProfileType;
  expertSource?: {
    publicationName: string | null;
    analystName: string | null;
    sourceKind: string;
  } | null;
  creatorCompetitor?: {
    personName: string | null;
    brandName: string | null;
  } | null;
}): GradedAgg {
  const creatorPerson = profile.creatorCompetitor?.personName?.trim();
  const sourceKind = profile.expertSource?.sourceKind ?? null;
  return {
    universalProfileId: profile.id,
    username: profile.username,
    displayName:
      creatorPerson ||
      (isPublisherConsensusSource(sourceKind)
        ? profile.displayName
        : profile.expertSource?.analystName?.trim()) ||
      profile.displayName,
    avatarUrl: profile.avatarUrl,
    profileType: profile.profileType,
    expertPublisher: profile.expertSource?.publicationName ?? null,
    expertSourceKind: sourceKind,
    creatorBrand: profile.creatorCompetitor?.brandName ?? null,
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
  filter?: LeaderboardFilter;
  includeTest?: boolean;
}) {
  const profileWhere = profileWhereForFilter(where.filter ?? "ALL");

  return prisma.rankingSubmission.findMany({
    where: {
      status: "GRADED",
      normalizedScore: { not: null },
      picks: { some: {} },
      ...(profileWhere ? { universalProfile: profileWhere } : {}),
      contest: {
        status: { in: ["FINAL", "ARCHIVED"] },
        week: where.includeTest ? undefined : { isTest: false },
        ...(where.weekId ? { weekId: where.weekId } : {}),
        ...(where.seasonId ? { seasonId: where.seasonId } : {}),
        ...(where.position ? { position: where.position } : {}),
      },
    },
    include: {
      universalProfile: {
        include: {
          expertSource: true,
          creatorCompetitor: true,
          publicFromWeek: true,
        },
      },
      contest: { include: { week: true } },
      picks: true,
    },
  });
}

function accumulate(
  submissions: Awaited<ReturnType<typeof loadGradedSubmissions>>,
): GradedAgg[] {
  const map = new Map<string, GradedAgg>();

  for (const submission of submissions) {
    if (!gradedSubmissionQualifiesForLeaderboard(submission)) continue;
    const profile = submission.universalProfile;
    // Legacy publisher shells stay off competitive boards even if somehow graded.
    if (profile.expertSource?.sourceKind === EXPERT_SOURCE_KIND.PUBLISHER) {
      continue;
    }
    const visibility = {
      profileType: profile.profileType,
      competitorActive: profile.competitorActive,
      publicVisible: profile.publicVisible,
      publicFromWeekId: profile.publicFromWeekId,
      publicFromWeek: profile.publicFromWeek,
    };
    if (!profileAppearsOnPublicSurfaces(visibility)) continue;
    const week = submission.contest.week;
    if (
      !weekIsPubliclyVisibleForProfile(visibility, {
        id: week.id,
        seasonId: week.seasonId,
        weekNumber: week.weekNumber,
        startsAt: week.startsAt,
      })
    ) {
      continue;
    }
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
  const submissions = await loadGradedSubmissions({
    weekId: input.weekId,
    position: input.position,
    filter: input.filter ?? "ALL",
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
  const submissions = await loadGradedSubmissions({
    seasonId: input.seasonId,
    position: input.position,
    filter: input.filter ?? "ALL",
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
