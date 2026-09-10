import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS, rankingDepthForPosition } from "@/lib/contest-defaults";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { getActiveSeasonAndWeek } from "@/lib/leaderboards";
import {
  provisionalStandingStatus,
  scoreProvisionalEyeq,
  type ProvisionalStandingStatus,
} from "@/lib/live-provisional";
import {
  getLivePlayerStandings,
  provisionalRanksFromPoints,
  type LivePlayerStanding,
} from "@/lib/live-rankiq";
import { getSubmissionForProfile } from "@/lib/submissions";
import type {
  ContestPosition,
  ContestStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

export type MyRanksPickRow = {
  predictedRank: number;
  rankableEntryId: string;
  name: string;
  team: string;
  opponent: string;
  fantasyPoints: number | null;
  currentActualRank: number | null;
  standingStatus: ProvisionalStandingStatus;
  showExactHit: boolean;
};

export type MyRanksStandingRow = {
  rank: number;
  rankableEntryId: string;
  name: string;
  team: string;
  fantasyPoints: number;
};

export type MyRanksEyeq = {
  score: number;
  resolvedCount: number;
  totalPicks: number;
  isLive: boolean;
};

export type MyRanksPositionDashboard = {
  position: ContestPosition;
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  rankingDepth: number;
  contestId: string | null;
  contestStatus: ContestStatus | null;
  isFinal: boolean;
  submissionStatus: SubmissionStatus | null;
  picks: MyRanksPickRow[];
  eyeq: MyRanksEyeq | null;
  standings: MyRanksStandingRow[];
  perfectBoard: MyRanksStandingRow[];
};

export type MyRanksWeekContext = {
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  positions: ContestPosition[];
};

function toStandingRows(standings: LivePlayerStanding[]): MyRanksStandingRow[] {
  return standings.map((row) => ({
    rank: row.provisionalRank,
    rankableEntryId: row.rankableEntryId,
    name: row.name,
    team: row.team,
    fantasyPoints: row.fantasyPoints,
  }));
}

async function getFinalPositionStandings(
  contestId: string,
): Promise<MyRanksStandingRow[]> {
  const entries = await prisma.contestEntry.findMany({
    where: {
      contestId,
      excluded: false,
      actualRank: { not: null },
    },
    include: { rankableEntry: true },
    orderBy: [{ actualRank: "asc" }, { fantasyPoints: "desc" }],
  });

  return entries.map((entry) => ({
    rank: entry.actualRank!,
    rankableEntryId: entry.rankableEntryId,
    name: entry.rankableEntry.name,
    team: entry.rankableEntry.team,
    fantasyPoints: entry.fantasyPoints ?? 0,
  }));
}

export async function getMyRanksWeekContext(): Promise<MyRanksWeekContext | null> {
  const context = await getActiveSeasonAndWeek();
  if (!context?.week) return null;
  return {
    weekId: context.week.id,
    weekLabel: context.week.label,
    weekNumber: context.week.weekNumber,
    positions: [...CONTEST_POSITIONS],
  };
}

/**
 * Authenticated My Ranks dashboard for one position.
 * Reuses provisionalRanksFromPoints / scoreProvisionalEyeq / live standings.
 */
export async function getMyRanksPositionDashboard(input: {
  universalProfileId: string;
  position: ContestPosition;
  weekId?: string;
}): Promise<MyRanksPositionDashboard | null> {
  const context = await getActiveSeasonAndWeek();
  if (!context?.week) return null;

  const week =
    input.weekId && input.weekId !== context.week.id
      ? await prisma.week.findFirst({
          where: { id: input.weekId, isTest: false },
        })
      : context.week;
  if (!week) return null;

  const contest = await prisma.rankIQContest.findUnique({
    where: {
      weekId_position: { weekId: week.id, position: input.position },
    },
  });

  const rankingDepth =
    contest?.rankingDepth ?? rankingDepthForPosition(input.position);
  const isFinal =
    contest?.status === "FINAL" || contest?.status === "ARCHIVED";

  const base: MyRanksPositionDashboard = {
    position: input.position,
    weekId: week.id,
    weekLabel: week.label,
    weekNumber: week.weekNumber,
    rankingDepth,
    contestId: contest?.id ?? null,
    contestStatus: contest?.status ?? null,
    isFinal,
    submissionStatus: null,
    picks: [],
    eyeq: null,
    standings: [],
    perfectBoard: [],
  };

  if (!contest) return base;

  const [submission, liveStandings, contestEntries] = await Promise.all([
    getSubmissionForProfile(contest.id, input.universalProfileId),
    isFinal
      ? Promise.resolve([])
      : getLivePlayerStandings(contest.id),
    prisma.contestEntry.findMany({
      where: { contestId: contest.id, excluded: false },
      select: {
        rankableEntryId: true,
        fantasyPoints: true,
        actualRank: true,
      },
    }),
  ]);

  const standings = isFinal
    ? await getFinalPositionStandings(contest.id)
    : toStandingRows(liveStandings);

  const perfectBoard = standings
    .filter((row) => row.rank >= 1 && row.rank <= rankingDepth)
    .slice(0, rankingDepth);

  // Prefer competition-rank order for perfect board when ties skip ranks.
  const perfectFromOrder = standings.slice(0, rankingDepth).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));

  base.standings = standings;
  base.perfectBoard = isFinal
    ? perfectBoard.length > 0
      ? perfectBoard
      : perfectFromOrder
    : perfectFromOrder;

  if (!submission || !submissionIsEligible(submission.status)) {
    return base;
  }

  base.submissionStatus = submission.status;

  const provisional = provisionalRanksFromPoints(contestEntries);
  const provisionalById = new Map(
    provisional.map((row) => [row.item.rankableEntryId, row.rank]),
  );
  const finalById = new Map(
    contestEntries
      .filter((entry) => entry.actualRank != null)
      .map((entry) => [entry.rankableEntryId, entry.actualRank!]),
  );
  const pointsById = new Map(
    contestEntries.map((entry) => [entry.rankableEntryId, entry.fantasyPoints]),
  );

  base.picks = submission.picks.map((pick) => {
    const currentActualRank = isFinal
      ? (finalById.get(pick.rankableEntryId) ?? null)
      : (provisionalById.get(pick.rankableEntryId) ?? null);
    const fantasyPoints = pointsById.get(pick.rankableEntryId) ?? null;
    const showExactHit =
      isFinal &&
      currentActualRank != null &&
      currentActualRank === pick.predictedRank &&
      currentActualRank <= rankingDepth;

    return {
      predictedRank: pick.predictedRank,
      rankableEntryId: pick.rankableEntryId,
      name: pick.rankableEntry.name,
      team: pick.rankableEntry.team,
      opponent: pick.rankableEntry.opponent,
      fantasyPoints,
      currentActualRank,
      standingStatus: provisionalStandingStatus(currentActualRank, rankingDepth),
      showExactHit,
    };
  });

  if (isFinal && submission.normalizedScore != null) {
    base.eyeq = {
      score: submission.normalizedScore,
      resolvedCount: rankingDepth,
      totalPicks: rankingDepth,
      isLive: false,
    };
  } else if (!isFinal) {
    const summary = scoreProvisionalEyeq(
      submission.picks.map((pick) => ({
        playerId: pick.rankableEntryId,
        playerName: pick.rankableEntry.name,
        predictedRank: pick.predictedRank,
        provisionalActualRank:
          provisionalById.get(pick.rankableEntryId) ?? null,
      })),
      rankingDepth,
    );
    if (summary.resolvedCount > 0) {
      base.eyeq = {
        score: summary.liveEyeqScore,
        resolvedCount: summary.resolvedCount,
        totalPicks: summary.totalPicks,
        isLive: true,
      };
    }
  }

  return base;
}

/** This Week hub title/description from aggregate submission state. */
export function thisWeekHubCopy(input: {
  weekNumber: number;
  weekLabel: string;
  positions: Array<{
    contestStatus: ContestStatus | null;
    submissionStatus: SubmissionStatus | null;
  }>;
}): { title: string; description: string } {
  const weekName = `Week ${input.weekNumber}`;
  const statuses = input.positions;
  if (statuses.length === 0) {
    return {
      title: `Build Your ${weekName} Rankings`,
      description: input.weekLabel,
    };
  }

  const anySubmitted = statuses.some(
    (row) =>
      row.submissionStatus === "SUBMITTED" ||
      row.submissionStatus === "LOCKED" ||
      row.submissionStatus === "GRADED",
  );
  const anyDraft = statuses.some((row) => row.submissionStatus === "DRAFT");
  const lockedStatuses: ContestStatus[] = [
    "LOCKED",
    "LIVE",
    "GRADING",
    "FINAL",
    "ARCHIVED",
  ];
  const allLocked = statuses.every(
    (row) =>
      row.contestStatus != null && lockedStatuses.includes(row.contestStatus),
  );
  const anyOpen = statuses.some(
    (row) => row.contestStatus === "OPEN" || row.contestStatus === "DRAFT",
  );

  if (allLocked) {
    return {
      title: `Your ${weekName} Rankings`,
      description: "Locked",
    };
  }
  if (anySubmitted && anyOpen) {
    return {
      title: `Your ${weekName} Rankings`,
      description: "Submitted · Editable until lock",
    };
  }
  if (anyDraft) {
    return {
      title: "Continue Your Rankings",
      description: `${weekName} · ${input.weekLabel}`,
    };
  }
  if (anySubmitted) {
    return {
      title: `Your ${weekName} Rankings`,
      description: "Submitted · Editable until lock",
    };
  }
  return {
    title: `Build Your ${weekName} Rankings`,
    description: input.weekLabel,
  };
}
