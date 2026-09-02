import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import { getBenchmarkCoverage } from "@/lib/benchmarks/coverage";

export type WeeklyExceptionRow = {
  kind:
    | "excluded_player"
    | "unknown_eligibility"
    | "new_since_sync"
    | "missing_pool_entry"
    | "expert_import_failure";
  position: ContestPosition;
  rankableEntryId?: string;
  name: string;
  team?: string;
  reason: string;
  href?: string;
};

export async function getWeeklyExceptionReview(weekId: string) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      season: true,
      games: true,
      contests: {
        include: {
          entries: {
            include: { rankableEntry: true },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });

  const scheduledTeams = new Set<string>();
  for (const game of week.games) {
    scheduledTeams.add(game.homeTeam);
    scheduledTeams.add(game.awayTeam);
  }

  const seasonPlayers = await prisma.seasonPlayer.findMany({
    where: {
      seasonId: week.seasonId,
      ...(scheduledTeams.size > 0
        ? { team: { in: [...scheduledTeams] } }
        : {}),
    },
    include: { rankableEntry: true },
    orderBy: { displayName: "asc" },
  });

  const exceptions: WeeklyExceptionRow[] = [];

  for (const contest of week.contests) {
    const entryByPlayer = new Map(
      contest.entries.map((entry) => [entry.rankableEntryId, entry]),
    );

    for (const entry of contest.entries) {
      if (entry.excluded && entry.inactiveReason) {
        exceptions.push({
          kind: "excluded_player",
          position: contest.position,
          rankableEntryId: entry.rankableEntryId,
          name: entry.rankableEntry.name,
          team: entry.weekTeam ?? entry.rankableEntry.team,
          reason: entry.inactiveReason,
          href: `/admin/weekly-pools?weekId=${weekId}&position=${contest.position}`,
        });
      }
    }

    for (const player of seasonPlayers.filter(
      (row) => row.position === contest.position,
    )) {
      const entry = entryByPlayer.get(player.rankableEntryId);
      if (!entry) {
        exceptions.push({
          kind: "missing_pool_entry",
          position: contest.position,
          rankableEntryId: player.rankableEntryId,
          name: player.displayName,
          team: player.team,
          reason: "On season roster with a scheduled game but no weekly contest entry",
          href: `/admin/weekly-pools?weekId=${weekId}&position=${contest.position}`,
        });
      }

      if (
        player.activeOnNFLRoster &&
        !["ACTIVE", "QUESTIONABLE", "DOUBTFUL"].includes(
          player.nflStatus.toUpperCase(),
        ) &&
        player.nflStatus.toUpperCase() !== "ACTIVE"
      ) {
        const blocked = ["SUSPENDED", "IR", "PUP", "NFI", "FA", "RETIRED"];
        if (blocked.some((status) => player.nflStatus.toUpperCase().includes(status))) {
          // expected — only flag ambiguous statuses
        } else if (!entry || !entry.excluded) {
          exceptions.push({
            kind: "unknown_eligibility",
            position: contest.position,
            rankableEntryId: player.rankableEntryId,
            name: player.displayName,
            team: player.team,
            reason: `Unreviewed NFL status: ${player.nflStatus}`,
            href: `/admin/players`,
          });
        }
      }
    }
  }

  const benchmarkCoverage = await getBenchmarkCoverage(weekId);
  for (const source of benchmarkCoverage.sourcesMissingPositions) {
    for (const position of source.positions) {
      const contest = week.contests.find((row) => row.position === position);
      exceptions.push({
        kind: "expert_import_failure",
        position,
        name: source.displayName,
        reason: "Expert ranking not imported for this week/position",
        href: contest
          ? `/admin/benchmarks?weekId=${weekId}`
          : `/admin/benchmarks`,
      });
    }
  }

  const normalEligibleCount = week.contests.reduce(
    (sum, contest) =>
      sum + contest.entries.filter((entry) => !entry.excluded).length,
    0,
  );

  return {
    week,
    exceptions,
    summary: {
      positions: CONTEST_POSITIONS.length,
      normalEligibleEntries: normalEligibleCount,
      exceptionCount: exceptions.length,
      excluded: exceptions.filter((row) => row.kind === "excluded_player").length,
      expertIssues: exceptions.filter((row) => row.kind === "expert_import_failure")
        .length,
      missingEntries: exceptions.filter((row) => row.kind === "missing_pool_entry")
        .length,
    },
  };
}
