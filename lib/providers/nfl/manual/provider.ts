import { prisma } from "@/lib/db";
import { formatOpponentLabel } from "@/lib/providers/nfl/eligibility";
import type {
  NflDataProvider,
  NflProviderName,
  ProviderDefense,
  ProviderGame,
  ProviderPlayer,
  ProviderSeason,
  ProviderTeam,
  ProviderWeekResults,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";

/**
 * Manual NFL provider — reads operator-entered schedule/pools/stats from the DB.
 * Does not call any external sports-data API.
 */
export class ManualNflProvider implements NflDataProvider {
  readonly name: NflProviderName = "manual";

  async getSeason(): Promise<ProviderSeason> {
    const season = await prisma.season.findFirst({
      where: { active: true, sport: "NFL" },
      orderBy: { year: "desc" },
    });
    if (!season) {
      return { year: new Date().getUTCFullYear(), label: "Manual NFL" };
    }
    return { year: season.year, label: `${season.year} NFL` };
  }

  async getTeams(): Promise<ProviderTeam[]> {
    const rows = await prisma.rankableEntry.findMany({
      where: { provider: this.name, active: true },
      distinct: ["team"],
      select: { team: true },
      orderBy: { team: "asc" },
    });
    return rows
      .filter((row) => row.team && row.team !== "FA" && row.team !== "NONE")
      .map((row) => ({
        externalId: row.team,
        abbreviation: row.team,
        name: row.team,
      }));
  }

  async getPlayers(): Promise<ProviderPlayer[]> {
    const rows = await prisma.rankableEntry.findMany({
      where: { provider: this.name, type: "PLAYER" },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
      externalId: row.externalId,
      name: row.name,
      shortName: row.shortName,
      team: row.team,
      position: row.position,
      headshotUrl: row.headshotUrl,
      active: row.active,
    }));
  }

  async getWeekSchedule(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderGame[]> {
    const games = await prisma.nflGame.findMany({
      where: {
        provider: this.name,
        seasonYear,
        weekNumber,
      },
      orderBy: { startsAt: "asc" },
    });
    return games.map((game) => ({
      externalId: game.externalId,
      seasonYear: game.seasonYear,
      weekNumber: game.weekNumber,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      startsAt: game.startsAt,
      status: game.status,
    }));
  }

  async getWeeklyEligiblePlayers(
    seasonYear: number,
    weekNumber: number,
  ): Promise<WeeklyEligibleBundle> {
    const games = await this.getWeekSchedule(seasonYear, weekNumber);
    const gameByTeam = new Map<string, ProviderGame>();
    for (const game of games) {
      gameByTeam.set(game.homeTeam, game);
      gameByTeam.set(game.awayTeam, game);
    }

    const playersDb = await prisma.rankableEntry.findMany({
      where: {
        provider: this.name,
        type: "PLAYER",
        active: true,
        team: { in: [...gameByTeam.keys()] },
      },
    });
    const defensesDb = await prisma.rankableEntry.findMany({
      where: {
        provider: this.name,
        type: "DEFENSE",
        active: true,
        team: { in: [...gameByTeam.keys()] },
      },
    });

    const invalid: WeeklyEligibleBundle["invalid"] = [];
    const players: WeeklyEligibleBundle["players"] = [];
    for (const row of playersDb) {
      const game = gameByTeam.get(row.team);
      if (!game) {
        invalid.push({
          reason: "no_weekly_game",
          externalId: row.externalId,
          detail: row.name,
        });
        continue;
      }
      players.push({
        externalId: row.externalId,
        name: row.name,
        shortName: row.shortName,
        team: row.team,
        position: row.position,
        headshotUrl: row.headshotUrl,
        active: row.active,
        gameExternalId: game.externalId,
        opponent: formatOpponentLabel(row.team, game.homeTeam, game.awayTeam),
        gameStartsAt: game.startsAt,
      });
    }

    const defenses: WeeklyEligibleBundle["defenses"] = [];
    for (const row of defensesDb) {
      const game = gameByTeam.get(row.team);
      if (!game) {
        invalid.push({
          reason: "no_weekly_game",
          externalId: row.externalId,
          detail: row.name,
        });
        continue;
      }
      defenses.push({
        externalId: row.externalId,
        team: row.team,
        name: row.name,
        shortName: row.shortName,
        headshotUrl: row.headshotUrl,
        active: row.active,
        gameExternalId: game.externalId,
        opponent: formatOpponentLabel(row.team, game.homeTeam, game.awayTeam),
        gameStartsAt: game.startsAt,
      });
    }

    return {
      seasonYear,
      weekNumber,
      games,
      players,
      defenses,
      invalid,
    };
  }

  async getWeekResults(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderWeekResults> {
    const week = await prisma.week.findFirst({
      where: {
        weekNumber,
        season: { year: seasonYear, sport: "NFL" },
      },
      include: {
        playerWeekStats: true,
        defenseWeekStats: true,
        games: { where: { provider: this.name } },
      },
    });

    if (!week) {
      return {
        seasonYear,
        weekNumber,
        games: [],
        playerStats: [],
        defenseStats: [],
        unmatched: [],
      };
    }

    const games = week.games.map((game) => ({
      externalId: game.externalId,
      seasonYear: game.seasonYear,
      weekNumber: game.weekNumber,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      startsAt: game.startsAt,
      status: game.status,
    }));

    // Manual mode stores fantasy points on ContestEntry / week stats directly.
    // getWeekResults returns stored rows for audit; finalize skips provider refresh.
    return {
      seasonYear,
      weekNumber,
      games,
      playerStats: week.playerWeekStats.map((row) => ({
        externalPlayerId: row.externalPlayerId,
        gameExternalId: null,
        team: null,
        isGameFinal: !row.isProvisional,
        passingYards: row.passingYards,
        passingTds: row.passingTds,
        interceptions: row.interceptions,
        rushingYards: row.rushingYards,
        rushingTds: row.rushingTds,
        receptions: row.receptions,
        receivingYards: row.receivingYards,
        receivingTds: row.receivingTds,
        twoPointConversions: row.twoPointConversions,
        fumblesLost: row.fumblesLost,
        returnTds: row.returnTds,
      })),
      defenseStats: week.defenseWeekStats.map((row) => ({
        externalId: row.externalId,
        team: row.team,
        gameExternalId: null,
        isGameFinal: !row.isProvisional,
        sacks: row.sacks,
        interceptions: row.interceptions,
        fumbleRecoveries: row.fumbleRecoveries,
        defensiveTds: row.defensiveTds,
        specialTeamsTds: row.specialTeamsTds,
        safeties: row.safeties,
        blockedKicks: row.blockedKicks,
        pointsAllowed: row.pointsAllowed,
      })),
      unmatched: [],
    };
  }
}

/** Unused but keeps the interface shape for defenses listing if needed later. */
export type { ProviderDefense };
