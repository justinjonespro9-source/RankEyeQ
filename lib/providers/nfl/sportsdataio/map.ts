import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  formatOpponentLabel,
  isThursdayThroughMonday,
  shortPlayerName,
} from "@/lib/providers/nfl/eligibility";
import type {
  ProviderDefense,
  ProviderGame,
  ProviderPlayer,
  ProviderTeam,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";

/** Loose SportsDataIO shapes — only fields we map are typed. */
export type SportsDataTeam = {
  TeamID?: number;
  Key?: string;
  FullName?: string;
  City?: string;
  Name?: string;
};

export type SportsDataPlayer = {
  PlayerID?: number;
  Name?: string;
  FirstName?: string;
  LastName?: string;
  Team?: string | null;
  FantasyPosition?: string | null;
  Position?: string | null;
  PhotoUrl?: string | null;
  Active?: boolean | null;
  Status?: string | null;
};

export type SportsDataScore = {
  GameKey?: string | null;
  ScoreID?: number | null;
  Season?: number;
  Week?: number;
  HomeTeam?: string;
  AwayTeam?: string;
  DateTime?: string | null;
  Date?: string | null;
  Status?: string | null;
};

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export function mapSportsDataGameStatus(
  status: string | null | undefined,
): ProviderGame["status"] {
  const value = (status ?? "").toLowerCase();
  if (!value || value === "scheduled") return "SCHEDULED";
  if (value === "inprogress" || value === "in progress") return "IN_PROGRESS";
  if (value === "final" || value === "f/ot") return "FINAL";
  if (value === "postponed") return "POSTPONED";
  if (value === "canceled" || value === "cancelled") return "CANCELED";
  return "OTHER";
}

export function mapSportsDataTeams(rows: SportsDataTeam[]): ProviderTeam[] {
  return rows
    .filter((row) => row.Key)
    .map((row) => ({
      externalId: String(row.TeamID ?? row.Key),
      abbreviation: String(row.Key),
      name: row.FullName || `${row.City ?? ""} ${row.Name ?? ""}`.trim(),
      city: row.City,
    }));
}

export function mapSportsDataPlayers(rows: SportsDataPlayer[]): ProviderPlayer[] {
  const players: ProviderPlayer[] = [];
  for (const row of rows) {
    if (row.PlayerID == null) continue;
    const fantasy = (row.FantasyPosition || row.Position || "").toUpperCase();
    if (!FANTASY_POSITIONS.has(fantasy)) continue;
    if (!row.Team) continue;
    const name =
      row.Name ||
      [row.FirstName, row.LastName].filter(Boolean).join(" ").trim();
    if (!name) continue;

    const inactiveStatuses = new Set([
      "inactive",
      "injured reserve",
      "physically unable to perform",
      "non-football injury",
      "suspended",
      "practice squad",
    ]);
    const status = (row.Status ?? "").toLowerCase();
    const active =
      row.Active !== false && !inactiveStatuses.has(status);

    players.push({
      externalId: String(row.PlayerID),
      name,
      shortName: shortPlayerName(name),
      team: row.Team,
      position: fantasy as ContestPosition,
      headshotUrl: row.PhotoUrl ?? null,
      active,
      status: row.Status,
    });
  }
  return players;
}

export function mapSportsDataGames(
  rows: SportsDataScore[],
  seasonYear: number,
  weekNumber: number,
): ProviderGame[] {
  const games: ProviderGame[] = [];
  for (const row of rows) {
    const externalId = row.GameKey || (row.ScoreID != null ? String(row.ScoreID) : null);
    if (!externalId || !row.HomeTeam || !row.AwayTeam) continue;
    const startsRaw = row.DateTime || row.Date;
    if (!startsRaw) continue;
    const startsAt = new Date(startsRaw);
    if (Number.isNaN(startsAt.getTime())) continue;
    games.push({
      externalId,
      seasonYear: row.Season ?? seasonYear,
      weekNumber: row.Week ?? weekNumber,
      homeTeam: row.HomeTeam,
      awayTeam: row.AwayTeam,
      startsAt,
      status: mapSportsDataGameStatus(row.Status),
    });
  }
  return games;
}

export function mapSportsDataDefenses(teams: ProviderTeam[]): ProviderDefense[] {
  return teams.map((team) => ({
    externalId: `def-${team.abbreviation}`,
    team: team.abbreviation,
    name: `${team.name} D/ST`,
    shortName: `${team.abbreviation} DEF`,
    headshotUrl: null,
    active: true,
  }));
}

export function buildWeeklyEligibleBundle(input: {
  seasonYear: number;
  weekNumber: number;
  games: ProviderGame[];
  players: ProviderPlayer[];
  defenses: ProviderDefense[];
}): WeeklyEligibleBundle {
  const byTeam = new Map<string, ProviderGame>();
  for (const game of input.games) {
    byTeam.set(game.homeTeam, game);
    byTeam.set(game.awayTeam, game);
  }

  const invalid: WeeklyEligibleBundle["invalid"] = [];
  const players = [];
  for (const player of input.players) {
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
  for (const defense of input.defenses) {
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

  return {
    seasonYear: input.seasonYear,
    weekNumber: input.weekNumber,
    games: input.games,
    players,
    defenses,
    invalid,
  };
}
