import { prisma } from "@/lib/db";
import {
  CONTEST_POSITIONS,
  rankingDepthForPosition,
  submissionDepthFromScoring,
} from "@/lib/contest-defaults";
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
import { deriveEffectiveBoardFromPicks } from "@/lib/reserves/from-submission";
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
  isReserve: boolean;
  reserveSlot: number | null;
  /** When this reserve was promoted into the effective scoring board. */
  activatedToRank: number | null;
  replacedName: string | null;
  replacedAvailability: string | null;
  /** Displaced from active board (OUT etc.) — still shown on original board. */
  displaced: boolean;
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
  submissionDepth: number;
  contestId: string | null;
  contestStatus: ContestStatus | null;
  isFinal: boolean;
  submissionStatus: SubmissionStatus | null;
  picks: MyRanksPickRow[];
  activations: Array<{
    reserveName: string;
    reserveSlot: number;
    effectiveRank: number;
    replacedName: string;
    replacedAvailability: string | null;
  }>;
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
  const submissionDepth = submissionDepthFromScoring(rankingDepth);
  const isFinal =
    contest?.status === "FINAL" || contest?.status === "ARCHIVED";

  const base: MyRanksPositionDashboard = {
    position: input.position,
    weekId: week.id,
    weekLabel: week.label,
    weekNumber: week.weekNumber,
    rankingDepth,
    submissionDepth,
    contestId: contest?.id ?? null,
    contestStatus: contest?.status ?? null,
    isFinal,
    submissionStatus: null,
    picks: [],
    activations: [],
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

  const effectiveBoard = deriveEffectiveBoardFromPicks({
    picks: submission.picks,
    scoringDepth: rankingDepth,
  });
  const activatedByReserveId = new Map(
    effectiveBoard.activations.map((a) => [a.reserveEntryId, a]),
  );
  const displacedIds = new Set(
    effectiveBoard.displaced.map((d) => d.rankableEntryId),
  );
  const nameById = new Map(
    submission.picks.map((p) => [p.rankableEntryId, p.rankableEntry.name]),
  );

  base.activations = effectiveBoard.activations.map((a) => ({
    reserveName: nameById.get(a.reserveEntryId) ?? a.reserveEntryId,
    reserveSlot: a.reserveSlot,
    effectiveRank: a.effectiveRank,
    replacedName: nameById.get(a.replacedEntryId) ?? a.replacedEntryId,
    replacedAvailability: a.replacedAvailability,
  }));

  base.picks = submission.picks.map((pick) => {
    const currentActualRank = isFinal
      ? (finalById.get(pick.rankableEntryId) ?? null)
      : (provisionalById.get(pick.rankableEntryId) ?? null);
    const fantasyPoints = pointsById.get(pick.rankableEntryId) ?? null;
    const isReserve = pick.predictedRank > rankingDepth;
    const activation = activatedByReserveId.get(pick.rankableEntryId);
    const effectiveRow = effectiveBoard.effective.find(
      (row) => row.rankableEntryId === pick.rankableEntryId,
    );
    const showExactHit =
      isFinal &&
      !isReserve &&
      !displacedIds.has(pick.rankableEntryId) &&
      currentActualRank != null &&
      effectiveRow != null &&
      currentActualRank === effectiveRow.predictedRank &&
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
      isReserve,
      reserveSlot: isReserve ? pick.predictedRank - rankingDepth : null,
      activatedToRank: activation?.effectiveRank ?? null,
      replacedName: activation
        ? (nameById.get(activation.replacedEntryId) ?? null)
        : null,
      replacedAvailability: activation?.replacedAvailability ?? null,
      displaced: displacedIds.has(pick.rankableEntryId),
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
      effectiveBoard.effective.map((row) => ({
        playerId: row.rankableEntryId,
        playerName: nameById.get(row.rankableEntryId) ?? row.rankableEntryId,
        predictedRank: row.predictedRank,
        provisionalActualRank:
          provisionalById.get(row.rankableEntryId) ?? null,
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
