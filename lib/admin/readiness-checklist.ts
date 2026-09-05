import type { StepStatus } from "@/lib/admin/command-center";
import { getOpenWeekRankingsReadiness } from "@/lib/admin/open-week-rankings";
import { buildWeekTimingDisplay } from "@/lib/admin/week-timing-validation";
import { getBenchmarkCoverage } from "@/lib/benchmarks/coverage";
import { getBotCoverage } from "@/lib/admin/bot-coverage";
import { getWeeklyEligibilitySyncStatus } from "@/lib/nfl/weekly-auto-sync";
import { getWeeklyExceptionReview } from "@/lib/nfl/weekly-exceptions";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { RANKEYEQ_V1_SLUG } from "@/lib/ranking-scoring-version";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type ReadinessChecklistItem = {
  key: string;
  label: string;
  status: StepStatus;
  summary: string;
  href?: string;
};

type WeekSnapshot = {
  id: string;
  label: string;
  status: string;
  isTest: boolean;
  rankingsOpenAt: Date | null;
  fullLockAt: Date | null;
  revealStartsAt: Date | null;
  publicReleaseAt: Date | null;
  fantasyScoringVersion: string;
  season: {
    year: number;
    fantasyScoringVersion: string;
    activeRankingScoringVersion?: { slug: string } | null;
  };
  games: { id: string; startsAt: Date; status: string }[];
  contests: {
    id: string;
    position: ContestPosition;
    status: string;
    pregameSnapshot: { id: string } | null;
    entries: { excluded: boolean }[];
    submissions: { status: string; universalProfile: { profileType: string } }[];
  }[];
};

export async function buildWeeklyReadinessChecklist(
  week: WeekSnapshot,
  timing: {
    fullBoardLocked: boolean;
    boardsPublic: boolean;
    canEditUnlocked: boolean;
  },
): Promise<ReadinessChecklistItem[]> {
  const [
    openReadiness,
    eligibilitySync,
    exceptions,
    benchmarkCoverage,
    bots,
    finalize,
    timingDisplay,
  ] = await Promise.all([
    getOpenWeekRankingsReadiness(week.id),
    getWeeklyEligibilitySyncStatus(week.id),
    getWeeklyExceptionReview(week.id),
    getBenchmarkCoverage(week.id),
    getBotCoverage(week.id),
    getFinalizeWeekReadiness(week.id),
    Promise.resolve(
      buildWeekTimingDisplay({
        rankingsOpenAt: week.rankingsOpenAt,
        fullLockAt: week.fullLockAt,
        revealStartsAt: week.revealStartsAt,
        publicReleaseAt: week.publicReleaseAt,
        contestStatuses: week.contests.map(
          (c) => c.status as import("@/lib/generated/prisma/client").ContestStatus,
        ),
      }),
    ),
  ]);

  const seasonOk = Boolean(week.season.year);
  const scheduleOk = week.games.length > 0;
  const contestsOk = week.contests.length === 5;
  const allOpen = week.contests.every((c) => c.status === "OPEN");
  const snapshotCaptured = week.contests.every((c) => c.pregameSnapshot);
  const exceptionCount = exceptions.summary.exceptionCount;

  const scoringOk =
    (week.season.activeRankingScoringVersion?.slug === RANKEYEQ_V1_SLUG ||
      openReadiness.blockers.every((b) => !b.includes("RankEyeQ scoring"))) &&
    (week.fantasyScoringVersion || week.season.fantasyScoringVersion) ===
      FANTASYTRACK_NFL_HALF_PPR_V2;

  const timingOk =
    Boolean(week.rankingsOpenAt && week.fullLockAt && week.publicReleaseAt) &&
    !timingDisplay.warnings.some((w) =>
      [
        "rankings_open_after_lock",
        "lock_before_rankings_open",
        "reveal_before_lock",
        "public_before_reveal",
      ].includes(w.code),
    );

  const items: ReadinessChecklistItem[] = [
    {
      key: "season",
      label: "Season configured",
      status: seasonOk ? "Complete" : "Not Started",
      summary: seasonOk ? `${week.season.year} NFL season` : "No season",
      href: "/admin/seasons",
    },
    {
      key: "schedule",
      label: "Schedule imported",
      status: scheduleOk ? "Complete" : "Not Started",
      summary: scheduleOk
        ? `${week.games.length} games`
        : "Import schedule before opening rankings",
      href: `/admin/data?weekId=${week.id}`,
    },
    {
      key: "roster",
      label: "Roster / player universe synced",
      status: eligibilitySync.seasonPlayerCandidates > 0 ? "Complete" : "Ready",
      summary: `${eligibilitySync.seasonPlayerCandidates} season players`,
      href: "/admin/players",
    },
    {
      key: "eligibility",
      label: "Weekly eligibility synced",
      status: !eligibilitySync.hasSchedule
        ? "Not Started"
        : eligibilitySync.activePoolEntries > 0
          ? "Complete"
          : "Ready",
      summary: `${eligibilitySync.activePoolEntries} active pool entries`,
      href: `/admin/weekly-exceptions?weekId=${week.id}`,
    },
    {
      key: "exceptions",
      label: "Exceptions reviewed",
      status:
        exceptionCount === 0
          ? "Complete"
          : exceptions.summary.excluded > 0
            ? "Needs Attention"
            : "Ready",
      summary:
        exceptionCount === 0
          ? "No blocking exceptions"
          : `${exceptionCount} exception(s) — ${exceptions.summary.excluded} excluded`,
      href: `/admin/weekly-exceptions?weekId=${week.id}`,
    },
    {
      key: "scoring",
      label: "Scoring versions confirmed",
      status: scoringOk ? "Complete" : "Needs Attention",
      summary: scoringOk
        ? `${RANKEYEQ_V1_SLUG} · ${FANTASYTRACK_NFL_HALF_PPR_V2}`
        : "Confirm RankEyeQ + FantasyTrack versions",
      href: "/admin/scoring",
    },
    {
      key: "timing",
      label: "Timing confirmed",
      status: timingOk
        ? timingDisplay.warnings.length > 0
          ? "Needs Attention"
          : "Complete"
        : "Needs Attention",
      summary: timingDisplay.warnings[0]?.message ?? "Chicago NFL windows set",
      href: `/admin?weekId=${week.id}#timing`,
    },
    {
      key: "experts",
      label: "Experts imported",
      status:
        benchmarkCoverage.expectedBoards === 0
          ? "Not Started"
          : benchmarkCoverage.capturedBoards >= benchmarkCoverage.expectedBoards
            ? "Complete"
            : benchmarkCoverage.capturedBoards > 0
              ? "Needs Attention"
              : "Ready",
      summary: `${benchmarkCoverage.capturedBoards}/${benchmarkCoverage.expectedBoards} expert boards`,
      href: `/admin/benchmarks?weekId=${week.id}`,
    },
    {
      key: "ai",
      label: "AI rankings ready",
      status:
        bots.expectedBoards === 0
          ? "Not Started"
          : bots.allBotsComplete
            ? "Complete"
            : bots.submittedBoards > 0
              ? "Needs Attention"
              : "Ready",
      summary: `${bots.submittedBoards}/${bots.expectedBoards} AI boards submitted`,
      href: `/admin/ai?weekId=${week.id}`,
    },
    {
      key: "rankings_open",
      label: "Rankings OPEN",
      status: allOpen
        ? "Complete"
        : openReadiness.ready
          ? "Ready"
          : contestsOk
            ? "Needs Attention"
            : "Not Started",
      summary: allOpen
        ? CONTEST_POSITIONS.map((p) => `${p} OPEN`).join(" · ")
        : openReadiness.blockers[0] ?? "Ready to open week rankings",
      href: `/admin?weekId=${week.id}#open-rankings`,
    },
  ];

  if (timing.fullBoardLocked || week.status !== "OPEN") {
    items.push(
      {
        key: "snapshot",
        label: "Pregame snapshot captured",
        status: snapshotCaptured ? "Complete" : timing.fullBoardLocked ? "Needs Attention" : "Not Started",
        summary: snapshotCaptured
          ? "All contests frozen at lock"
          : timing.fullBoardLocked
            ? "Snapshot missing after lock"
            : "Captures at Sunday full lock",
      },
      {
        key: "results",
        label: "Results imported",
        status: finalize.entriesWithPoints > 0
          ? finalize.entriesNeedingPoints === 0
            ? "Complete"
            : "Needs Attention"
          : "Not Started",
        summary:
          finalize.entriesNeedingPoints > 0
            ? `${finalize.entriesNeedingPoints} pool player(s) missing points`
            : finalize.entriesWithPoints > 0
              ? `${finalize.entriesWithPoints} scored`
              : "Paste or import weekly results",
        href: `/admin/data?weekId=${week.id}`,
      },
      {
        key: "finishes",
        label: "League finishes calculated",
        status: finalize.entriesWithRanks > 0 ? "Complete" : finalize.ready ? "Ready" : "Not Started",
        summary:
          finalize.reasons.find((r) => r.includes("requires at least")) ??
          (finalize.entriesWithRanks > 0
            ? "League-wide ranks assigned"
            : "Runs with results import"),
      },
      {
        key: "graded",
        label: "Rankings graded",
        status: week.contests.every((c) => c.status === "FINAL" || c.status === "ARCHIVED")
          ? "Complete"
          : finalize.ready
            ? "Ready"
            : "Not Started",
        summary: `${week.contests.filter((c) => c.status === "FINAL" || c.status === "ARCHIVED").length}/5 contests graded`,
      },
      {
        key: "finalized",
        label: "Week finalized",
        status:
          week.status === "COMPLETE" || week.status === "ARCHIVED"
            ? "Complete"
            : finalize.ready
              ? "Ready"
              : "Not Started",
        summary:
          finalize.reasons[0] ??
          (week.status === "COMPLETE" ? "Week complete" : "Finalize when results verified"),
        href: `/admin/data?weekId=${week.id}`,
      },
      {
        key: "archived",
        label: "Week archived",
        status: week.status === "ARCHIVED" ? "Complete" : week.status === "COMPLETE" ? "Ready" : "Not Started",
        summary: week.status === "ARCHIVED" ? "Archived" : week.status,
      },
    );
  }

  return items;
}
