import { findGameForTeam, formatOpponentLabel } from "@/lib/providers/nfl/eligibility";

export type WeekScopedGame = {
  id: string;
  weekId: string | null;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
};

/**
 * Kickoff for locking / merge / eligibility must come from this week's ContestEntry.game
 * (or an explicit lookup in this week's NflGame list). Never fall back to RankableEntry
 * denormalized fields — those can still hold the prior week's slate.
 */
export function resolveWeekScopedKickoff(input: {
  weekId: string;
  contestGame?: WeekScopedGame | null;
  team?: string | null;
  weekGames?: WeekScopedGame[];
}): Date | null {
  if (input.contestGame && input.contestGame.weekId === input.weekId) {
    return input.contestGame.startsAt;
  }
  if (input.team && input.weekGames?.length) {
    const game = findGameForTeam(input.weekGames, input.team);
    if (game && game.weekId === input.weekId) return game.startsAt;
  }
  return null;
}

export function resolveWeekScopedGame(input: {
  weekId: string;
  contestGame?: WeekScopedGame | null;
  team?: string | null;
  weekGames?: WeekScopedGame[];
}): WeekScopedGame | null {
  if (input.contestGame && input.contestGame.weekId === input.weekId) {
    return input.contestGame;
  }
  if (input.team && input.weekGames?.length) {
    const game = findGameForTeam(input.weekGames, input.team);
    if (game && game.weekId === input.weekId) return game;
  }
  return null;
}

export function opponentLabelForWeekGame(
  team: string,
  game: Pick<WeekScopedGame, "homeTeam" | "awayTeam"> | null,
): string {
  if (!game) return "TBD";
  return formatOpponentLabel(team, game.homeTeam, game.awayTeam);
}

export function matchupNotStampedMessage(weekNumber: number): string {
  return `Week ${weekNumber} matchup data has not been stamped. Import the Week ${weekNumber} schedule before opening rankings.`;
}
