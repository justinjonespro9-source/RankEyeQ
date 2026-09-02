import { prisma } from "@/lib/db";
import { evaluateWeeklyEligibility } from "@/lib/nfl/manual/eligibility";
import { isMissingTeam } from "@/lib/nfl/manual/parse-common";
import { normalizePlayerName } from "@/lib/admin/ai-parser";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type PoolAudit = {
  position: ContestPosition;
  contestId: string | null;
  eligibleCount: number;
  withTeam: number;
  withOpponent: number;
  withKickoff: number;
  freeAgents: number;
  missingGames: number;
  duplicateNames: number;
  manuallyExcluded: number;
  blockers: string[];
  ready: boolean;
};

export async function auditContestPool(
  weekId: string,
  position: ContestPosition,
): Promise<PoolAudit> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position } },
    include: {
      entries: {
        include: {
          rankableEntry: true,
          game: true,
        },
      },
    },
  });

  const weekGames = await prisma.nflGame.findMany({ where: { weekId } });
  const teamsWithGames = new Set<string>();
  for (const game of weekGames) {
    teamsWithGames.add(game.homeTeam);
    teamsWithGames.add(game.awayTeam);
  }

  if (!contest) {
    return {
      position,
      contestId: null,
      eligibleCount: 0,
      withTeam: 0,
      withOpponent: 0,
      withKickoff: 0,
      freeAgents: 0,
      missingGames: 0,
      duplicateNames: 0,
      manuallyExcluded: 0,
      blockers: [`${position} contest has not been created`],
      ready: false,
    };
  }

  const active = contest.entries.filter((entry) => !entry.excluded);
  const excluded = contest.entries.filter((entry) => entry.excluded);
  let withTeam = 0;
  let withOpponent = 0;
  let withKickoff = 0;
  let freeAgents = 0;
  let missingGames = 0;
  const blockers: string[] = [];
  const nameCounts = new Map<string, number>();

  for (const entry of active) {
    const team = entry.rankableEntry.team;
    const hasGame =
      Boolean(entry.gameId) ||
      Boolean(entry.game) ||
      teamsWithGames.has(team);
    const kickoff =
      entry.game?.startsAt ?? entry.rankableEntry.gameStartsAt ?? null;
    const opponent = entry.rankableEntry.opponent;
    const eligibility = evaluateWeeklyEligibility({
      position: entry.rankableEntry.position,
      contestPosition: position,
      team,
      opponent,
      kickoffAt: kickoff,
      active: entry.rankableEntry.active,
      excluded: false,
      hasWeeklyGame: hasGame,
    });

    if (!isMissingTeam(team)) withTeam += 1;
    else freeAgents += 1;
    if (opponent && opponent !== "TBD") withOpponent += 1;
    if (kickoff) withKickoff += 1;
    if (!hasGame) missingGames += 1;

    const key = normalizePlayerName(entry.rankableEntry.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);

    if (!eligibility.eligible) {
      blockers.push(
        `${entry.rankableEntry.name}: ${eligibility.reasons.join(", ")}`,
      );
    }
  }

  const duplicateNames = [...nameCounts.values()].filter((n) => n > 1).length;
  if (duplicateNames > 0) {
    blockers.push(`${duplicateNames} duplicate name group(s) in pool`);
  }
  if (active.length === 0) {
    blockers.push(`${position} pool is empty`);
  }

  return {
    position,
    contestId: contest.id,
    eligibleCount: active.length,
    withTeam,
    withOpponent,
    withKickoff,
    freeAgents,
    missingGames,
    duplicateNames,
    manuallyExcluded: excluded.length,
    blockers,
    ready: blockers.length === 0 && active.length > 0,
  };
}

export async function auditAllPools(weekId: string) {
  const positions: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  const audits: PoolAudit[] = [];
  for (const position of positions) {
    audits.push(await auditContestPool(weekId, position));
  }
  return {
    audits,
    ready: audits.every((audit) => audit.ready),
    blockers: audits.flatMap((audit) =>
      audit.blockers.map((blocker) => `${audit.position}: ${blocker}`),
    ),
  };
}
