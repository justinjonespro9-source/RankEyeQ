import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  findGameForTeam,
  formatOpponentLabel,
} from "@/lib/providers/nfl/eligibility";

export type MatchupRepairRow = {
  contestEntryId: string;
  contestId: string;
  position: ContestPosition;
  rankableEntryId: string;
  name: string;
  team: string;
  status: "correct" | "missing" | "stale" | "unmatched" | "proposed_update";
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
  proposedUpdate: number;
  updated: number;
};

export type WeekMatchupRepairReport = {
  weekId: string;
  weekNumber: number;
  label: string;
  applied: boolean;
  gameCount: number;
  counts: PositionRepairCounts;
  byPosition: Record<ContestPosition, PositionRepairCounts>;
  rows: MatchupRepairRow[];
  snapshots: SnapshotAuditRow[];
  snapshotGuidance: string[];
  week1Untouched: true;
};

function emptyPosCounts(): PositionRepairCounts {
  return {
    correct: 0,
    missing: 0,
    stale: 0,
    unmatched: 0,
    proposedUpdate: 0,
    updated: 0,
  };
}

function classifyEntry(input: {
  currentGameId: string | null;
  proposedId: string | null;
  weekGameIds: Set<string>;
  masterGameId: string | null;
  masterOpponent: string;
  masterKickoff: Date | null;
  proposedOpponent: string | null;
  proposedKickoff: Date | null;
}): MatchupRepairRow["status"] {
  if (!input.proposedId) return "unmatched";

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

/**
 * Audit (and optionally repair) ContestEntry + RankableEntry matchup fields for one week.
 * Never touches other weeks' ContestEntries, ranking picks, or snapshots.
 */
export async function auditRepairWeekMatchups(input: {
  weekId: string;
  apply?: boolean;
  now?: Date;
}): Promise<WeekMatchupRepairReport> {
  const apply = Boolean(input.apply);
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

  const weekGameIds = new Set(week.games.map((game) => game.id));
  const byPosition = Object.fromEntries(
    CONTEST_POSITIONS.map((position) => [position, emptyPosCounts()]),
  ) as WeekMatchupRepairReport["byPosition"];
  const counts = emptyPosCounts();
  const rows: MatchupRepairRow[] = [];

  for (const contest of week.contests) {
    const posCounts = byPosition[contest.position]!;
    for (const entry of contest.entries) {
      const team = entry.weekTeam ?? entry.rankableEntry.team;
      const proposed = findGameForTeam(week.games, team);
      const proposedOpponent = proposed
        ? formatOpponentLabel(team, proposed.homeTeam, proposed.awayTeam)
        : null;
      const currentKickoff =
        entry.game && weekGameIds.has(entry.game.id)
          ? entry.game.startsAt
          : null;
      const currentOpponent =
        entry.game && weekGameIds.has(entry.game.id)
          ? formatOpponentLabel(team, entry.game.homeTeam, entry.game.awayTeam)
          : entry.rankableEntry.opponent;

      const status = classifyEntry({
        currentGameId: entry.gameId,
        proposedId: proposed?.id ?? null,
        weekGameIds,
        masterGameId: entry.rankableEntry.gameId,
        masterOpponent: entry.rankableEntry.opponent,
        masterKickoff: entry.rankableEntry.gameStartsAt,
        proposedOpponent,
        proposedKickoff: proposed?.startsAt ?? null,
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
      } else {
        counts.proposedUpdate += 1;
        posCounts.proposedUpdate += 1;
      }

      const needsWrite = status === "missing" || status === "stale" || status === "proposed_update";
      if (needsWrite) {
        // Dry-run: every writable row is a proposed update in the summary total.
        if (!apply) {
          counts.proposedUpdate += status === "proposed_update" ? 0 : 1;
          posCounts.proposedUpdate += status === "proposed_update" ? 0 : 1;
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
    gameCount: week.games.length,
    counts,
    byPosition,
    rows,
    snapshots: snapshotRows,
    snapshotGuidance,
    week1Untouched: true,
  };
}
