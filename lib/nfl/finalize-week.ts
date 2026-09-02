import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import { logServerEvent } from "@/lib/log";
import { calculateLeagueActualFinishesForWeek } from "@/lib/nfl/actual-finishes";
import { auditAllPools } from "@/lib/nfl/manual/pool-audit";
import {
  countLeagueRankedForPosition,
  formatLeagueDepthMessage,
} from "@/lib/nfl/league-result-depth";
import { commitWeekResults } from "@/lib/nfl/results-import";
import {
  createNflDataProvider,
  isManualNflMode,
  resolveNflProviderName,
} from "@/lib/providers/nfl";
import type { NflDataProvider } from "@/lib/providers/nfl/types";

export type FinalizeWeekReadiness = {
  ready: boolean;
  reasons: string[];
  gamesTotal: number;
  gamesFinal: number;
  contests: number;
  entriesNeedingPoints: number;
  entriesWithPoints: number;
  entriesWithRanks: number;
  provisionalStats: number;
  manualMode: boolean;
  poolsReady: boolean;
};

export async function getFinalizeWeekReadiness(
  weekId: string,
): Promise<FinalizeWeekReadiness> {
  const manualMode = isManualNflMode();
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      games: true,
      contests: {
        include: {
          entries: { where: { excluded: false } },
        },
      },
      playerWeekStats: true,
      defenseWeekStats: true,
    },
  });

  const reasons: string[] = [];
  const gamesTotal = week.games.length;
  const gamesFinal = week.games.filter((game) => game.status === "FINAL").length;

  const poolAudit = await auditAllPools(weekId);
  if (!poolAudit.ready) {
    reasons.push(
      `Player pools not ready (${poolAudit.blockers[0] ?? "see pool audit"})`,
    );
  }

  if (gamesTotal === 0) {
    reasons.push("No NFL games imported for this week");
  } else if (!manualMode && gamesFinal < gamesTotal) {
    reasons.push(`${gamesTotal - gamesFinal} game(s) are not FINAL`);
  }

  const allEntries = week.contests.flatMap((contest) => contest.entries);
  const entriesWithPoints = allEntries.filter(
    (entry) => entry.fantasyPoints != null,
  ).length;
  const entriesNeedingPoints = allEntries.length - entriesWithPoints;
  const entriesWithRanks = allEntries.filter(
    (entry) => entry.actualRank != null,
  ).length;

  if (week.contests.length < 5) {
    reasons.push("Expected five position contests before finalizing");
  }

  if (entriesNeedingPoints > 0) {
    reasons.push(
      `${entriesNeedingPoints} player(s) in weekly pools are missing fantasy points — paste or import results for each position.`,
    );
  }

  const provisionalStats =
    week.playerWeekStats.filter((row) => row.isProvisional).length +
    week.defenseWeekStats.filter((row) => row.isProvisional).length;
  if (provisionalStats > 0) {
    reasons.push(`${provisionalStats} provisional (non-final) stat row(s)`);
  }

  const configuredProvider = resolveNflProviderName();
  if (configuredProvider === "sportsdataio" && !process.env.SPORTSDATAIO_API_KEY) {
    reasons.push("SportsDataIO is selected but the API key is not configured");
  }

  if (!manualMode) {
    if (week.playerWeekStats.length === 0 && week.defenseWeekStats.length === 0) {
      reasons.push("No fantasy stat rows imported — provider readiness is ambiguous");
    }
    const defContest = week.contests.find((contest) => contest.position === "DEF");
    if (defContest && week.defenseWeekStats.length === 0) {
      reasons.push("DEF contest exists but no D/ST stat rows were imported");
    }
  } else {
    // Manual mode: fantasy points on ContestEntry are enough; week stats are optional audit.
    if (entriesWithPoints === 0) {
      reasons.push("No final fantasy points have been pasted for this week");
    }
  }

  for (const contest of week.contests) {
    const minLeagueDepth = Math.min(40, contest.rankingDepth);
    const leagueRanked = await countLeagueRankedForPosition(
      weekId,
      contest.position,
      minLeagueDepth,
    );

    const withRank = contest.entries.filter(
      (e) =>
        e.actualRank != null && e.actualRank <= minLeagueDepth,
    ).length;

    if (leagueRanked < minLeagueDepth && withRank < minLeagueDepth) {
      const found = Math.max(leagueRanked, withRank);
      reasons.push(
        formatLeagueDepthMessage(contest.position, minLeagueDepth, found),
      );
    }
  }

  return {
    ready: reasons.length === 0,
    reasons,
    gamesTotal,
    gamesFinal,
    contests: week.contests.length,
    entriesNeedingPoints,
    entriesWithPoints,
    entriesWithRanks,
    provisionalStats,
    manualMode,
    poolsReady: poolAudit.ready,
  };
}

/**
 * Refresh final stats → calculate finishes → grade all contests → mark COMPLETE.
 * Manual mode skips provider fetch and requires verified-results confirmation.
 */
export async function finalizeWeek(input: {
  weekId: string;
  provider?: NflDataProvider;
  /** Required in manual mode — operator asserts results are verified. */
  resultsVerified?: boolean;
  adminUserId?: string;
}) {
  const manualMode = isManualNflMode();

  if (manualMode && !input.resultsVerified) {
    throw new Error(
      "Manual finalization requires explicit confirmation: all final NFL results have been entered and verified",
    );
  }

  if (!manualMode) {
    const provider = input.provider ?? createNflDataProvider();
    await commitWeekResults({ weekId: input.weekId, provider });
  } else {
    // Mark remaining scheduled games FINAL when points exist for their teams.
    const week = await prisma.week.findUniqueOrThrow({
      where: { id: input.weekId },
      include: {
        games: true,
        contests: {
          include: {
            entries: {
              where: { excluded: false, fantasyPoints: { not: null } },
              include: { rankableEntry: true },
            },
          },
        },
      },
    });
    const teamsWithPoints = new Set(
      week.contests.flatMap((contest) =>
        contest.entries.map((entry) => entry.rankableEntry.team),
      ),
    );
    for (const game of week.games) {
      if (
        game.status !== "FINAL" &&
        (teamsWithPoints.has(game.homeTeam) || teamsWithPoints.has(game.awayTeam))
      ) {
        await prisma.nflGame.update({
          where: { id: game.id },
          data: { status: "FINAL" },
        });
      }
    }
    // Clear provisional flags on manual week stats when finalizing.
    await prisma.playerWeekStat.updateMany({
      where: { weekId: input.weekId, provider: "manual", isProvisional: true },
      data: { isProvisional: false },
    });
    await prisma.defenseWeekStat.updateMany({
      where: { weekId: input.weekId, provider: "manual", isProvisional: true },
      data: { isProvisional: false },
    });
  }

  await calculateLeagueActualFinishesForWeek(input.weekId);

  const readiness = await getFinalizeWeekReadiness(input.weekId);
  if (!readiness.ready) {
    logServerEvent(
      "week.finalize_blocked",
      { weekId: input.weekId, reasons: readiness.reasons },
      "warn",
    );
    throw new Error(
      `Week is not ready to finalize: ${readiness.reasons.join("; ")}`,
    );
  }

  const contests = await prisma.rankIQContest.findMany({
    where: { weekId: input.weekId },
  });

  for (const contest of contests) {
    await gradeContest(contest.id);
  }

  await prisma.week.update({
    where: { id: input.weekId },
    data: { status: "COMPLETE" },
  });

  if (input.adminUserId && manualMode) {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "week.finalize_manual_verified",
        entityType: "Week",
        entityId: input.weekId,
        metadata: {
          resultsVerified: true,
          contestsGraded: contests.length,
        },
      },
    });
  }

  logServerEvent("week.finalized", {
    weekId: input.weekId,
    contestsGraded: contests.length,
    manualMode,
  });

  return {
    weekId: input.weekId,
    contestsGraded: contests.length,
    readiness,
  };
}
