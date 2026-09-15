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
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  CONTEST_POSITIONS,
} from "@/lib/contest-defaults";

export type PreflightStatus = "PASS" | "WARNING" | "BLOCKED";

export type FinalizePreflightCheck = {
  key: string;
  label: string;
  status: PreflightStatus;
  detail: string;
  position?: ContestPosition | null;
};

export type FinalizePositionRow = {
  position: ContestPosition;
  contestId: string | null;
  contestStatus: string | null;
  poolSize: number;
  withPoints: number;
  withRanks: number;
  eligibleSubmissions: number;
  lockedOrGradedSubmissions: number;
  unlockedSubmitted: number;
  hasPregameSnapshot: boolean;
  readyToGrade: boolean;
  status: PreflightStatus;
  notes: string[];
};

export type FinalizeWeekReadiness = {
  ready: boolean;
  reasons: string[];
  checks: FinalizePreflightCheck[];
  positions: FinalizePositionRow[];
  gamesTotal: number;
  gamesFinal: number;
  contests: number;
  entriesNeedingPoints: number;
  entriesWithPoints: number;
  entriesWithRanks: number;
  provisionalStats: number;
  unlockedSubmittedBoards: number;
  missingPregameSnapshots: number;
  manualMode: boolean;
  poolsReady: boolean;
  weekLabel: string;
  weekNumber: number;
  weekStatus: string;
};

function pushCheck(
  checks: FinalizePreflightCheck[],
  check: FinalizePreflightCheck,
) {
  checks.push(check);
}

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
          submissions: {
            select: { id: true, status: true },
          },
          pregameSnapshot: { select: { id: true } },
        },
      },
      playerWeekStats: true,
      defenseWeekStats: true,
    },
  });

  const checks: FinalizePreflightCheck[] = [];
  const reasons: string[] = [];

  const gamesTotal = week.games.length;
  const gamesFinal = week.games.filter((game) => game.status === "FINAL").length;

  const poolAudit = await auditAllPools(weekId);
  if (!poolAudit.ready) {
    const detail = `Player pools not ready (${poolAudit.blockers[0] ?? "see pool audit"})`;
    reasons.push(detail);
    pushCheck(checks, {
      key: "pools",
      label: "Position pools ready",
      status: "BLOCKED",
      detail,
    });
  } else {
    pushCheck(checks, {
      key: "pools",
      label: "Position pools ready",
      status: "PASS",
      detail: "QB/RB/WR/TE/DEF pools audited",
    });
  }

  if (gamesTotal === 0) {
    const detail = "No NFL games imported for this week";
    reasons.push(detail);
    pushCheck(checks, {
      key: "games",
      label: "All NFL games finalized",
      status: "BLOCKED",
      detail,
    });
  } else if (gamesFinal < gamesTotal) {
    const detail = `${gamesTotal - gamesFinal} game(s) are not FINAL (GAME FINALIZED ≠ WEEK FINALIZED)`;
    reasons.push(detail);
    pushCheck(checks, {
      key: "games",
      label: "All NFL games finalized",
      status: "BLOCKED",
      detail,
    });
  } else {
    pushCheck(checks, {
      key: "games",
      label: "All NFL games finalized",
      status: "PASS",
      detail: `${gamesFinal}/${gamesTotal} games FINAL`,
    });
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
    const detail = "Expected five position contests before finalizing";
    reasons.push(detail);
    pushCheck(checks, {
      key: "contests",
      label: "Five position contests present",
      status: "BLOCKED",
      detail,
    });
  } else {
    pushCheck(checks, {
      key: "contests",
      label: "Five position contests present",
      status: "PASS",
      detail: "QB / RB / WR / TE / DEF",
    });
  }

  if (entriesNeedingPoints > 0) {
    const detail = `${entriesNeedingPoints} player(s) in weekly pools are missing fantasy points — paste or import results for each position.`;
    reasons.push(detail);
    pushCheck(checks, {
      key: "fantasy_points",
      label: "Contest entries have fantasy points",
      status: "BLOCKED",
      detail,
    });
  } else if (allEntries.length === 0) {
    const detail = "No contest entries found";
    reasons.push(detail);
    pushCheck(checks, {
      key: "fantasy_points",
      label: "Contest entries have fantasy points",
      status: "BLOCKED",
      detail,
    });
  } else {
    pushCheck(checks, {
      key: "fantasy_points",
      label: "Contest entries have fantasy points",
      status: "PASS",
      detail: `${entriesWithPoints} entries with points`,
    });
  }

  const provisionalStats =
    week.playerWeekStats.filter((row) => row.isProvisional).length +
    week.defenseWeekStats.filter((row) => row.isProvisional).length;
  if (provisionalStats > 0) {
    const detail = `${provisionalStats} provisional (non-final) WeekStat row(s) remain`;
    reasons.push(detail);
    pushCheck(checks, {
      key: "provisional",
      label: "No provisional WeekStat rows for completed games",
      status: "BLOCKED",
      detail,
    });
  } else {
    pushCheck(checks, {
      key: "provisional",
      label: "No provisional WeekStat rows for completed games",
      status: "PASS",
      detail: manualMode
        ? "No provisional rows (manual mode)"
        : "No provisional player/DEF week stats",
    });
  }

  const configuredProvider = resolveNflProviderName();
  if (configuredProvider === "sportsdataio" && !process.env.SPORTSDATAIO_API_KEY) {
    const detail = "SportsDataIO is selected but the API key is not configured";
    reasons.push(detail);
    pushCheck(checks, {
      key: "provider",
      label: "Provider configuration",
      status: "BLOCKED",
      detail,
    });
  }

  if (!manualMode) {
    if (week.playerWeekStats.length === 0 && week.defenseWeekStats.length === 0) {
      const detail =
        "No fantasy stat rows imported — provider readiness is ambiguous";
      reasons.push(detail);
      pushCheck(checks, {
        key: "stat_rows",
        label: "Required player/DEF stats present",
        status: "BLOCKED",
        detail,
      });
    } else {
      const defContest = week.contests.find(
        (contest) => contest.position === "DEF",
      );
      if (defContest && week.defenseWeekStats.length === 0) {
        const detail = "DEF contest exists but no D/ST stat rows were imported";
        reasons.push(detail);
        pushCheck(checks, {
          key: "stat_rows",
          label: "Required player/DEF stats present",
          status: "BLOCKED",
          detail,
        });
      } else {
        pushCheck(checks, {
          key: "stat_rows",
          label: "Required player/DEF stats present",
          status: "PASS",
          detail: `${week.playerWeekStats.length} player + ${week.defenseWeekStats.length} DEF week stats`,
        });
      }
    }
  } else if (entriesWithPoints === 0) {
    const detail = "No final fantasy points have been pasted for this week";
    reasons.push(detail);
    pushCheck(checks, {
      key: "stat_rows",
      label: "Required player/DEF stats present",
      status: "BLOCKED",
      detail,
    });
  } else {
    pushCheck(checks, {
      key: "stat_rows",
      label: "Required player/DEF stats present",
      status: "PASS",
      detail: "Manual fantasy points present on contest entries",
    });
  }

  const contestByPosition = new Map(
    week.contests.map((contest) => [contest.position, contest]),
  );

  const positions: FinalizePositionRow[] = [];
  let unlockedSubmittedBoards = 0;
  let missingPregameSnapshots = 0;

  for (const position of CONTEST_POSITIONS) {
    const contest = contestByPosition.get(position);
    const notes: string[] = [];
    let status: PreflightStatus = "PASS";

    if (!contest) {
      notes.push("Contest missing");
      status = "BLOCKED";
      reasons.push(`${position} contest missing`);
      positions.push({
        position,
        contestId: null,
        contestStatus: null,
        poolSize: 0,
        withPoints: 0,
        withRanks: 0,
        eligibleSubmissions: 0,
        lockedOrGradedSubmissions: 0,
        unlockedSubmitted: 0,
        hasPregameSnapshot: false,
        readyToGrade: false,
        status,
        notes,
      });
      continue;
    }

    const withPoints = contest.entries.filter(
      (entry) => entry.fantasyPoints != null,
    ).length;
    const withRanks = contest.entries.filter(
      (entry) => entry.actualRank != null,
    ).length;
    const eligibleSubmissions = contest.submissions.filter((submission) =>
      ["SUBMITTED", "LOCKED", "GRADED"].includes(submission.status),
    ).length;
    const lockedOrGradedSubmissions = contest.submissions.filter((submission) =>
      ["LOCKED", "GRADED"].includes(submission.status),
    ).length;
    const unlockedSubmitted = contest.submissions.filter(
      (submission) => submission.status === "SUBMITTED",
    ).length;
    unlockedSubmittedBoards += unlockedSubmitted;

    const hasPregameSnapshot = Boolean(contest.pregameSnapshot);
    if (!hasPregameSnapshot && week.fullLockAt && new Date() >= week.fullLockAt) {
      missingPregameSnapshots += 1;
      notes.push("Pregame consensus snapshot missing");
      if (status === "PASS") status = "WARNING";
    }

    if (unlockedSubmitted > 0) {
      notes.push(
        `${unlockedSubmitted} SUBMITTED board(s) not LOCKED yet (still grade-eligible)`,
      );
      if (status === "PASS") status = "WARNING";
    }

    const minLeagueDepth = Math.min(40, contest.rankingDepth);
    const leagueRanked = await countLeagueRankedForPosition(
      weekId,
      contest.position,
      minLeagueDepth,
    );
    const withRankTop = contest.entries.filter(
      (e) => e.actualRank != null && e.actualRank <= minLeagueDepth,
    ).length;

    if (leagueRanked < minLeagueDepth && withRankTop < minLeagueDepth) {
      const found = Math.max(leagueRanked, withRankTop);
      const detail = formatLeagueDepthMessage(
        contest.position,
        minLeagueDepth,
        found,
      );
      notes.push(detail);
      status = "BLOCKED";
      reasons.push(detail);
    }

    const readyToGrade = withRanks >= contest.rankingDepth;
    if (!readyToGrade) {
      notes.push(
        `Need actualRank for at least Top ${contest.rankingDepth} (have ${withRanks})`,
      );
      status = "BLOCKED";
      reasons.push(
        `${position}: need Top ${contest.rankingDepth} actual ranks (have ${withRanks})`,
      );
    }

    if (withPoints < contest.entries.length) {
      notes.push(
        `${contest.entries.length - withPoints} pool entries missing fantasy points`,
      );
      status = "BLOCKED";
    }

    if (notes.length === 0) {
      notes.push("Ready to grade");
    }

    positions.push({
      position,
      contestId: contest.id,
      contestStatus: contest.status,
      poolSize: contest.entries.length,
      withPoints,
      withRanks,
      eligibleSubmissions,
      lockedOrGradedSubmissions,
      unlockedSubmitted,
      hasPregameSnapshot,
      readyToGrade,
      status,
      notes,
    });

    pushCheck(checks, {
      key: `position_${position}`,
      label: `${position} contest ready`,
      status,
      detail: notes.join("; "),
      position,
    });
  }

  if (unlockedSubmittedBoards > 0) {
    pushCheck(checks, {
      key: "submissions_locked",
      label: "Submissions locked",
      status: "WARNING",
      detail: `${unlockedSubmittedBoards} SUBMITTED board(s) are still unlocked — they remain eligible and will grade, but prefer Sunday full lock first`,
    });
  } else {
    pushCheck(checks, {
      key: "submissions_locked",
      label: "Submissions locked",
      status: "PASS",
      detail: "No unlocked SUBMITTED boards remaining",
    });
  }

  if (missingPregameSnapshots > 0) {
    pushCheck(checks, {
      key: "consensus_snapshot",
      label: "Consensus snapshot / freeze",
      status: "WARNING",
      detail: `${missingPregameSnapshots} position(s) missing pregame consensus snapshot after full lock`,
    });
  } else if (week.fullLockAt && new Date() >= week.fullLockAt) {
    pushCheck(checks, {
      key: "consensus_snapshot",
      label: "Consensus snapshot / freeze",
      status: "PASS",
      detail: "Pregame snapshots present for locked week",
    });
  } else {
    pushCheck(checks, {
      key: "consensus_snapshot",
      label: "Consensus snapshot / freeze",
      status: "WARNING",
      detail: "Full lock has not passed yet — snapshot may still be pending",
    });
  }

  const blocked = checks.some((check) => check.status === "BLOCKED");

  return {
    ready: !blocked,
    reasons: [...new Set(reasons)],
    checks,
    positions,
    gamesTotal,
    gamesFinal,
    contests: week.contests.length,
    entriesNeedingPoints,
    entriesWithPoints,
    entriesWithRanks,
    provisionalStats,
    unlockedSubmittedBoards,
    missingPregameSnapshots,
    manualMode,
    poolsReady: poolAudit.ready,
    weekLabel: week.label,
    weekNumber: week.weekNumber,
    weekStatus: week.status,
  };
}

/**
 * Refresh final stats → calculate finishes → grade all contests → mark COMPLETE.
 * Manual mode skips provider fetch and requires verified-results confirmation.
 * Idempotent: re-running regrades in place and keeps Week COMPLETE.
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
    orderBy: { position: "asc" },
  });

  let submissionsGraded = 0;
  let submissionsSkipped = 0;
  const contestResults: Array<{
    position: ContestPosition;
    contestId: string;
    graded: number;
    skipped: number;
    status: string;
    error?: string;
    skipSamples?: Array<{
      pickCount: number;
      expectedSubmissionDepth: number;
      reason: string;
    }>;
  }> = [];
  const contestErrors: string[] = [];

  for (const contest of contests) {
    try {
      const gradeResult = await gradeContest(contest.id);
      submissionsGraded += gradeResult.graded;
      submissionsSkipped += gradeResult.skipped;
      contestResults.push({
        position: contest.position,
        contestId: contest.id,
        graded: gradeResult.graded,
        skipped: gradeResult.skipped,
        status: gradeResult.status,
        skipSamples: gradeResult.skips.slice(0, 5).map((skip) => ({
          pickCount: skip.pickCount,
          expectedSubmissionDepth: skip.expectedSubmissionDepth,
          reason: skip.reason,
        })),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "gradeContest failed";
      contestErrors.push(`${contest.position} (${contest.id}): ${message}`);
      contestResults.push({
        position: contest.position,
        contestId: contest.id,
        graded: 0,
        skipped: 0,
        status: "ERROR",
        error: message,
      });
    }
  }

  if (contestErrors.length > 0) {
    throw new Error(
      `Finalize Week grading failed for ${contestErrors.length} contest(s): ${contestErrors.join(" | ")}`,
    );
  }

  await prisma.week.update({
    where: { id: input.weekId },
    data: { status: "COMPLETE" },
  });

  const finalizedAt = new Date();

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
          submissionsGraded,
          submissionsSkipped,
          positions: contestResults,
        },
      },
    });
  }

  logServerEvent("week.finalized", {
    weekId: input.weekId,
    contestsGraded: contests.length,
    submissionsGraded,
    submissionsSkipped,
    manualMode,
  });

  return {
    weekId: input.weekId,
    weekLabel: readiness.weekLabel,
    weekNumber: readiness.weekNumber,
    contestsGraded: contests.length,
    submissionsGraded,
    submissionsSkipped,
    positions: contestResults,
    finalizedAt: finalizedAt.toISOString(),
    readiness,
  };
}
