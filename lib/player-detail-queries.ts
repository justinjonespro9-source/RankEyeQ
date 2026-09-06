import { prisma } from "@/lib/db";
import {
  canonicalDefenseExternalId,
  defenseFranchiseKey,
} from "@/lib/nfl/defense-identity";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  aggregatePlayerPerformance,
  mapContestEntriesToPerformanceSource,
} from "@/lib/player-performance";
import {
  buildPlayerRecentForm,
  opponentFromGame,
  type PlayerMarketSegmentRanks,
  type PlayerMarketSegmentRates,
  type PlayerSeasonSummary,
  type PlayerWeeklyProfileRow,
} from "@/lib/player-profile";
import { canViewCurrentWeekConsensus } from "@/lib/timing/board-access";

/**
 * Resolve public player profile by RankableEntry cuid or nflcom externalId slug
 * (e.g. justin-jefferson, def-MIN).
 */
export async function resolveRankableEntryForProfile(playerIdOrSlug: string) {
  const raw = playerIdOrSlug.trim();
  if (!raw) return null;

  const byId = await prisma.rankableEntry.findUnique({
    where: { id: raw },
  });
  if (byId) return byId;

  const slug = raw.toLowerCase();
  const defenseKey = defenseFranchiseKey(
    slug.startsWith("def-") ? slug.slice(4) : slug,
  );
  const defenseExternal = defenseKey
    ? canonicalDefenseExternalId(defenseKey)
    : null;

  const candidates = await prisma.rankableEntry.findMany({
    where: {
      OR: [
        { provider: NFL_COM_BOOTSTRAP_PROVIDER, externalId: raw },
        { provider: NFL_COM_BOOTSTRAP_PROVIDER, externalId: slug },
        ...(defenseExternal
          ? [
              {
                provider: NFL_COM_BOOTSTRAP_PROVIDER,
                externalId: defenseExternal,
              },
              {
                provider: NFL_COM_BOOTSTRAP_PROVIDER,
                externalId: defenseExternal.toLowerCase(),
              },
            ]
          : []),
      ],
    },
    take: 5,
  });

  if (candidates.length === 0) return null;
  // Prefer canonical bootstrap rows; DEFENSE over stray PLAYER dupes for def-*.
  return (
    candidates.find((row) => row.type === "DEFENSE") ??
    candidates.find((row) => row.provider === NFL_COM_BOOTSTRAP_PROVIDER) ??
    candidates[0]
  );
}

export async function getPlayerDetailById(
  playerIdOrSlug: string,
  seasonId?: string,
  options?: { now?: Date },
) {
  const now = options?.now ?? new Date();
  const resolved = await resolveRankableEntryForProfile(playerIdOrSlug);
  if (!resolved) return null;

  // Offense + DEFENSE both supported on player performance profiles.
  if (resolved.type !== "PLAYER" && resolved.type !== "DEFENSE") {
    return null;
  }

  const entry = await prisma.rankableEntry.findUnique({
    where: { id: resolved.id },
    include: {
      seasonPlayers: {
        where: seasonId ? { seasonId } : undefined,
        include: { season: true },
        orderBy: { season: { year: "desc" } },
        take: 3,
      },
    },
  });
  if (!entry) return null;

  const season =
    (seasonId
      ? await prisma.season.findUnique({ where: { id: seasonId } })
      : null) ??
    (await prisma.season.findFirst({
      where: { active: true, sport: "NFL" },
      orderBy: { year: "desc" },
    }));

  if (!season) {
    return {
      entry,
      seasonPlayer: entry.seasonPlayers[0] ?? null,
      season: null,
      summary: null as PlayerSeasonSummary | null,
      recentForm: null,
      weeklyHistory: [] as PlayerWeeklyProfileRow[],
      profilePathId: publicPlayerPathId(entry),
    };
  }

  const [contestEntries, snapshotRows] = await Promise.all([
    prisma.contestEntry.findMany({
      where: {
        rankableEntryId: entry.id,
        contest: {
          seasonId: season.id,
          week: { isTest: false },
        },
      },
      include: {
        contest: { include: { week: true } },
        game: true,
      },
      orderBy: [{ contest: { week: { weekNumber: "asc" } } }],
    }),
    prisma.contestPregameSnapshotEntry.findMany({
      where: {
        rankableEntryId: entry.id,
        snapshot: {
          contest: {
            seasonId: season.id,
            week: { isTest: false },
          },
        },
      },
      include: {
        snapshot: {
          include: {
            contest: { include: { week: true } },
          },
        },
      },
    }),
  ]);

  const snapshotByContestId = new Map(
    snapshotRows.map((row) => [row.snapshot.contestId, row]),
  );

  const source = mapContestEntriesToPerformanceSource(
    contestEntries.map((row) => {
      const snap = snapshotByContestId.get(row.contestId);
      return {
        rankableEntryId: row.rankableEntryId,
        name: entry.name,
        team: entry.team,
        position: row.contest.position,
        weekId: row.contest.weekId,
        weekLabel: row.contest.week.label,
        weekNumber: row.contest.week.weekNumber,
        contestId: row.contestId,
        weekTeam: row.weekTeam,
        actualRank: row.actualRank,
        fantasyPoints: row.fantasyPoints,
        excluded: row.excluded,
        contestStatus: row.contest.status,
        consensusRank: snap?.consensusRankAll ?? null,
      };
    }),
  );

  const [aggregated] = aggregatePlayerPerformance(source, {
    position: entry.position,
    qualification: "ALL",
  });

  const gradedPoints = source
    .filter((row) => row.wasActive && row.actualRank != null)
    .map((row) => row.fantasyPoints)
    .filter((value): value is number => value != null);

  const summary: PlayerSeasonSummary | null = aggregated
    ? {
        weeksRecorded: aggregated.weeksRecorded,
        weeksEligible: aggregated.weeksEligible,
        fantasyPpg:
          gradedPoints.length === 0
            ? null
            : gradedPoints.reduce((sum, value) => sum + value, 0) /
              gradedPoints.length,
        averageFinish: aggregated.averageFinish,
        medianFinish: aggregated.medianFinish,
        bestFinish: aggregated.bestFinish,
        worstFinish: aggregated.worstFinish,
        numberOneFinishes: aggregated.numberOneFinishes,
        top3Finishes: aggregated.top3Finishes,
        top5Finishes: aggregated.top5Finishes,
        top10Finishes: aggregated.top10Finishes,
      }
    : null;

  const weeklyHistory: PlayerWeeklyProfileRow[] = contestEntries
    .filter((row) => !row.excluded)
    .map((row) => {
      const week = row.contest.week;
      const marketVisible = canViewCurrentWeekConsensus({ week, now });
      const snap = snapshotByContestId.get(row.contestId);
      const graded = row.actualRank != null && row.actualRank > 0;

      let market: PlayerWeeklyProfileRow["market"] = null;
      let marketPrivate = false;

      if (!marketVisible) {
        marketPrivate = Boolean(snap);
      } else if (snap) {
        market = {
          lockedAt: snap.snapshot.lockedAt,
          selectionRates: ratesFromSnapshot(snap),
          averageSelectedRanks: avgRanksFromSnapshot(snap),
          consensusRanks: consensusRanksFromSnapshot(snap),
        };
      }

      return {
        weekId: week.id,
        weekLabel: week.label,
        weekNumber: week.weekNumber,
        contestId: row.contestId,
        position: row.contest.position,
        team: row.weekTeam ?? entry.team,
        opponent: opponentFromGame({
          weekTeam: row.weekTeam,
          team: entry.team,
          game: row.game,
          fallbackOpponent: entry.opponent,
        }),
        fantasyPoints: row.fantasyPoints,
        actualRank: row.actualRank,
        graded,
        market,
        marketPrivate,
      };
    })
    .sort((a, b) => b.weekNumber - a.weekNumber);

  const recentForm = buildPlayerRecentForm(weeklyHistory, 4);

  const seasonPlayer =
    entry.seasonPlayers.find((row) => row.seasonId === season.id) ??
    entry.seasonPlayers[0] ??
    null;

  return {
    entry,
    seasonPlayer,
    season,
    summary,
    recentForm,
    weeklyHistory,
    profilePathId: publicPlayerPathId(entry),
  };
}

export function publicPlayerPathId(entry: {
  id: string;
  provider: string;
  externalId: string;
}) {
  if (
    entry.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
    entry.externalId.trim()
  ) {
    return entry.externalId;
  }
  return entry.id;
}

function ratesFromSnapshot(snap: {
  selectionRateAll: number;
  selectionRateHuman: number;
  selectionRateExpert: number;
  selectionRateAi: number;
}): PlayerMarketSegmentRates {
  return {
    all: snap.selectionRateAll,
    human: snap.selectionRateHuman,
    expert: snap.selectionRateExpert,
    // Creator not stored on immutable snapshot yet.
    creator: null,
    ai: snap.selectionRateAi,
  };
}

function avgRanksFromSnapshot(snap: {
  averageSelectedRankAll: number | null;
  averageSelectedRankHuman: number | null;
  averageSelectedRankExpert: number | null;
  averageSelectedRankAi: number | null;
}): PlayerMarketSegmentRanks {
  return {
    all: snap.averageSelectedRankAll,
    human: snap.averageSelectedRankHuman,
    expert: snap.averageSelectedRankExpert,
    creator: null,
    ai: snap.averageSelectedRankAi,
  };
}

function consensusRanksFromSnapshot(snap: {
  consensusRankAll: number | null;
  consensusRankHuman: number | null;
  consensusRankExpert: number | null;
  consensusRankAi: number | null;
}): PlayerMarketSegmentRanks {
  return {
    all: snap.consensusRankAll,
    human: snap.consensusRankHuman,
    expert: snap.consensusRankExpert,
    creator: null,
    ai: snap.consensusRankAi,
  };
}
