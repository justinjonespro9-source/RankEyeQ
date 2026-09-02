import { prisma } from "@/lib/db";
import { getWeekDataAudit } from "@/lib/nfl/audit";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { getWeekResultsAudit } from "@/lib/nfl/results-audit";
import { getBenchmarkCoverage } from "@/lib/benchmarks/coverage";
import { getBotCoverage } from "@/lib/admin/bot-coverage";
import { buildWeeklyReadinessChecklist } from "@/lib/admin/readiness-checklist";
import { getOpenWeekRankingsReadiness } from "@/lib/admin/open-week-rankings";
import { buildWeekTimingDisplay } from "@/lib/admin/week-timing-validation";
import { getWeeklyEligibilitySyncStatus } from "@/lib/nfl/weekly-auto-sync";
import { listRecentAdminAudit } from "@/lib/admin/audit";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import { getWeekTimingState } from "@/lib/timing/week-windows";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type StepStatus = "Complete" | "Ready" | "Needs Attention" | "Not Started";

export type WorkflowStep = {
  key: string;
  label: string;
  status: StepStatus;
  summary: string;
  href?: string;
};

export async function getCommandCenterSnapshot(weekId?: string | null) {
  const seasons = await prisma.season.findMany({
    where: { sport: "NFL" },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
    orderBy: { year: "desc" },
  });
  const activeSeason = seasons.find((season) => season.active) ?? seasons[0] ?? null;
  const weeks = activeSeason?.weeks ?? [];
  const selectedWeekId =
    weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks.find((week) => week.status === "LOCKED")?.id ??
    weeks[0]?.id ??
    null;
  const week = selectedWeekId
    ? await prisma.week.findUnique({
        where: { id: selectedWeekId },
        include: {
          season: { include: { activeRankingScoringVersion: true } },
          games: true,
          contests: {
            include: {
              pregameSnapshot: { select: { id: true } },
              entries: {
                include: { rankableEntry: true, game: true },
              },
              submissions: {
                include: { universalProfile: true, picks: true },
              },
            },
            orderBy: { position: "asc" },
          },
        },
      })
    : null;

  const audit = await listRecentAdminAudit(12);
  if (!week) {
    return {
      seasons,
      activeSeason,
      selectedWeekId: null,
      week: null,
      steps: [] as WorkflowStep[],
      data: null,
      bots: null,
      humanMonitoring: [],
      lockReveal: null,
      finalize: null,
      resultsAudit: null,
      positions: CONTEST_POSITIONS,
      audit,
      openReadiness: null,
      timingDisplay: null,
      readinessChecklist: [],
    };
  }

  const anyKickoffStarted = week.games.some(
    (game) =>
      game.status === "IN_PROGRESS" ||
      game.status === "FINAL" ||
      game.startsAt <= new Date(),
  );
  const timing = getWeekTimingState({
    rankingsOpenAt: week.rankingsOpenAt,
    fullLockAt: week.fullLockAt,
    revealStartsAt: week.revealStartsAt,
    publicReleaseAt: week.publicReleaseAt,
    weekStatus: week.status,
    anyKickoffStarted,
  });

  const dataAudit = await getWeekDataAudit(week.id);
  const resultsAudit = await getWeekResultsAudit(week.id);
  const finalize = await getFinalizeWeekReadiness(week.id);
  const bots = await getBotCoverage(week.id);
  const benchmarkCoverage = await getBenchmarkCoverage(week.id);
  const eligibilitySync = await getWeeklyEligibilitySyncStatus(week.id);
  const openReadiness = await getOpenWeekRankingsReadiness(week.id);
  const timingDisplay = buildWeekTimingDisplay({
    rankingsOpenAt: week.rankingsOpenAt,
    fullLockAt: week.fullLockAt,
    revealStartsAt: week.revealStartsAt,
    publicReleaseAt: week.publicReleaseAt,
    contestStatuses: week.contests.map((c) => c.status),
  });
  const readinessChecklist = await buildWeeklyReadinessChecklist(
    {
      id: week.id,
      label: week.label,
      status: week.status,
      isTest: week.isTest,
      rankingsOpenAt: week.rankingsOpenAt,
      fullLockAt: week.fullLockAt,
      revealStartsAt: week.revealStartsAt,
      publicReleaseAt: week.publicReleaseAt,
      fantasyScoringVersion: week.fantasyScoringVersion,
      season: {
        year: week.season.year,
        fantasyScoringVersion: week.season.fantasyScoringVersion,
        activeRankingScoringVersion: week.season.activeRankingScoringVersion,
      },
      games: week.games,
      contests: week.contests.map((contest) => ({
        id: contest.id,
        position: contest.position,
        status: contest.status,
        pregameSnapshot: contest.pregameSnapshot,
        entries: contest.entries,
        submissions: contest.submissions,
      })),
    },
    timing,
  );

  const playersImported = await prisma.rankableEntry.count({
    where: { type: "PLAYER", position: { in: ["QB", "RB", "WR", "TE"] } },
  });
  const defensesImported = await prisma.rankableEntry.count({
    where: { type: "DEFENSE" },
  });

  const scheduleImported = week.games.length > 0;
  const gamesMapped = week.contests.some((contest) =>
    contest.entries.some((entry) => entry.gameId || entry.rankableEntry.gameStartsAt),
  );
  const poolsBuilt =
    week.contests.length === 5 &&
    week.contests.every((contest) => contest.entries.some((entry) => !entry.excluded));
  const missingKickoff = dataAudit.positions.reduce(
    (sum, row) => sum + row.missingKickoff,
    0,
  );
  const missingOpponent = dataAudit.positions.reduce(
    (sum, row) => sum + row.missingOpponent,
    0,
  );
  const missingTeam = dataAudit.positions.reduce(
    (sum, row) => sum + row.missingTeam,
    0,
  );
  const excluded = week.contests.reduce(
    (sum, contest) =>
      sum + contest.entries.filter((entry) => entry.excluded).length,
    0,
  );
  const manuallyAdded = week.contests.reduce(
    (sum, contest) =>
      sum + contest.entries.filter((entry) => entry.manuallyAdded).length,
    0,
  );

  const individuallyLocked = week.contests.reduce(
    (sum, contest) =>
      sum +
      contest.submissions.reduce(
        (inner, submission) =>
          inner + submission.picks.filter((pick) => pick.slotLocked).length,
        0,
      ),
    0,
  );

  const humanMonitoring = week.contests.map((contest) => {
    const humans = contest.submissions.filter(
      (s) => s.universalProfile.profileType === "HUMAN",
    );
    const ais = contest.submissions.filter(
      (s) => s.universalProfile.profileType === "AI",
    );
    return {
      contestId: contest.id,
      position: contest.position as ContestPosition,
      contestStatus: contest.status,
      drafts: contest.submissions.filter((s) => s.status === "DRAFT").length,
      submitted: contest.submissions.filter((s) => s.status === "SUBMITTED").length,
      locked: contest.submissions.filter((s) => s.status === "LOCKED").length,
      graded: contest.submissions.filter((s) => s.status === "GRADED").length,
      uniqueHumans: new Set(humans.map((s) => s.universalProfileId)).size,
      uniqueAi: new Set(ais.map((s) => s.universalProfileId)).size,
    };
  });

  const gamesInProgress = week.games.filter((g) => g.status === "IN_PROGRESS").length;
  const provisionalStats =
    (await prisma.playerWeekStat.count({
      where: { weekId: week.id, isProvisional: true },
    })) +
    (await prisma.defenseWeekStat.count({
      where: { weekId: week.id, isProvisional: true },
    }));

  const weekSetupStatus: StepStatus =
    week.contests.length === 5 && week.rankingsOpenAt && week.fullLockAt
      ? "Complete"
      : week.rankingsOpenAt
        ? "Needs Attention"
        : week
          ? "Ready"
          : "Not Started";

  const importStatus: StepStatus = scheduleImported && playersImported > 0
    ? poolsBuilt
      ? "Complete"
      : "Ready"
    : scheduleImported || playersImported > 0
      ? "Needs Attention"
      : "Not Started";

  const poolStatus: StepStatus = !scheduleImported
    ? "Not Started"
    : poolsBuilt && missingKickoff === 0 && missingOpponent === 0
      ? "Complete"
      : week.contests.some((c) => c.entries.length > 0)
        ? "Needs Attention"
        : "Ready";

  const aiStatus: StepStatus =
    bots.expectedBoards === 0
      ? "Not Started"
      : bots.allBotsComplete
        ? "Complete"
        : bots.submittedBoards > 0
          ? "Needs Attention"
          : "Ready";

  const humanSubmitted = humanMonitoring.reduce((sum, row) => sum + row.submitted + row.locked + row.graded, 0);
  const humanStatus: StepStatus =
    week.contests.length === 0
      ? "Not Started"
      : humanSubmitted > 0
        ? timing.fullBoardLocked
          ? "Complete"
          : "Ready"
        : timing.canEditUnlocked
          ? "Needs Attention"
          : "Not Started";

  const lockStatus: StepStatus = timing.boardsPublic
    ? "Complete"
    : timing.fullBoardLocked
      ? "Ready"
      : anyKickoffStarted || individuallyLocked > 0
        ? "Needs Attention"
        : "Not Started";

  const liveStatus: StepStatus =
    gamesInProgress > 0 || provisionalStats > 0
      ? resultsAudit.missingPlayerStats + resultsAudit.missingDefenseStats > 0
        ? "Needs Attention"
        : "Ready"
      : week.games.some((g) => g.status === "FINAL")
        ? "Ready"
        : "Not Started";

  const gradedContests = week.contests.filter(
    (c) => c.status === "FINAL" || c.status === "ARCHIVED",
  ).length;
  const finalStatus: StepStatus = week.status === "COMPLETE" || week.status === "ARCHIVED"
    ? "Complete"
    : finalize.ready
      ? "Ready"
      : gradedContests > 0 || finalize.entriesWithPoints > 0
        ? "Needs Attention"
        : "Not Started";

  const archiveStatus: StepStatus =
    week.status === "ARCHIVED"
      ? "Complete"
      : week.status === "COMPLETE"
        ? "Ready"
        : "Not Started";

  const expertStatus: StepStatus =
    benchmarkCoverage.expectedBoards === 0
      ? "Not Started"
      : benchmarkCoverage.capturedBoards >= benchmarkCoverage.expectedBoards
        ? "Complete"
        : benchmarkCoverage.capturedBoards > 0
          ? "Needs Attention"
          : "Ready";

  const eligibilityStatus: StepStatus = !eligibilitySync.hasSchedule
    ? "Not Started"
    : eligibilitySync.activePoolEntries > 0
      ? eligibilitySync.adminExclusions > 0
        ? "Needs Attention"
        : "Complete"
      : "Ready";

  const steps: WorkflowStep[] = [
    {
      key: "setup",
      label: "Week Setup",
      status: weekSetupStatus,
      summary:
        week.contests.length === 5
          ? `${week.label} · 5 contests · timing set`
          : `${week.contests.length}/5 contests created`,
    },
    {
      key: "import",
      label: "Player/Data Import",
      status: importStatus,
      summary: scheduleImported
        ? `${week.games.length} games · ${playersImported} players · ${defensesImported} DEF`
        : "Schedule not imported",
      href: `/admin/data?weekId=${week.id}`,
    },
    {
      key: "pools",
      label: "Contest Pools",
      status: poolStatus,
      summary: poolsBuilt
        ? `Pools built${excluded ? ` · ${excluded} excluded` : ""}${manuallyAdded ? ` · ${manuallyAdded} manual` : ""}`
        : "Build position pools",
      href: `/admin/weekly-pools?weekId=${week.id}`,
    },
    {
      key: "eligibility",
      label: "Eligibility Auto-Sync",
      status: eligibilityStatus,
      summary: `${eligibilitySync.activePoolEntries} active · ${eligibilitySync.adminExclusions} exclusions`,
      href: `/admin/weekly-exceptions?weekId=${week.id}`,
    },
    {
      key: "experts",
      label: "Expert Rankings",
      status: expertStatus,
      summary: `${benchmarkCoverage.capturedBoards}/${benchmarkCoverage.expectedBoards} captured`,
      href: `/admin/benchmarks?weekId=${week.id}`,
    },
    {
      key: "ai",
      label: "AI Rankings",
      status: aiStatus,
      summary: `${bots.submittedBoards}/${bots.expectedBoards} submitted`,
      href: `/admin/ai?weekId=${week.id}`,
    },
    {
      key: "humans",
      label: "Human Submission Monitoring",
      status: humanStatus,
      summary: `${humanMonitoring.reduce((s, r) => s + r.uniqueHumans, 0)} humans · ${humanSubmitted} official boards`,
    },
    {
      key: "lock",
      label: "Lock / Reveal",
      status: lockStatus,
      summary: timing.boardsPublic
        ? "All boards public"
        : timing.revealWindowActive
          ? "Reveal window active"
          : timing.fullBoardLocked
            ? "Sunday lock complete"
            : `${individuallyLocked} early locks`,
    },
    {
      key: "live",
      label: "Live Data",
      status: liveStatus,
      summary: `${gamesInProgress} in progress · ${provisionalStats} provisional rows`,
      href: "/leaderboards/live",
    },
    {
      key: "final",
      label: "Final Results / Grading",
      status: finalStatus,
      summary: finalize.ready
        ? "Ready to finalize"
        : finalize.reasons[0] ?? "Waiting on results",
      href: `/admin/data?weekId=${week.id}`,
    },
    {
      key: "archive",
      label: "Archive",
      status: archiveStatus,
      summary: week.status === "ARCHIVED" ? "Archived" : week.status,
    },
  ];

  return {
    seasons,
    activeSeason,
    selectedWeekId: week.id,
    week,
    timing,
    steps,
    data: {
      scheduleImported,
      playersImported,
      defensesImported,
      gamesMapped,
      poolsBuilt,
      missingKickoff,
      missingOpponent,
      missingTeam,
      excluded,
      manuallyAdded,
      gamesTotal: week.games.length,
      gamesFinal: week.games.filter((g) => g.status === "FINAL").length,
      gamesInProgress,
      provisionalStats,
      missingStats:
        resultsAudit.missingPlayerStats + resultsAudit.missingDefenseStats,
    },
    bots,
    humanMonitoring,
    lockReveal: {
      rankingsOpenAt: week.rankingsOpenAt,
      fullLockAt: week.fullLockAt,
      revealStartsAt: week.revealStartsAt,
      publicReleaseAt: week.publicReleaseAt,
      earlyGamesStarted: timing.phase === "partial-lock" || gamesInProgress > 0 || week.games.some((g) => g.status === "FINAL"),
      individuallyLocked,
      sundayLocked: timing.fullBoardLocked,
      consensusVisible: timing.consensusVisible,
      revealWindowActive: timing.revealWindowActive,
      boardsPublic: timing.boardsPublic,
      phase: timing.phase,
    },
    finalize,
    resultsAudit,
    positions: CONTEST_POSITIONS,
    audit,
    openReadiness,
    timingDisplay,
    readinessChecklist,
  };
}
