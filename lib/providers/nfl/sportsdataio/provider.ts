import {
  buildWeeklyEligibleBundle,
  mapSportsDataDefenses,
  mapSportsDataGames,
  mapSportsDataPlayers,
  mapSportsDataTeams,
  type SportsDataPlayer,
  type SportsDataScore,
  type SportsDataTeam,
} from "@/lib/providers/nfl/sportsdataio/map";
import {
  mapSportsDataDefenseGameStats,
  mapSportsDataPlayerGameStats,
  type SportsDataFantasyDefenseGame,
  type SportsDataPlayerGame,
} from "@/lib/providers/nfl/sportsdataio/results-map";
import type {
  NflDataProvider,
  ProviderSeason,
  ProviderWeekResults,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";

/**
 * SportsDataIO NFL Scores API adapter.
 * Field mapping is based on documented Score / Player / Team tables.
 * Without credentials this provider is never selected by the factory.
 */
export class SportsDataIoProvider implements NflDataProvider {
  readonly name = "sportsdataio" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.sportsdata.io/v3/nfl/scores/json",
  ) {}

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    const response = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": this.apiKey,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `SportsDataIO ${path} failed: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }

  private seasonKey(year: number) {
    return `${year}REG`;
  }

  async getSeason(): Promise<ProviderSeason> {
    try {
      const year = await this.fetchJson<number>("CurrentSeason");
      return { year, label: `${year} NFL` };
    } catch {
      const year = new Date().getFullYear();
      return { year, label: `${year} NFL` };
    }
  }

  async getTeams() {
    const rows = await this.fetchJson<SportsDataTeam[]>("Teams");
    return mapSportsDataTeams(rows);
  }

  async getPlayers() {
    const rows = await this.fetchJson<SportsDataPlayer[]>("Players");
    return mapSportsDataPlayers(rows);
  }

  async getWeekSchedule(seasonYear: number, weekNumber: number) {
    const rows = await this.fetchJson<SportsDataScore[]>(
      `ScoresByWeek/${this.seasonKey(seasonYear)}/${weekNumber}`,
    );
    return mapSportsDataGames(rows, seasonYear, weekNumber);
  }

  async getWeeklyEligiblePlayers(
    seasonYear: number,
    weekNumber: number,
  ): Promise<WeeklyEligibleBundle> {
    const [games, players, teams] = await Promise.all([
      this.getWeekSchedule(seasonYear, weekNumber),
      this.getPlayers(),
      this.getTeams(),
    ]);
    return buildWeeklyEligibleBundle({
      seasonYear,
      weekNumber,
      games,
      players,
      defenses: mapSportsDataDefenses(teams),
    });
  }

  async getGameResults(seasonYear: number, weekNumber: number) {
    return this.getWeekSchedule(seasonYear, weekNumber);
  }

  async getWeekPlayerStats(seasonYear: number, weekNumber: number) {
    // Stats API path (documented PlayerGame feeds).
    const base = this.baseUrl.replace("/scores/json", "/stats/json");
    const url = `${base.replace(/\/$/, "")}/PlayerGameStatsByWeek/${this.seasonKey(seasonYear)}/${weekNumber}`;
    const response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `SportsDataIO PlayerGameStatsByWeek failed: ${response.status}`,
      );
    }
    const rows = (await response.json()) as SportsDataPlayerGame[];
    return mapSportsDataPlayerGameStats(rows);
  }

  async getWeekDefenseStats(seasonYear: number, weekNumber: number) {
    const base = this.baseUrl.replace("/scores/json", "/stats/json");
    const url = `${base.replace(/\/$/, "")}/FantasyDefenseByWeek/${this.seasonKey(seasonYear)}/${weekNumber}`;
    const response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `SportsDataIO FantasyDefenseByWeek failed: ${response.status}`,
      );
    }
    const rows = (await response.json()) as SportsDataFantasyDefenseGame[];
    return mapSportsDataDefenseGameStats(rows);
  }

  async getWeekResults(
    seasonYear: number,
    weekNumber: number,
  ): Promise<ProviderWeekResults> {
    const [games, playerStats, defenseStats] = await Promise.all([
      this.getGameResults(seasonYear, weekNumber),
      this.getWeekPlayerStats(seasonYear, weekNumber),
      this.getWeekDefenseStats(seasonYear, weekNumber),
    ]);
    return {
      seasonYear,
      weekNumber,
      games,
      playerStats,
      defenseStats,
      unmatched: [],
    };
  }
}
