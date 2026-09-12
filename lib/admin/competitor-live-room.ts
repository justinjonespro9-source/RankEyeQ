import { listActiveAiCompetitors } from "@/lib/ai-competitors-sync";
import {
  CONTEST_POSITIONS,
  isScorablePickCount,
  toUiPosition,
} from "@/lib/contest-defaults";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import {
  competitorVisibilityBadgeLabel,
  resolveCompetitorVisibility,
  type CompetitorVisibilityState,
} from "@/lib/competitor-visibility";
import { listActiveCreatorCompetitors } from "@/lib/creator-identity";
import { prisma } from "@/lib/db";
import {
  isAnalystExpertSource,
  isPublisherConsensusSource,
} from "@/lib/expert-identity";
import { listActiveBenchmarkSources } from "@/lib/benchmark-sources-sync";
import { getActiveSeasonAndWeek } from "@/lib/leaderboards";
import { scoreProvisionalEyeq } from "@/lib/live-provisional";
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";
import { getMyRanksPositionDashboard } from "@/lib/my-ranks";
import { scoreableEffectivePicks } from "@/lib/reserves/from-submission";
import type {
  ContestPosition,
  ContestStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type CompetitorLiveClass =
  | "EXPERT"
  | "CREATOR"
  | "AI"
  | "PUBLISHER_CONSENSUS";

export type CompetitorLiveFilter = "ALL" | CompetitorLiveClass;

export type CompetitorVisibilityFilter =
  | "ALL"
  | "PUBLIC"
  | "PRIVATE_TRACKED";

export type CompetitorPositionLiveCell = {
  position: ContestPosition;
  contestId: string | null;
  contestStatus: ContestStatus | null;
  submissionStatus: SubmissionStatus | null;
  hasSubmission: boolean;
  locked: boolean;
  isFinal: boolean;
  eyeqScore: number | null;
  eyeqIsLive: boolean;
  resolvedCount: number;
  totalPicks: number;
};

export type CompetitorLiveRow = {
  profileId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  competitorClass: CompetitorLiveClass;
  affiliation: string;
  sourceUrl: string | null;
  bio: string | null;
  competitorActive: boolean;
  publicVisible: boolean;
  publicFromWeekId: string | null;
  visibilityState: CompetitorVisibilityState;
  visibilityBadge: string;
  positions: CompetitorPositionLiveCell[];
  submittedCount: number;
  expectedCount: number;
  missingCount: number;
  manageRankingsHref: string | null;
  editType: "ai" | "creator" | "expert" | "publisher";
};

export type CompetitorLiveSummary = {
  activeExperts: number;
  activeCreators: number;
  activeAi: number;
  activePublishers: number;
  boardsSubmitted: number;
  boardsMissing: number;
};

function seedVisibilityFields(seed: {
  competitorClass: CompetitorLiveClass;
  competitorActive: boolean;
  publicVisible: boolean;
}) {
  const profileType =
    seed.competitorClass === "CREATOR"
      ? ("CREATOR" as const)
      : seed.competitorClass === "AI"
        ? ("AI" as const)
        : ("BENCHMARK" as const);
  return {
    profileType,
    competitorActive: seed.competitorActive,
    publicVisible: seed.publicVisible,
  };
}

function classLabel(cls: CompetitorLiveClass): string {
  switch (cls) {
    case "EXPERT":
      return "Expert";
    case "CREATOR":
      return "Creator";
    case "AI":
      return "AI";
    case "PUBLISHER_CONSENSUS":
      return "Publisher Consensus";
  }
}

export function competitorLiveClassLabel(cls: CompetitorLiveClass) {
  return classLabel(cls);
}

function manageHref(input: {
  competitorClass: CompetitorLiveClass;
  profileId: string;
  weekId: string;
  positions: CompetitorPositionLiveCell[];
}): string | null {
  const target =
    input.positions.find((cell) => !cell.hasSubmission && cell.contestId) ??
    input.positions.find((cell) => cell.contestId) ??
    null;
  if (!target?.contestId) return null;

  if (input.competitorClass === "AI") {
    return `/admin/ai/${input.profileId}/${target.contestId}`;
  }
  if (input.competitorClass === "CREATOR") {
    return `/admin/creators/board/${input.profileId}/${target.contestId}?weekId=${input.weekId}`;
  }
  return `/admin/benchmarks/${input.profileId}/${target.contestId}`;
}

export async function listCompetitorLiveRoom(input: {
  weekId: string;
  filter?: CompetitorLiveFilter;
  visibilityFilter?: CompetitorVisibilityFilter;
}): Promise<{
  summary: CompetitorLiveSummary;
  rows: CompetitorLiveRow[];
}> {
  const filter = input.filter ?? "ALL";
  const visibilityFilter = input.visibilityFilter ?? "ALL";
  const [ais, creators, benchmarks, contests] = await Promise.all([
    listActiveAiCompetitors(),
    listActiveCreatorCompetitors(),
    listActiveBenchmarkSources(),
    prisma.rankIQContest.findMany({
      where: { weekId: input.weekId },
      select: {
        id: true,
        position: true,
        status: true,
        rankingDepth: true,
      },
    }),
  ]);

  const experts = benchmarks.filter((row) =>
    isAnalystExpertSource(row.expertSource?.sourceKind),
  );
  const publishers = benchmarks.filter((row) =>
    isPublisherConsensusSource(row.expertSource?.sourceKind),
  );

  type Seed = {
    profileId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    competitorActive: boolean;
    publicVisible: boolean;
    publicFromWeekId: string | null;
    competitorClass: CompetitorLiveClass;
    affiliation: string;
    sourceUrl: string | null;
    editType: CompetitorLiveRow["editType"];
  };

  const seeds: Seed[] = [];

  if (filter === "ALL" || filter === "AI") {
    for (const row of ais) {
      seeds.push({
        profileId: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        bio: row.bio,
        competitorActive: row.competitorActive,
        publicVisible: row.publicVisible,
        publicFromWeekId: row.publicFromWeekId ?? null,
        competitorClass: "AI",
        affiliation: row.displayName,
        sourceUrl: null,
        editType: "ai",
      });
    }
  }

  if (filter === "ALL" || filter === "CREATOR") {
    for (const row of creators) {
      seeds.push({
        profileId: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        bio: row.bio,
        competitorActive: row.competitorActive,
        publicVisible: row.publicVisible,
        publicFromWeekId: row.publicFromWeekId ?? null,
        competitorClass: "CREATOR",
        affiliation: row.creatorCompetitor?.brandName?.trim() || "Creator",
        sourceUrl: row.creatorCompetitor?.sourceUrl ?? null,
        editType: "creator",
      });
    }
  }

  if (filter === "ALL" || filter === "EXPERT") {
    for (const row of experts) {
      seeds.push({
        profileId: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        bio: row.bio,
        competitorActive: row.competitorActive,
        publicVisible: row.publicVisible,
        publicFromWeekId: row.publicFromWeekId ?? null,
        competitorClass: "EXPERT",
        affiliation: row.expertSource?.publicationName?.trim() || "Expert",
        sourceUrl: row.expertSource?.sourceUrl ?? null,
        editType: "expert",
      });
    }
  }

  if (filter === "ALL" || filter === "PUBLISHER_CONSENSUS") {
    for (const row of publishers) {
      seeds.push({
        profileId: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        bio: row.bio,
        competitorActive: row.competitorActive,
        publicVisible: row.publicVisible,
        publicFromWeekId: row.publicFromWeekId ?? null,
        competitorClass: "PUBLISHER_CONSENSUS",
        affiliation: row.expertSource?.publicationName?.trim() || "Publisher",
        sourceUrl: row.expertSource?.sourceUrl ?? null,
        editType: "publisher",
      });
    }
  }

  const filteredSeeds = seeds.filter((seed) => {
    const state = resolveCompetitorVisibility(seedVisibilityFields(seed));
    if (visibilityFilter === "PUBLIC") return state === "AUTHORIZED_PUBLIC";
    if (visibilityFilter === "PRIVATE_TRACKED") {
      return state === "PRIVATE_TRACKED";
    }
    return true;
  });

  const profileIds = filteredSeeds.map((seed) => seed.profileId);
  const contestIds = contests.map((contest) => contest.id);
  const contestByPosition = new Map(
    contests.map((contest) => [contest.position, contest]),
  );

  const [submissions, entries] = await Promise.all([
    profileIds.length === 0 || contestIds.length === 0
      ? Promise.resolve([])
      : prisma.rankingSubmission.findMany({
          where: {
            universalProfileId: { in: profileIds },
            contestId: { in: contestIds },
          },
          include: {
            picks: {
              select: {
                rankableEntryId: true,
                predictedRank: true,
                wasUnavailableAtKickoff: true,
                reserveEligiblePredecessorIds: true,
                rankableEntry: {
                  select: {
                    availability: true,
                    gameStartsAt: true,
                    game: { select: { startsAt: true } },
                  },
                },
              },
            },
            contest: {
              select: {
                id: true,
                position: true,
                rankingDepth: true,
                status: true,
              },
            },
          },
        }),
    contestIds.length === 0
      ? Promise.resolve([])
      : prisma.contestEntry.findMany({
          where: { contestId: { in: contestIds }, excluded: false },
          select: {
            contestId: true,
            rankableEntryId: true,
            fantasyPoints: true,
            actualRank: true,
          },
        }),
  ]);

  const entriesByContest = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = entriesByContest.get(entry.contestId) ?? [];
    list.push(entry);
    entriesByContest.set(entry.contestId, list);
  }

  const provisionalByContest = new Map<string, Map<string, number>>();
  for (const contest of contests) {
    const contestEntries = entriesByContest.get(contest.id) ?? [];
    const isFinal = contest.status === "FINAL" || contest.status === "ARCHIVED";
    if (isFinal) {
      provisionalByContest.set(
        contest.id,
        new Map(
          contestEntries
            .filter((entry) => entry.actualRank != null)
            .map((entry) => [entry.rankableEntryId, entry.actualRank!]),
        ),
      );
    } else {
      const ranked = provisionalRanksFromPoints(contestEntries);
      provisionalByContest.set(
        contest.id,
        new Map(ranked.map((row) => [row.item.rankableEntryId, row.rank])),
      );
    }
  }

  const submissionKey = (profileId: string, contestId: string) =>
    `${profileId}:${contestId}`;
  const submissionByKey = new Map(
    submissions.map((submission) => [
      submissionKey(submission.universalProfileId, submission.contestId),
      submission,
    ]),
  );

  const rows: CompetitorLiveRow[] = filteredSeeds.map((seed) => {
    const visibilityState = resolveCompetitorVisibility(
      seedVisibilityFields(seed),
    );
    const positions: CompetitorPositionLiveCell[] = CONTEST_POSITIONS.map(
      (position) => {
        const contest = contestByPosition.get(position) ?? null;
        if (!contest) {
          return {
            position,
            contestId: null,
            contestStatus: null,
            submissionStatus: null,
            hasSubmission: false,
            locked: false,
            isFinal: false,
            eyeqScore: null,
            eyeqIsLive: false,
            resolvedCount: 0,
            totalPicks: 0,
          };
        }

        const submission =
          submissionByKey.get(submissionKey(seed.profileId, contest.id)) ?? null;
        const isFinal =
          contest.status === "FINAL" || contest.status === "ARCHIVED";
        const hasSubmission = Boolean(
          submission && submissionIsEligible(submission.status),
        );
        const locked =
          submission?.status === "LOCKED" ||
          submission?.status === "GRADED" ||
          contest.status === "LOCKED" ||
          contest.status === "LIVE" ||
          contest.status === "GRADING" ||
          isFinal;

        let eyeqScore: number | null = null;
        let eyeqIsLive = false;
        let resolvedCount = 0;
        let totalPicks = contest.rankingDepth;

        if (hasSubmission && submission) {
          totalPicks = contest.rankingDepth;
          if (isFinal && submission.normalizedScore != null) {
            eyeqScore = submission.normalizedScore;
            eyeqIsLive = false;
            resolvedCount = totalPicks;
          } else if (!isFinal) {
            if (
              !isScorablePickCount(submission.picks.length, contest.rankingDepth)
            ) {
              // incomplete board — leave EYEQ empty
            } else {
              const rankById = provisionalByContest.get(contest.id) ?? new Map();
              const effective = scoreableEffectivePicks({
                picks: submission.picks,
                scoringDepth: contest.rankingDepth,
              });
              const summary = scoreProvisionalEyeq(
                effective.map((pick) => ({
                  playerId: pick.playerId,
                  playerName: pick.playerId,
                  predictedRank: pick.predictedRank,
                  provisionalActualRank: rankById.get(pick.playerId) ?? null,
                })),
                contest.rankingDepth,
              );
              resolvedCount = summary.resolvedCount;
              if (summary.resolvedCount > 0) {
                eyeqScore = summary.liveEyeqScore;
                eyeqIsLive = true;
              }
            }
          }
        }

        return {
          position,
          contestId: contest.id,
          contestStatus: contest.status,
          submissionStatus: submission?.status ?? null,
          hasSubmission,
          locked,
          isFinal,
          eyeqScore,
          eyeqIsLive,
          resolvedCount,
          totalPicks,
        };
      },
    );

    const submittedCount = positions.filter((cell) => cell.hasSubmission).length;
    const expectedCount = positions.filter((cell) => cell.contestId).length;

    return {
      ...seed,
      visibilityState,
      visibilityBadge: competitorVisibilityBadgeLabel(visibilityState),
      positions,
      submittedCount,
      expectedCount,
      missingCount: Math.max(0, expectedCount - submittedCount),
      manageRankingsHref: manageHref({
        competitorClass: seed.competitorClass,
        profileId: seed.profileId,
        weekId: input.weekId,
        positions,
      }),
    };
  });

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const allForSummary = await listCompetitorLiveRoomAllClasses(input.weekId);

  return {
    summary: allForSummary,
    rows,
  };
}

async function listCompetitorLiveRoomAllClasses(
  weekId: string,
): Promise<CompetitorLiveSummary> {
  const [ais, creators, benchmarks, contests, submissions] = await Promise.all([
    listActiveAiCompetitors(),
    listActiveCreatorCompetitors(),
    listActiveBenchmarkSources(),
    prisma.rankIQContest.findMany({
      where: { weekId },
      select: { id: true },
    }),
    prisma.rankingSubmission.findMany({
      where: { contest: { weekId } },
      select: {
        status: true,
        universalProfileId: true,
        contestId: true,
      },
    }),
  ]);

  const experts = benchmarks.filter((row) =>
    isAnalystExpertSource(row.expertSource?.sourceKind),
  );
  const publishers = benchmarks.filter((row) =>
    isPublisherConsensusSource(row.expertSource?.sourceKind),
  );

  const trackedIds = new Set([
    ...ais.map((row) => row.id),
    ...creators.map((row) => row.id),
    ...experts.map((row) => row.id),
    ...publishers.map((row) => row.id),
  ]);

  const expectedBoards =
    trackedIds.size * contests.length;
  const submittedBoards = submissions.filter(
    (submission) =>
      trackedIds.has(submission.universalProfileId) &&
      submissionIsEligible(submission.status),
  ).length;

  return {
    activeExperts: experts.length,
    activeCreators: creators.length,
    activeAi: ais.length,
    activePublishers: publishers.length,
    boardsSubmitted: submittedBoards,
    boardsMissing: Math.max(0, expectedBoards - submittedBoards),
  };
}

export async function getCompetitorLiveDetail(input: {
  weekId: string;
  profileId: string;
  position: ContestPosition;
}) {
  return getMyRanksPositionDashboard({
    universalProfileId: input.profileId,
    weekId: input.weekId,
    position: input.position,
  });
}

export async function resolveCompetitorLiveWeekId(weekId?: string) {
  if (weekId) {
    const week = await prisma.week.findFirst({
      where: { id: weekId },
      include: { season: true },
    });
    if (week) return week;
  }
  const context = await getActiveSeasonAndWeek();
  return context?.week ?? null;
}

export function competitorLiveBoardHref(input: {
  weekId: string;
  profileId: string;
  position?: ContestPosition;
  filter?: CompetitorLiveFilter;
  visibility?: CompetitorVisibilityFilter;
}) {
  const params = new URLSearchParams({
    weekId: input.weekId,
    profileId: input.profileId,
  });
  if (input.position) {
    params.set("position", toUiPosition(input.position));
  }
  if (input.filter && input.filter !== "ALL") {
    params.set("filter", input.filter);
  }
  if (input.visibility && input.visibility !== "ALL") {
    params.set("visibility", input.visibility);
  }
  return `/admin/competitors/live?${params.toString()}`;
}
