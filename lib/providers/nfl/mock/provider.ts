import {
  formatOpponentLabel,
  isThursdayThroughMonday,
} from "@/lib/providers/nfl/eligibility";
import {
  mockDefenses,
  mockGames,
  mockPlayers,
  mockTeams,
} from "@/lib/providers/nfl/mock/fixtures";
import { buildMockWeekResults } from "@/lib/providers/nfl/mock/results";
import type {
  NflDataProvider,
  ProviderSeason,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";

function defaultWeekStart(seasonYear: number, weekNumber: number) {
  // Approximate Week 1 kickoff Thursday early September.
  const date = new Date(Date.UTC(seasonYear, 8, 3 + (weekNumber - 1) * 7));
  return date;
}

export class MockNflProvider implements NflDataProvider {
  readonly name: string;

  constructor(name = "mock") {
    this.name = name;
  }

  async getSeason(): Promise<ProviderSeason> {
    return { year: 2026, label: "2026 NFL" };
  }

  async getTeams() {
    return mockTeams();
  }

  async getPlayers() {
    return mockPlayers();
  }

  async getWeekSchedule(seasonYear: number, weekNumber: number) {
    return mockGames(
      seasonYear,
      weekNumber,
      defaultWeekStart(seasonYear, weekNumber),
    );
  }

  async getWeeklyEligiblePlayers(
    seasonYear: number,
    weekNumber: number,
  ): Promise<WeeklyEligibleBundle> {
    const games = await this.getWeekSchedule(seasonYear, weekNumber);
    const byTeam = new Map<string, (typeof games)[number]>();
    for (const game of games) {
      byTeam.set(game.homeTeam, game);
      byTeam.set(game.awayTeam, game);
    }

    const invalid: WeeklyEligibleBundle["invalid"] = [];
    const players = [];
    for (const player of mockPlayers()) {
      if (!player.active) {
        invalid.push({
          reason: "inactive",
          externalId: player.externalId,
          detail: player.status ?? undefined,
        });
        continue;
      }
      const game = byTeam.get(player.team);
      if (!game) {
        invalid.push({
          reason: "bye_or_missing_game",
          externalId: player.externalId,
          detail: player.team,
        });
        continue;
      }
      if (!isThursdayThroughMonday(game.startsAt)) {
        invalid.push({
          reason: "outside_thu_mon_window",
          externalId: player.externalId,
        });
        continue;
      }
      players.push({
        ...player,
        gameExternalId: game.externalId,
        opponent: formatOpponentLabel(player.team, game.homeTeam, game.awayTeam),
        gameStartsAt: game.startsAt,
      });
    }

    const defenses = [];
    for (const defense of mockDefenses()) {
      const game = byTeam.get(defense.team);
      if (!game) {
        invalid.push({
          reason: "bye_or_missing_game",
          externalId: defense.externalId,
          detail: defense.team,
        });
        continue;
      }
      if (!isThursdayThroughMonday(game.startsAt)) {
        invalid.push({
          reason: "outside_thu_mon_window",
          externalId: defense.externalId,
        });
        continue;
      }
      defenses.push({
        ...defense,
        gameExternalId: game.externalId,
        opponent: formatOpponentLabel(
          defense.team,
          game.homeTeam,
          game.awayTeam,
        ),
        gameStartsAt: game.startsAt,
      });
    }

    return { seasonYear, weekNumber, games, players, defenses, invalid };
  }

  async getGameResults(seasonYear: number, weekNumber: number) {
    return (await this.getWeekResults(seasonYear, weekNumber)).games;
  }

  async getWeekPlayerStats(seasonYear: number, weekNumber: number) {
    return (await this.getWeekResults(seasonYear, weekNumber)).playerStats;
  }

  async getWeekDefenseStats(seasonYear: number, weekNumber: number) {
    return (await this.getWeekResults(seasonYear, weekNumber)).defenseStats;
  }

  async getWeekResults(seasonYear: number, weekNumber: number) {
    return buildMockWeekResults(seasonYear, weekNumber);
  }
}
