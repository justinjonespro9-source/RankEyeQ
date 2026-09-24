import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { isMutableWeeklyPool } from "@/lib/nfl/weekly-pool-mutable";
import {
  formatOpponentLabel,
  resolveWeekGameForTeam,
} from "@/lib/providers/nfl/eligibility";

export type MatchupRepairRow = {
  contestEntryId: string;
  contestId: string;
  position: ContestPosition;
  rankableEntryId: string;
  name: string;
  team: string;
  status:
    | "correct"
    | "missing"
    | "stale"
    | "unmatched"
    | "ambiguous"
    | "proposed_update";
  currentGameId: string | null;
  currentKickoffAt: string | null;
  currentOpponent: string;
  proposedGameId: string | null;
  proposedKickoffAt: string | null;
  proposedOpponent: string | null;
};

export type SnapshotAuditRow = {
  snapshotId: string;
  captureType: string;
  status: string;
  contestId: string;
  position: ContestPosition;
  capturedAt: string;
  pickCount: number;
  thursdayKickoffPickCount: number;
  note: string;
};

export type PositionRepairCounts = {
  correct: number;
  missing: number;
  stale: number;
  unmatched: number;
  ambiguous: number;
  proposedUpdate: number;
  updated: number;
};

export type WeekMatchupRepairReport = {
  weekId: string;
  weekNumber: number;
  label: string;
  applied: boolean;
  gameCount: number;
  uniqueTeamCount: number;
  counts: PositionRepairCounts;
  byPosition: Record<ContestPosition, PositionRepairCounts>;
  rows: MatchupRepairRow[];
  snapshots: SnapshotAuditRow[];
  snapshotGuidance: string[];
  week1Untouched: true;
  /** True when apply was requested but week/contests are LOCKED/FINAL/COMPLETE. */
  skippedDueToLifecycle: boolean;
  lifecycleMessage: string | null;
};

/** Operator-facing rollup used by Save Schedule + Sync Matchups UI. */
export type OperatorMatchupSyncSummary = {
  totalEntries: number;
  alreadyCorrect: number;
  newlyLinked: number;
  staleCorrected: number;
  proposedUpdate: number;
  updated: number;
  unmatched: number;
  ambiguous: number;
  /** Entries that would write (or did write) on this run. */
  writable: number;
  /**
   * After apply: alreadyCorrect + updated.
   * Dry-run: alreadyCorrect + writable (unambiguous repairs).
   */
  linkedCorrectly: number;
  needsAttention: number;
  skippedDueToLifecycle: boolean;
  lifecycleMessage: string | null;
  gameCount: number;
  uniqueTeamCount: number;
};

export function emptyPosCounts(): PositionRepairCounts {
  return {
    correct: 0,
    missing: 0,
    stale: 0,
    unmatched: 0,
    ambiguous: 0,
    proposedUpdate: 0,
    updated: 0,
  };
}

/** Pure classification — exported for focused unit tests. */
export function classifyMatchupRepairStatus(input: {
  currentGameId: string | null;
  proposedId: string | null;
  weekGameIds: Set<string>;
  masterGameId: string | null;
  masterOpponent: string;
  masterKickoff: Date | null;
  proposedOpponent: string | null;
  proposedKickoff: Date | null;
  resolutionStatus: "unique" | "ambiguous" | "none";
}): MatchupRepairRow["status"] {
  if (input.resolutionStatus === "ambiguous") return "ambiguous";
  if (input.resolutionStatus === "none" || !input.proposedId) return "unmatched";

  const contestLinkedCorrectly = input.currentGameId === input.proposedId;
  const masterMatches =
    input.masterGameId === input.proposedId &&
    input.masterOpponent === input.proposedOpponent &&
    (input.masterKickoff?.getTime() ?? null) ===
      (input.proposedKickoff?.getTime() ?? null);

  if (contestLinkedCorrectly && masterMatches) return "correct";
  if (input.currentGameId && !input.weekGameIds.has(input.currentGameId)) {
    return "stale";
  }
  if (!input.currentGameId) return "missing";
  return "proposed_update";
}

/** Derive operator numbers from row statuses + updated count. */
export function summarizeMatchupSync(input: {
  report: WeekMatchupRepairReport;
  uniqueTeamCount?: number;
}): OperatorMatchupSyncSummary {
  const { report } = input;
  const alreadyCorrect = report.rows.filter((r) => r.status === "correct").length;
  const missing = report.rows.filter((r) => r.status === "missing").length;
  const stale = report.rows.filter((r) => r.status === "stale").length;
  const proposedUpdate = report.rows.filter(
    (r) => r.status === "proposed_update",
  ).length;
  const unmatched = report.rows.filter((r) => r.status === "unmatched").length;
  const ambiguous = report.rows.filter((r) => r.status === "ambiguous").length;
  const writable = missing + stale + proposedUpdate;
  const updated = report.counts.updated;
  const linkedCorrectly = report.applied
    ? alreadyCorrect + updated
    : alreadyCorrect + writable;

  // Attribute applied updates: missing first, then stale, then proposed_update.
  let remaining = updated;
  const newlyLinked = report.applied ? Math.min(missing, remaining) : 0;
  remaining -= newlyLinked;
  const staleCorrected = report.applied ? Math.min(stale, remaining) : 0;

  return {
    totalEntries: report.rows.length,
    alreadyCorrect,
    newlyLinked,
    staleCorrected,
    proposedUpdate,
    updated,
    unmatched,
    ambiguous,
    writable,
    linkedCorrectly,
    needsAttention: unmatched + ambiguous,
    skippedDueToLifecycle: report.skippedDueToLifecycle,
    lifecycleMessage: report.lifecycleMessage,
    gameCount: report.gameCount,
    uniqueTeamCount: input.uniqueTeamCount ?? report.uniqueTeamCount,
  };
}

export function formatScheduleSaveMatchupMessage(input: {
  created: number;
  updated: number;
  games: number;
  uniqueTeamCount: number;
  summary: OperatorMatchupSyncSummary;
}): string {
  const scheduleLine = `Schedule saved ✓\n${input.games} games · ${input.uniqueTeamCount} teams`;

  if (input.summary.skippedDueToLifecycle) {
    return `${scheduleLine}\nPool matchup sync skipped — ${input.summary.lifecycleMessage ?? "week is not DRAFT/OPEN"}`;
  }

  if (input.summary.totalEntries === 0) {
    return `${scheduleLine}\n0 existing pool entries — matchups will stamp when pools are created`;
  }

  const linked = input.summary.linkedCorrectly;
  const total = input.summary.totalEntries;
  if (input.summary.needsAttention === 0) {
    return `${scheduleLine}\n${linked}/${total} pool matchups synchronized`;
  }

  return `${scheduleLine}\n${linked}/${total} pool matchups synchronized\n${input.summary.needsAttention} entries need attention — use Sync Matchups to review`;
}

export function formatSyncMatchupsMessage(summary: OperatorMatchupSyncSummary): string {
  if (summary.skippedDueToLifecycle) {
    return `Sync Matchups skipped — ${summary.lifecycleMessage ?? "week is not DRAFT/OPEN"}`;
  }
  if (summary.totalEntries === 0) {
    return "Sync Matchups · 0 pool entries — nothing to link";
  }
  const parts = [
    `Sync Matchups · ${summary.linkedCorrectly}/${summary.totalEntries} linked`,
    `repaired ${summary.updated}`,
    `already correct ${summary.alreadyCorrect}`,
    `unmatched ${summary.unmatched}`,
    `ambiguous ${summary.ambiguous}`,
  ];
  if (summary.needsAttention > 0) {
    parts.push(`${summary.needsAttention} need attention`);
  }
  return parts.join(" · ");
}

export function formatPreviewSyncMatchupsMessage(
  summary: OperatorMatchupSyncSummary,
): string {
  if (summary.skippedDueToLifecycle) {
    return `Preview Sync · blocked — ${summary.lifecycleMessage ?? "week is not DRAFT/OPEN"}`;
  }
  if (summary.totalEntries === 0) {
    return "Preview Sync · 0 pool entries";
  }
  return [
    `Preview Sync · ${summary.writable} to repair`,
    `${summary.alreadyCorrect} already correct`,
    `${summary.unmatched} unmatched`,
    `${summary.ambiguous} ambiguous`,
  ].join(" · ");
}

/**
 * Audit (and optionally repair) ContestEntry + RankableEntry matchup fields for one week.
 * Never touches other weeks' ContestEntries, ranking picks, or snapshots.
 *
 * Stamp-only: never creates/deletes ContestEntries, never changes eligibility,
 * RankingPick, RankingSubmission, or PlayerWeekAvailability.
 */
export async function auditRepairWeekMatchups(input: {
  weekId: string;
  apply?: boolean;
  now?: Date;
  /**
   * When true (default for operator paths), refuse writes on LOCKED/FINAL/COMPLETE
   * weeks. Scripts may pass false to force a controlled repair.
   */
  respectLifecycle?: boolean;
  /**
   * When provided, only these NflGame rows are used for team→game resolution.
   * Used after Save Schedule so leftover orphan games cannot create ambiguity.
   */
  scheduleGameIds?: string[];
}): Promise<WeekMatchupRepairReport> {
  const applyRequested = Boolean(input.apply);
  const respectLifecycle = input.respectLifecycle !== false;
  const now = input.now ?? new Date();

  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: {
      games: true,
      contests: {
        include: {
          entries: {
            where: { excluded: false },
            include: {
              game: true,
              rankableEntry: true,
            },
          },
        },
      },
    },
  });

  const mutable = await isMutableWeeklyPool(week.id);
  const skippedDueToLifecycle = respectLifecycle && applyRequested && !mutable;
  const apply = applyRequested && !skippedDueToLifecycle;
  const lifecycleMessage = skippedDueToLifecycle
    ? `Week status is ${week.status} (or a contest is LOCKED/FINAL) — matchup sync is only permitted while DRAFT/OPEN`
    : null;

  const scheduleGames =
    input.scheduleGameIds && input.scheduleGameIds.length > 0
      ? week.games.filter((game) => input.scheduleGameIds!.includes(game.id))
      : week.games;
  // For stale detection, any game on this week (including orphans) counts as
  // "same week"; resolution still uses scheduleGames only.
  const allWeekGameIds = new Set(week.games.map((game) => game.id));
  const uniqueTeams = new Set<string>();
  for (const game of scheduleGames) {
    uniqueTeams.add(game.homeTeam);
    uniqueTeams.add(game.awayTeam);
  }
  const byPosition = Object.fromEntries(
    CONTEST_POSITIONS.map((position) => [position, emptyPosCounts()]),
  ) as WeekMatchupRepairReport["byPosition"];
  const counts = emptyPosCounts();
  const rows: MatchupRepairRow[] = [];

  for (const contest of week.contests) {
    const posCounts = byPosition[contest.position]!;
    for (const entry of contest.entries) {
      const team = entry.weekTeam ?? entry.rankableEntry.team;
      const resolution = resolveWeekGameForTeam(scheduleGames, team);
      const proposed =
        resolution.status === "unique" ? resolution.game : undefined;
      const proposedOpponent = proposed
        ? formatOpponentLabel(team, proposed.homeTeam, proposed.awayTeam)
        : null;
      const currentKickoff =
        entry.game && allWeekGameIds.has(entry.game.id)
          ? entry.game.startsAt
          : null;
      const currentOpponent =
        entry.game && allWeekGameIds.has(entry.game.id)
          ? formatOpponentLabel(team, entry.game.homeTeam, entry.game.awayTeam)
          : entry.rankableEntry.opponent;

      const status = classifyMatchupRepairStatus({
        currentGameId: entry.gameId,
        proposedId: proposed?.id ?? null,
        weekGameIds: allWeekGameIds,
        masterGameId: entry.rankableEntry.gameId,
        masterOpponent: entry.rankableEntry.opponent,
        masterKickoff: entry.rankableEntry.gameStartsAt,
        proposedOpponent,
        proposedKickoff: proposed?.startsAt ?? null,
        resolutionStatus: resolution.status,
      });

      if (status === "correct") {
        counts.correct += 1;
        posCounts.correct += 1;
      } else if (status === "missing") {
        counts.missing += 1;
        posCounts.missing += 1;
      } else if (status === "stale") {
        counts.stale += 1;
        posCounts.stale += 1;
      } else if (status === "unmatched") {
        counts.unmatched += 1;
        posCounts.unmatched += 1;
      } else if (status === "ambiguous") {
        counts.ambiguous += 1;
        posCounts.ambiguous += 1;
      } else {
        counts.proposedUpdate += 1;
        posCounts.proposedUpdate += 1;
      }

      const needsWrite =
        status === "missing" ||
        status === "stale" ||
        status === "proposed_update";
      if (needsWrite && !apply) {
        if (status !== "proposed_update") {
          counts.proposedUpdate += 1;
          posCounts.proposedUpdate += 1;
        }
      }

      if (apply && proposed && needsWrite) {
        await prisma.contestEntry.update({
          where: { id: entry.id },
          data: { gameId: proposed.id },
        });
        await prisma.rankableEntry.update({
          where: { id: entry.rankableEntryId },
          data: {
            opponent: proposedOpponent!,
            gameId: proposed.id,
            gameStartsAt: proposed.startsAt,
          },
        });
        counts.updated += 1;
        posCounts.updated += 1;
      }

      rows.push({
        contestEntryId: entry.id,
        contestId: contest.id,
        position: contest.position,
        rankableEntryId: entry.rankableEntryId,
        name: entry.rankableEntry.name,
        team,
        status,
        currentGameId: entry.gameId,
        currentKickoffAt: currentKickoff?.toISOString() ?? null,
        currentOpponent,
        proposedGameId: proposed?.id ?? null,
        proposedKickoffAt: proposed?.startsAt.toISOString() ?? null,
        proposedOpponent,
      });
    }
  }

  const snapshots = await prisma.benchmarkSnapshot.findMany({
    where: { weekId: week.id },
    include: {
      picks: true,
      contest: { select: { position: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const snapshotRows: SnapshotAuditRow[] = [];
  const snapshotGuidance: string[] = [];

  for (const snap of snapshots) {
    const thursdayKickoffPickCount = snap.picks.filter((pick) => {
      if (!pick.kickoffAt) return false;
      const weekday = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "America/Chicago",
      }).format(pick.kickoffAt);
      return weekday === "Thu";
    }).length;

    snapshotRows.push({
      snapshotId: snap.id,
      captureType: snap.captureType,
      status: snap.status,
      contestId: snap.contestId,
      position: snap.contest.position,
      capturedAt: snap.capturedAt.toISOString(),
      pickCount: snap.picks.length,
      thursdayKickoffPickCount,
      note:
        thursdayKickoffPickCount > 0
          ? "Contains picks stamped with Thursday kickoffs. If those kickoffs belonged to another week, official merges may have mis-applied pre-kickoff locks."
          : "Snapshot left unchanged. Re-evaluate after matchup restamp using competitive publish time.",
    });
  }

  if (snapshotRows.length > 0) {
    snapshotGuidance.push(
      `Found ${snapshotRows.length} Week ${week.weekNumber} benchmark snapshot(s). This repair does not delete or rewrite them.`,
    );
    snapshotGuidance.push(
      "Safest next step: after schedule stamp, re-capture official boards only when the creator's published-before-kickoff time is known. Do not delete audit snapshots.",
    );
  }

  const anyPastThursday = week.games.some((game) => {
    if (now < game.startsAt) return false;
    return (
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "America/Chicago",
      }).format(game.startsAt) === "Thu"
    );
  });
  if (anyPastThursday) {
    snapshotGuidance.push(
      "At least one real Week kickoff has already occurred. Pre-kickoff snapshot membership for those players must follow the legitimate lock rule — do not invent Thursday locks from a later capture without historicalBackfill + sourcePublishedAt.",
    );
  } else if (week.games.length > 0) {
    snapshotGuidance.push(
      "Relative to --now, early Week kickoffs may still be upcoming. After restamping, a creator board published before a player's real kickoff can include that player without a prior Thursday snapshot.",
    );
  }

  return {
    weekId: week.id,
    weekNumber: week.weekNumber,
    label: week.label,
    applied: apply,
    gameCount: scheduleGames.length,
    uniqueTeamCount: uniqueTeams.size,
    counts,
    byPosition,
    rows,
    snapshots: snapshotRows,
    snapshotGuidance,
    week1Untouched: true,
    skippedDueToLifecycle,
    lifecycleMessage,
  };
}
