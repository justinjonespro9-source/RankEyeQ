import { resolveAvatarUrl } from "@/lib/avatar";
import {
  profileAppearsOnPublicSurfaces,
  weekIsPubliclyVisibleForProfile,
} from "@/lib/competitor-visibility";
import { isCreatorVerified } from "@/lib/creator-verification-shared";
import { prisma } from "@/lib/db";
import {
  buildReceiptPickLine,
  formatActualFinishLabel,
} from "@/lib/profile-receipt";
import {
  filterLeaderboardRows,
  type LeaderboardRow,
  type SeasonBoardSet,
} from "@/lib/leaderboards";
import { getCachedSeasonBoardSet } from "@/lib/competitive-resume-data";
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
  bio: string | null;
  headline: string | null;
  affiliation: string | null;
  websiteUrl: string | null;
  xUrl: string | null;
  youtubeUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  podcastUrl: string | null;
  featuredLinkTitle: string | null;
  featuredLinkUrl: string | null;
  ownershipVerified: boolean;
  hasAuthUser: boolean;
  expertAnalystName: string | null;
  expertPublicationName: string | null;
  expertSourceKind: string | null;
  expertScoringFormat: string | null;
  creatorPersonName: string | null;
  creatorBrandName: string | null;
  /** True only when profileType CREATOR and claimStatus VERIFIED. */
  creatorVerified: boolean;
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
  options?: { includeTest?: boolean; allowPrivate?: boolean },
): Promise<RankIQProfileView | null> {
  const profile = await prisma.universalProfile.findUnique({
    where: { username },
    include: {
      expertSource: true,
      creatorCompetitor: true,
      authUser: { select: { image: true } },
      publicFromWeek: true,
    },
  });
  if (!profile) return null;
  if (!profile.publicVisible && profile.status === "SUSPENDED") return null;

  const visibility = {
    profileType: profile.profileType,
    competitorActive: profile.competitorActive,
    publicVisible: profile.publicVisible,
    publicFromWeekId: profile.publicFromWeekId,
    publicFromWeek: profile.publicFromWeek,
  };
  if (!options?.allowPrivate && !profileAppearsOnPublicSurfaces(visibility)) {
    return null;
  }

  const activeSeason = await prisma.season.findFirst({
    where: { active: true },
  });

  const submissionsRaw = await prisma.rankingSubmission.findMany({
    where: {
      universalProfileId: profile.id,
      status: "GRADED",
      contest: options?.includeTest ? undefined : { week: { isTest: false } },
    },
    include: {
      contest: { include: { week: true } },
      picks: {
        include: {
          rankableEntry: { select: { name: true, team: true } },
        },
        orderBy: { predictedRank: "asc" },
      },
    },
    orderBy: [
      { contest: { week: { weekNumber: "desc" } } },
      { updatedAt: "desc" },
    ],
  });

  // Public viewers only see weeks authorized for public exposure.
  const submissions =
    options?.allowPrivate || !visibility.publicFromWeekId
      ? submissionsRaw
      : submissionsRaw.filter((submission) =>
          weekIsPubliclyVisibleForProfile(visibility, {
            id: submission.contest.week.id,
            seasonId: submission.contest.week.seasonId,
            weekNumber: submission.contest.week.weekNumber,
            startsAt: submission.contest.week.startsAt,
          }),
        );

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
  let numberOneCalls = 0;
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
      if (pick.actualRank === 1 && pick.predictedRank === 1) numberOneCalls += 1;
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

  const includeTest = Boolean(options?.includeTest);
  const seasonIds = new Set(submissions.map((s) => s.contest.seasonId));
  if (activeSeason) seasonIds.add(activeSeason.id);
  const boardSets = new Map<string, SeasonBoardSet>();
  await Promise.all(
    [...seasonIds].map(async (seasonId) => {
      const set = await getCachedSeasonBoardSet(seasonId, includeTest);
      if (set) boardSets.set(seasonId, set);
    }),
  );

  const activeSet = activeSeason ? boardSets.get(activeSeason.id) : undefined;
  if (activeSet) {
    const classFilter =
      profile.profileType === "BENCHMARK"
        ? "EXPERT"
        : profile.profileType === "CREATOR"
          ? "CREATOR"
          : profile.profileType === "AI"
            ? "AI"
            : "ALL";
    overallRank = rankOnBoard(
      filterLeaderboardRows(activeSet.seasonOverall, classFilter),
      profile.id,
    );

    for (const position of ["QB", "RB", "WR", "TE", "DEF"] as ContestPosition[]) {
      positionRanks[toUiPosition(position)] = rankOnBoard(
        filterLeaderboardRows(activeSet.seasonByPosition[position] ?? [], classFilter),
        profile.id,
      );
    }
  }

  const history: ProfileContestHistoryItem[] = [];
  for (const submission of submissions) {
    const weekly: LeaderboardRow[] =
      boardSets
        .get(submission.contest.seasonId)
        ?.weeks.find((week) => week.weekId === submission.contest.weekId)
        ?.overall ?? [];

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

    const receiptPicks = submission.picks.map((pick) => {
      const line = buildReceiptPickLine({
        pick: {
          playerId: pick.rankableEntryId,
          playerName: pick.rankableEntry.name,
          predictedRank: pick.predictedRank,
          actualRank: pick.actualRank ?? depth + 100,
          team: pick.rankableEntry.team,
        },
        fieldSize: depth,
        graded: pick.actualRank != null,
      });
      return {
        ...line,
        actualLabel: formatActualFinishLabel(
          submission.contest.position,
          pick.actualRank,
        ),
      };
    });

    history.push({
      submissionId: submission.id,
      contestId: submission.contestId,
      weekLabel: submission.contest.week.label,
      weekNumber: submission.contest.week.weekNumber,
      position: submission.contest.position,
      rankingDepth: depth,
      normalizedScore: submission.normalizedScore,
      rawScore: submission.rawScore,
      topNHits: topN,
      exactHits: exact,
      numberOneHit: numberOne,
      weeklyRank: rankOnBoard(weekly, profile.id),
      receiptPicks,
    });
  }

  return {
    profileId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    profileType: profile.profileType,
    status: profile.status,
    universalUserId: profile.universalUserId,
    // Public identity: uploaded/seeded avatarUrl → Google User.image → null (initials).
    avatarUrl: resolveAvatarUrl({
      avatarUrl: profile.avatarUrl,
      oauthImageUrl: profile.authUser?.image,
    }),
    bio: profile.bio,
    headline: profile.headline,
    affiliation: profile.affiliation,
    websiteUrl: profile.websiteUrl,
    xUrl: profile.xUrl,
    youtubeUrl: profile.youtubeUrl,
    instagramUrl: profile.instagramUrl,
    tiktokUrl: profile.tiktokUrl,
    podcastUrl: profile.podcastUrl,
    featuredLinkTitle: profile.featuredLinkTitle,
    featuredLinkUrl: profile.featuredLinkUrl,
    ownershipVerified: Boolean(
      profile.ownershipVerifiedAt ||
        isCreatorVerified({
          profileType: profile.profileType,
          claimStatus: profile.creatorCompetitor?.claimStatus ?? null,
        }),
    ),
    hasAuthUser: Boolean(profile.authUser),
    expertAnalystName: profile.expertSource?.analystName ?? null,
    expertPublicationName: profile.expertSource?.publicationName ?? null,
    expertSourceKind: profile.expertSource?.sourceKind ?? null,
    expertScoringFormat: profile.expertSource?.scoringFormat ?? null,
    creatorPersonName: profile.creatorCompetitor?.personName ?? null,
    creatorBrandName: profile.creatorCompetitor?.brandName ?? null,
    creatorVerified: isCreatorVerified({
      profileType: profile.profileType,
      claimStatus: profile.creatorCompetitor?.claimStatus ?? null,
    }),
    contestsPlayed,
    stats: {
      overallRank,
      averageRankingScore,
      topHitRate:
        topNOpportunities === 0 ? null : topNHits / topNOpportunities,
      exactRankingHits: exactHits,
      numberOneHits,
      numberOneCalls,
      podiumHits,
      bestWeek,
      currentStreak: null,
      positionRanks,
    },
    history,
  };
}
