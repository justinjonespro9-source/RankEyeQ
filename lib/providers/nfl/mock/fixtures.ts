import { NFL_TEAMS, getTeamMatchup } from "@/lib/nfl-schedule";
import { getSamplePlayers } from "@/lib/mock-players";
import type {
  ProviderDefense,
  ProviderGame,
  ProviderPlayer,
  ProviderTeam,
} from "@/lib/providers/nfl/types";
import { shortPlayerName } from "@/lib/providers/nfl/eligibility";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { Position } from "@/types/contest";

const DAY_TO_OFFSET: Record<string, number> = {
  Thu: 0,
  Fri: 1,
  Sat: 2,
  Sun: 3,
  Mon: 4,
};

function parseKickoff(
  weekStart: Date,
  gameDay: string,
  gameTime: string,
): Date {
  const date = new Date(weekStart);
  date.setUTCDate(date.getUTCDate() + (DAY_TO_OFFSET[gameDay] ?? 3));
  const match = gameTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3].toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    date.setUTCHours(hour + 4, minute, 0, 0);
  }
  return date;
}

export function mockTeams(): ProviderTeam[] {
  return NFL_TEAMS.map((team) => ({
    externalId: team.abbr,
    abbreviation: team.abbr,
    name: team.name,
  }));
}

export function mockGames(
  seasonYear: number,
  weekNumber: number,
  weekStart: Date,
): ProviderGame[] {
  const seen = new Map<string, ProviderGame>();
  for (const team of NFL_TEAMS) {
    const matchup = getTeamMatchup(team.abbr);
    const home = matchup.home;
    // Reconstruct pair from opponent label
    const opp = matchup.opponent.replace(/^(vs|@)\s+/, "");
    const homeTeam = home ? team.abbr : opp;
    const awayTeam = home ? opp : team.abbr;
    const key = `${homeTeam}-${awayTeam}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      externalId: `mock-${seasonYear}-w${weekNumber}-${awayTeam}@${homeTeam}`,
      seasonYear,
      weekNumber,
      homeTeam,
      awayTeam,
      startsAt: parseKickoff(weekStart, matchup.gameDay, matchup.gameTime),
      status: "SCHEDULED",
    });
  }
  return [...seen.values()];
}

const UI_TO_DB: Record<Position, ContestPosition> = {
  qb: "QB",
  rb: "RB",
  wr: "WR",
  te: "TE",
  def: "DEF",
};

export function mockPlayers(): ProviderPlayer[] {
  const positions: Position[] = ["qb", "rb", "wr", "te"];
  const players: ProviderPlayer[] = [];
  for (const position of positions) {
    for (const player of getSamplePlayers(position)) {
      if (position === "def") continue;
      players.push({
        externalId: player.id.startsWith("p-")
          ? player.id
          : `mock-player-${player.id}`,
        name: player.name,
        shortName: shortPlayerName(player.name),
        team: player.team,
        position: UI_TO_DB[position],
        headshotUrl: player.headshotUrl ?? null,
        active: player.availability !== "out",
        status: player.availability,
      });
    }
  }
  return players;
}

export function mockDefenses(): ProviderDefense[] {
  return NFL_TEAMS.map((team) => ({
    externalId: `mock-def-${team.abbr}`,
    team: team.abbr,
    name: `${team.name} D/ST`,
    shortName: `${team.abbr} DEF`,
    headshotUrl: null,
    active: true,
  }));
}
