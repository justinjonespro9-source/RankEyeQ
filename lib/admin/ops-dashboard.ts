import { prisma } from "@/lib/db";
import { getWeekTimingState } from "@/lib/timing/week-windows";
import { getWeekResultsAudit } from "@/lib/nfl/results-audit";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";

export type OpsStatus = "Ready" | "Needs Attention" | "Complete";

export type OpsDashboard = {
  week: {
    id: string;
    label: string;
    status: string;
    phase: string;
    rankingsOpenAt: Date | null;
    fullLockAt: Date | null;
    revealStartsAt: Date | null;
    publicReleaseAt: Date | null;
    gamesFinal: number;
    gamesTotal: number;
  };
  positions: Array<{
    position: string;
    contestStatus: string;
    eligibleEntries: number;
    drafts: number;
    submitted: number;
    partiallyLockedBoards: number;
    fullyLockedBoards: number;
    gradedBoards: number;
    statsReady: boolean;
    status: OpsStatus;
  }>;
  bots: {
    expected: number;
    completedByPosition: Record<string, number>;
    missingByPosition: Record<string, string[]>;
  };
  data: {
    scheduleImported: boolean;
    poolsBuilt: boolean;
    statsAvailable: boolean;
    provisionalRows: number;
    missingStats: number;
    readyToFinalize: boolean;
    status: OpsStatus;
  };
};

export async function getOpsDashboard(weekId: string): Promise<OpsDashboard> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      games: true,
      contests: {
        include: {
          entries: { where: { excluded: false } },
          submissions: {
            include: {
              picks: true,
              universalProfile: true,
            },
          },
        },
      },
    },
  });

  const timing = getWeekTimingState({
    rankingsOpenAt: week.rankingsOpenAt,
    fullLockAt: week.fullLockAt,
    revealStartsAt: week.revealStartsAt,
    publicReleaseAt: week.publicReleaseAt,
    weekStatus: week.status,
    anyKickoffStarted: week.games.some(
      (game) => game.status === "IN_PROGRESS" || game.status === "FINAL",
    ),
  });

  const aiProfiles = await prisma.universalProfile.findMany({
    where: { profileType: "AI", competitorActive: true, status: "ACTIVE" },
    select: { id: true, username: true },
  });

  const resultsAudit = await getWeekResultsAudit(weekId);
  const finalize = await getFinalizeWeekReadiness(weekId);

  const completedByPosition: Record<string, number> = {};
  const missingByPosition: Record<string, string[]> = {};

  const positions = week.contests.map((contest) => {
    const drafts = contest.submissions.filter((s) => s.status === "DRAFT").length;
    const submitted = contest.submissions.filter(
      (s) => s.status === "SUBMITTED",
    ).length;
    const fullyLocked = contest.submissions.filter(
      (s) => s.status === "LOCKED" || s.status === "GRADED",
    ).length;
    const graded = contest.submissions.filter((s) => s.status === "GRADED").length;
    const partiallyLockedBoards = contest.submissions.filter((s) =>
      s.picks.some((pick) => pick.slotLocked) &&
      (s.status === "DRAFT" || s.status === "SUBMITTED"),
    ).length;

    const aiDone = contest.submissions.filter(
      (s) =>
        s.universalProfile.profileType === "AI" &&
        (s.status === "SUBMITTED" ||
          s.status === "LOCKED" ||
          s.status === "GRADED"),
    );
    completedByPosition[contest.position] = aiDone.length;
    missingByPosition[contest.position] = aiProfiles
      .filter(
        (bot) => !aiDone.some((s) => s.universalProfileId === bot.id),
      )
      .map((bot) => bot.username);

    const auditContest = resultsAudit.contests.find(
      (row) => row.position === contest.position,
    );
    const statsReady = Boolean(auditContest?.readyToGrade);
    let status: OpsStatus = "Needs Attention";
    if (contest.status === "FINAL" || contest.status === "ARCHIVED") {
      status = "Complete";
    } else if (
      contest.entries.length > 0 &&
      (submitted + fullyLocked > 0 || contest.status === "OPEN")
    ) {
      status = "Ready";
    }

    return {
      position: contest.position,
      contestStatus: contest.status,
      eligibleEntries: contest.entries.length,
      drafts,
      submitted,
      partiallyLockedBoards,
      fullyLockedBoards: fullyLocked,
      gradedBoards: graded,
      statsReady,
      status,
    };
  });

  const dataStatus: OpsStatus = finalize.ready
    ? "Ready"
    : week.status === "COMPLETE"
      ? "Complete"
      : "Needs Attention";

  return {
    week: {
      id: week.id,
      label: week.label,
      status: week.status,
      phase: timing.phase,
      rankingsOpenAt: week.rankingsOpenAt,
      fullLockAt: week.fullLockAt,
      revealStartsAt: week.revealStartsAt,
      publicReleaseAt: week.publicReleaseAt,
      gamesFinal: week.games.filter((g) => g.status === "FINAL").length,
      gamesTotal: week.games.length,
    },
    positions,
    bots: {
      expected: aiProfiles.length,
      completedByPosition,
      missingByPosition,
    },
    data: {
      scheduleImported: week.games.length > 0,
      poolsBuilt: week.contests.every((c) => c.entries.length > 0),
      statsAvailable: resultsAudit.playersWithStats + resultsAudit.defensesWithStats > 0,
      provisionalRows:
        resultsAudit.contests.length > 0
          ? (await prisma.playerWeekStat.count({
              where: { weekId, isProvisional: true },
            })) +
            (await prisma.defenseWeekStat.count({
              where: { weekId, isProvisional: true },
            }))
          : 0,
      missingStats:
        resultsAudit.missingPlayerStats + resultsAudit.missingDefenseStats,
      readyToFinalize: finalize.ready,
      status: dataStatus,
    },
  };
}
