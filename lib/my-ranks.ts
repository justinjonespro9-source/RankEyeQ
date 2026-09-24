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
import {
  deriveEffectiveBoardFromPicks,
} from "@/lib/reserves/from-submission";
import type { EffectiveBoardResult } from "@/lib/reserves/effective-board";
import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";
import { getSubmissionForProfile } from "@/lib/submissions";
import { opponentFromContestEntryGame } from "@/lib/week-scoped-opponent";
import { resolveMyRanksDefaultWeekId } from "@/lib/historical-nav";
import type {
  ContestPosition,
  ContestStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

/** Primary scoring-board row — ranks come from canonical effectiveBoard.effective. */
export type MyRanksEffectivePickRow = {
  effectiveRank: number;
  originalPredictedRank: number;
  rankableEntryId: string;
  name: string;
  team: string;
  opponent: string;
  fantasyPoints: number | null;
  currentActualRank: number | null;
  standingStatus: ProvisionalStandingStatus;
  showExactHit: boolean;
  fromReserve: boolean;
  reserveSlot: number | null;
};

/** Unavailable ranked players removed from the effective scoring board. */
export type MyRanksDisplacedPickRow = {
  rankableEntryId: string;
  name: string;
  team: string;
  originalPredictedRank: number;
  availability: string | null;
};

/** Immutable original submission rows (audit / transparency). */
export type MyRanksOriginalPickRow = {
  predictedRank: number;
  rankableEntryId: string;
  name: string;
  team: string;
  isReserve: boolean;
  reserveSlot: number | null;
};

/** Reserves strip — activated ranks come from the canonical engine only. */
export type MyRanksReserveRow = {
  reserveSlot: number;
  rankableEntryId: string;
  name: string;
  team: string;
  activatedToRank: number | null;
  availability: string | null;
  unavailable: boolean;
};

/** @deprecated Prefer effectivePicks / originalPicks / reserveRows. */
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
  activatedToRank: number | null;
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
  /** Canonical effective scoring board (primary Your Rankings list). */
  effectivePicks: MyRanksEffectivePickRow[];
  /** Ranked players removed from scoring (OUT/INACTIVE, etc.). */
  displacedPlayers: MyRanksDisplacedPickRow[];
  /** Immutable original Top-N + R1/R2 for audit view. */
  originalPicks: MyRanksOriginalPickRow[];
  /** Reserve strip using canonical activation ranks. */
  reserveRows: MyRanksReserveRow[];
  /** True when anyone was displaced or a reserve activated. */
  hasSubstitution: boolean;
  /** Flat original picks (legacy consumers / empty checks). */
  picks: MyRanksPickRow[];
  activations: Array<{
    reserveName: string;
    reserveSlot: number;
    effectiveRank: number;
  }>;
  eyeq: MyRanksEyeq | null;
  standings: MyRanksStandingRow[];
  perfectBoard: MyRanksStandingRow[];
};

export type MyRanksPickDisplayMeta = {
  rankableEntryId: string;
  predictedRank: number;
  name: string;
  team: string;
  opponent: string;
  fantasyPoints: number | null;
  currentActualRank: number | null;
  availability: string | null;
};

/**
 * Map canonical deriveEffectiveBoard output into My Ranks presentation rows.
 * Does not re-derive compact/promote logic — only projects engine output.
 */
export function buildMyRanksBoardPresentation(input: {
  scoringDepth: number;
  board: EffectiveBoardResult;
  pickMeta: MyRanksPickDisplayMeta[];
  isFinal: boolean;
}): Pick<
  MyRanksPositionDashboard,
  | "effectivePicks"
  | "displacedPlayers"
  | "originalPicks"
  | "reserveRows"
  | "hasSubstitution"
  | "picks"
  | "activations"
> {
  const metaById = new Map(
    input.pickMeta.map((row) => [row.rankableEntryId, row]),
  );
  const activatedByReserveId = new Map(
    input.board.activations.map((a) => [a.reserveEntryId, a]),
  );
  const displacedIds = new Set(
    input.board.displaced.map((d) => d.rankableEntryId),
  );

  const effectivePicks: MyRanksEffectivePickRow[] = input.board.effective.map(
    (row) => {
      const meta = metaById.get(row.rankableEntryId);
      const currentActualRank = meta?.currentActualRank ?? null;
      const showExactHit =
        input.isFinal &&
        currentActualRank != null &&
        currentActualRank === row.predictedRank &&
        currentActualRank <= input.scoringDepth;

      return {
        effectiveRank: row.predictedRank,
        originalPredictedRank: row.originalPredictedRank,
        rankableEntryId: row.rankableEntryId,
        name: meta?.name ?? row.rankableEntryId,
        team: meta?.team ?? "",
        opponent: meta?.opponent ?? "",
        fantasyPoints: meta?.fantasyPoints ?? null,
        currentActualRank,
        standingStatus: provisionalStandingStatus(
          currentActualRank,
          input.scoringDepth,
        ),
        showExactHit,
        fromReserve: row.fromReserve,
        reserveSlot: row.reserveSlot,
      };
    },
  );

  const displacedPlayers: MyRanksDisplacedPickRow[] = input.board.displaced.map(
    (d) => {
      const meta = metaById.get(d.rankableEntryId);
      return {
        rankableEntryId: d.rankableEntryId,
        name: meta?.name ?? d.rankableEntryId,
        team: meta?.team ?? "",
        originalPredictedRank: d.originalPredictedRank,
        availability: d.availability ?? meta?.availability ?? null,
      };
    },
  );

  const originalPicks: MyRanksOriginalPickRow[] = [...input.pickMeta]
    .sort((a, b) => a.predictedRank - b.predictedRank)
    .map((meta) => {
      const isReserve = meta.predictedRank > input.scoringDepth;
      return {
        predictedRank: meta.predictedRank,
        rankableEntryId: meta.rankableEntryId,
        name: meta.name,
        team: meta.team,
        isReserve,
        reserveSlot: isReserve
          ? meta.predictedRank - input.scoringDepth
          : null,
      };
    });

  const reserveRows: MyRanksReserveRow[] = originalPicks
    .filter((row) => row.isReserve)
    .map((row) => {
      const meta = metaById.get(row.rankableEntryId);
      const activation = activatedByReserveId.get(row.rankableEntryId);
      const availability = meta?.availability ?? null;
      return {
        reserveSlot: row.reserveSlot!,
        rankableEntryId: row.rankableEntryId,
        name: row.name,
        team: row.team,
        activatedToRank: activation?.effectiveRank ?? null,
        availability,
        unavailable: isPromotionUnavailable(availability),
      };
    });

  const activations = input.board.activations.map((a) => ({
    reserveName: metaById.get(a.reserveEntryId)?.name ?? a.reserveEntryId,
    reserveSlot: a.reserveSlot,
    effectiveRank: a.effectiveRank,
  }));

  const picks: MyRanksPickRow[] = input.pickMeta.map((meta) => {
    const isReserve = meta.predictedRank > input.scoringDepth;
    const activation = activatedByReserveId.get(meta.rankableEntryId);
    const effectiveRow = input.board.effective.find(
      (row) => row.rankableEntryId === meta.rankableEntryId,
    );
    const showExactHit =
      input.isFinal &&
      !isReserve &&
      !displacedIds.has(meta.rankableEntryId) &&
      meta.currentActualRank != null &&
      effectiveRow != null &&
      meta.currentActualRank === effectiveRow.predictedRank &&
      meta.currentActualRank <= input.scoringDepth;

    return {
      predictedRank: meta.predictedRank,
      rankableEntryId: meta.rankableEntryId,
      name: meta.name,
      team: meta.team,
      opponent: meta.opponent,
      fantasyPoints: meta.fantasyPoints,
      currentActualRank: meta.currentActualRank,
      standingStatus: provisionalStandingStatus(
        meta.currentActualRank,
        input.scoringDepth,
      ),
      showExactHit,
      isReserve,
      reserveSlot: isReserve ? meta.predictedRank - input.scoringDepth : null,
      activatedToRank: activation?.effectiveRank ?? null,
      displaced: displacedIds.has(meta.rankableEntryId),
    };
  });

  return {
    effectivePicks,
    displacedPlayers,
    originalPicks,
    reserveRows,
    hasSubstitution:
      displacedPlayers.length > 0 || activations.length > 0,
    picks,
    activations,
  };
}

export type MyRanksWeekNavItem = {
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  status: string;
};

export type MyRanksWeekContext = {
  /** Resolved default / selected week id for the page. */
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  /** Active (OPEN/LOCKED preferential) season week — for live vs historical UX. */
  activeWeekId: string;
  positions: ContestPosition[];
  /** Season weeks for navigation (newest first). */
  weeks: MyRanksWeekNavItem[];
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

export async function getMyRanksWeekContext(input?: {
  universalProfileId?: string;
  weekId?: string | null;
}): Promise<MyRanksWeekContext | null> {
  const context = await getActiveSeasonAndWeek();
  if (!context?.week || !context.season) return null;

  const weeks = [...context.season.weeks]
    .map((week) => ({
      weekId: week.id,
      weekLabel: week.label,
      weekNumber: week.weekNumber,
      status: week.status,
    }))
    .sort((a, b) => b.weekNumber - a.weekNumber);

  const activeWeekId = context.week.id;
  let resolvedWeekId = input?.weekId ?? null;

  if (!resolvedWeekId) {
    if (input?.universalProfileId) {
      const eligible = await prisma.rankingSubmission.findMany({
        where: {
          universalProfileId: input.universalProfileId,
          status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
          contest: {
            week: { seasonId: context.season.id, isTest: false },
          },
        },
        select: {
          contest: {
            select: {
              weekId: true,
              week: { select: { weekNumber: true } },
            },
          },
        },
      });
      const submissions = eligible.map((row) => ({
        weekId: row.contest.weekId,
        weekNumber: row.contest.week.weekNumber,
      }));
      // Dedupe by weekId keeping max weekNumber (identical)
      const byWeek = new Map<string, number>();
      for (const row of submissions) {
        byWeek.set(row.weekId, row.weekNumber);
      }
      resolvedWeekId = resolveMyRanksDefaultWeekId({
        activeWeekId,
        submissions: [...byWeek.entries()].map(([weekId, weekNumber]) => ({
          weekId,
          weekNumber,
        })),
      });
    } else {
      resolvedWeekId = activeWeekId;
    }
  }

  const selected =
    weeks.find((week) => week.weekId === resolvedWeekId) ??
    weeks.find((week) => week.weekId === activeWeekId) ??
    weeks[0];
  if (!selected) return null;

  return {
    weekId: selected.weekId,
    weekLabel: selected.weekLabel,
    weekNumber: selected.weekNumber,
    activeWeekId,
    positions: [...CONTEST_POSITIONS],
    weeks,
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
    effectivePicks: [],
    displacedPlayers: [],
    originalPicks: [],
    reserveRows: [],
    hasSubstitution: false,
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
        game: {
          select: {
            id: true,
            weekId: true,
            homeTeam: true,
            awayTeam: true,
            startsAt: true,
          },
        },
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

  const gameByEntryId = new Map(
    contestEntries.map((entry) => [entry.rankableEntryId, entry.game]),
  );
  const pickMeta = submission.picks.map((pick) => ({
    rankableEntryId: pick.rankableEntryId,
    predictedRank: pick.predictedRank,
    name: pick.rankableEntry.name,
    team: pick.rankableEntry.team,
    opponent: opponentFromContestEntryGame({
      team: pick.rankableEntry.team,
      weekId: week.id,
      contestGame: gameByEntryId.get(pick.rankableEntryId) ?? null,
    }),
    fantasyPoints: pointsById.get(pick.rankableEntryId) ?? null,
    currentActualRank: isFinal
      ? (finalById.get(pick.rankableEntryId) ?? null)
      : (provisionalById.get(pick.rankableEntryId) ?? null),
    availability: pick.rankableEntry.availability ?? null,
  }));

  const presentation = buildMyRanksBoardPresentation({
    scoringDepth: rankingDepth,
    board: effectiveBoard,
    pickMeta,
    isFinal,
  });
  base.effectivePicks = presentation.effectivePicks;
  base.displacedPlayers = presentation.displacedPlayers;
  base.originalPicks = presentation.originalPicks;
  base.reserveRows = presentation.reserveRows;
  base.hasSubstitution = presentation.hasSubstitution;
  base.picks = presentation.picks;
  base.activations = presentation.activations;

  if (isFinal && submission.normalizedScore != null) {
    base.eyeq = {
      score: submission.normalizedScore,
      resolvedCount: rankingDepth,
      totalPicks: rankingDepth,
      isLive: false,
    };
  } else if (!isFinal) {
    const nameById = new Map(
      pickMeta.map((row) => [row.rankableEntryId, row.name]),
    );
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
