import { prisma } from "@/lib/db";
import {
  buildPositionChallenge,
  rankableEntryToRankingPlayer,
} from "@/lib/rankable-mappers";
import { toDbPosition } from "@/lib/contest-defaults";
import {
  getChallenge,
  getWeeklyChallenges,
  NFL_WEEK_KEY,
} from "@/lib/contest";
import { getSamplePlayers } from "@/lib/mock-players";
import { getPlayerResearchMapForContest } from "@/lib/player-research-queries";
import { parsePlayerResearchWindow } from "@/lib/player-research";
import { dedupeRankingPlayersByIdentity } from "@/lib/nfl/pool-canonical-uniqueness";
import type { Position, PositionChallenge, RankingPlayer } from "@/types/contest";
import type { ContestStatus } from "@/lib/generated/prisma/client";

export type PublicContestCard = PositionChallenge & {
  contestId: string | null;
  entryCount: number;
  source: "database" | "mock";
  dbStatus?: ContestStatus;
};

async function getActiveWeek() {
  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
      },
    },
  });

  if (!activeSeason) return null;

  const openWeek =
    activeSeason.weeks.find((week) => week.status === "OPEN") ??
    activeSeason.weeks.find((week) => week.status === "LOCKED") ??
    activeSeason.weeks.find((week) => week.status === "COMPLETE") ??
    activeSeason.weeks[0];

  if (!openWeek) return null;

  return { season: activeSeason, week: openWeek };
}

export async function getPublicWeeklyChallenges(): Promise<PublicContestCard[]> {
  try {
    const context = await getActiveWeek();
    if (!context) {
      return getWeeklyChallenges().map((challenge) => ({
        ...challenge,
        contestId: null,
        entryCount: getSamplePlayers(challenge.position).length,
        source: "mock" as const,
      }));
    }

    const contests = await prisma.rankIQContest.findMany({
      where: { weekId: context.week.id },
      include: {
        _count: { select: { entries: true } },
      },
      orderBy: { position: "asc" },
    });

    if (contests.length === 0) {
      return getWeeklyChallenges().map((challenge) => ({
        ...challenge,
        contestId: null,
        entryCount: getSamplePlayers(challenge.position).length,
        source: "mock" as const,
      }));
    }

    const weekKey = `${context.season.year}-week-${context.week.weekNumber}`;

    return contests.map((contest) => ({
      ...buildPositionChallenge({
        position: contest.position,
        rankingDepth: contest.rankingDepth,
        title: contest.title,
        status: contest.status,
        weekLabel: context.week.label,
        weekKey,
        locksAt: contest.locksAt,
      }),
      contestId: contest.id,
      entryCount: contest._count.entries,
      source: "database" as const,
      dbStatus: contest.status,
    }));
  } catch {
    return getWeeklyChallenges().map((challenge) => ({
      ...challenge,
      contestId: null,
      entryCount: getSamplePlayers(challenge.position).length,
      source: "mock" as const,
    }));
  }
}

export type PublicPositionContest = {
  challenge: PositionChallenge;
  players: RankingPlayer[];
  contestId: string | null;
  contestStatus: ContestStatus;
  source: "database" | "mock";
  actualFinishes: Record<string, number>;
  weekId: string | null;
  weekNumber: number | null;
  seasonYear: number | null;
  weekStatus: string | null;
  rankingsOpenAt: Date | null;
  fullLockAt: Date | null;
  revealStartsAt: Date | null;
  publicReleaseAt: Date | null;
  kickoffByEntryId: Record<string, string>;
};

const emptyTiming = {
  weekId: null as string | null,
  weekNumber: null as number | null,
  seasonYear: null as number | null,
  weekStatus: null as string | null,
  rankingsOpenAt: null as Date | null,
  fullLockAt: null as Date | null,
  revealStartsAt: null as Date | null,
  publicReleaseAt: null as Date | null,
  kickoffByEntryId: {} as Record<string, string>,
};

export async function getPublicPositionContest(
  position: Position,
  options?: { researchWindow?: string },
): Promise<PublicPositionContest> {
  try {
    const context = await getActiveWeek();
    if (!context) {
      const challenge = getChallenge(position);
      return {
        challenge,
        players: getSamplePlayers(position),
        contestId: null,
        contestStatus: "OPEN",
        source: "mock",
        actualFinishes: {},
        ...emptyTiming,
      };
    }

    const contest = await prisma.rankIQContest.findUnique({
      where: {
        weekId_position: {
          weekId: context.week.id,
          position: toDbPosition(position),
        },
      },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true, game: true },
          orderBy: { rankableEntry: { name: "asc" } },
        },
      },
    });

    if (!contest) {
      const challenge = getChallenge(position);
      return {
        challenge,
        players: getSamplePlayers(position),
        contestId: null,
        contestStatus: "OPEN",
        source: "mock",
        actualFinishes: {},
        ...emptyTiming,
      };
    }

    const weekKey = `${context.season.year}-week-${context.week.weekNumber}`;

    const researchWindow = parsePlayerResearchWindow(
      options?.researchWindow,
      context.week.weekNumber,
    );
    const researchByPlayer =
      contest.entries.length > 0
        ? await getPlayerResearchMapForContest({
            seasonId: context.season.id,
            position: contest.position,
            window: researchWindow,
          }).catch(() => new Map())
        : new Map();

    const challenge = buildPositionChallenge({
      position: contest.position,
      rankingDepth: contest.rankingDepth,
      title: contest.title,
      status: contest.status,
      weekLabel: context.week.label,
      weekKey,
      locksAt: contest.locksAt,
    });

    const players = contest.entries.map((entry) => {
      const base = rankableEntryToRankingPlayer(entry.rankableEntry);
      const research = researchByPlayer.get(entry.rankableEntryId);
      const withResearch = research
        ? {
            ...base,
            research: {
              gamesPlayed: research.gamesPlayed,
              weeksInWindow: research.weeksInWindow,
              fantasyPointsPerGame: research.fantasyPointsPerGame,
              fantasyPointsTotal: research.fantasyPointsTotal,
              averageFinish: research.averageFinish,
              top10Finishes: research.top10Finishes,
              top5Finishes: research.top5Finishes,
              numberOneFinishes: research.numberOneFinishes,
              receptions: research.receptions,
              rushingYards: research.rushingYards,
              receivingYards: research.receivingYards,
              totalYards: research.totalYards,
              touchdowns: research.touchdowns,
              passingYards: research.passingYards,
              passingTds: research.passingTds,
              interceptions: research.interceptions,
            },
          }
        : base;
      if (!entry.game) return withResearch;
      const home = entry.game.homeTeam;
      const away = entry.game.awayTeam;
      const team = entry.rankableEntry.team;
      return {
        ...withResearch,
        opponent: team === home ? `vs ${away}` : `@ ${home}`,
        gameDay: new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          timeZone: "America/Chicago",
        }).format(entry.game.startsAt),
        gameTime: new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
          timeZone: "America/Chicago",
        }).format(entry.game.startsAt),
      };
    });

    const metaById = new Map(
      contest.entries.map((entry) => [
        entry.rankableEntryId,
        {
          provider: entry.rankableEntry.provider,
          externalId: entry.rankableEntry.externalId,
          position: entry.rankableEntry.position,
        },
      ]),
    );
    const dedupedPlayers = dedupeRankingPlayersByIdentity(players, metaById);

    // Neutral default ordering — alphabetical by name (no house ranking).
    dedupedPlayers.sort((a, b) => a.name.localeCompare(b.name));

    const actualFinishes: Record<string, number> = {};
    const kickoffByEntryId: Record<string, string> = {};
    for (const entry of contest.entries) {
      if (entry.actualRank != null) {
        actualFinishes[entry.rankableEntryId] = entry.actualRank;
      }
      const kickoff =
        entry.game?.startsAt ??
        entry.rankableEntry.gameStartsAt ??
        null;
      if (kickoff) kickoffByEntryId[entry.rankableEntryId] = kickoff.toISOString();
    }

    return {
      challenge,
      players: dedupedPlayers.length > 0 ? dedupedPlayers : getSamplePlayers(position),
      contestId: contest.id,
      contestStatus: contest.status,
      source: dedupedPlayers.length > 0 ? "database" : "mock",
      actualFinishes,
      weekId: context.week.id,
      weekNumber: context.week.weekNumber,
      seasonYear: context.season.year,
      weekStatus: context.week.status,
      rankingsOpenAt: context.week.rankingsOpenAt,
      fullLockAt: context.week.fullLockAt,
      revealStartsAt: context.week.revealStartsAt,
      publicReleaseAt: context.week.publicReleaseAt,
      kickoffByEntryId,
    };
  } catch {
    const challenge = getChallenge(position);
    return {
      challenge,
      players: getSamplePlayers(position),
      contestId: null,
      contestStatus: "OPEN",
      source: "mock",
      actualFinishes: {},
      ...emptyTiming,
    };
  }
}

export { NFL_WEEK_KEY };
