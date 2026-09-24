import {
  opponentLabelForWeekGame,
  resolveWeekScopedGame,
  type WeekScopedGame,
} from "@/lib/timing/resolve-contest-kickoff";

/**
 * Historical / week-specific matchup presentation.
 * Always derive opponent from ContestEntry.game for the selected week —
 * never RankableEntry.opponent (can be TBD after a later-week pool sync).
 */
export function opponentFromContestEntryGame(input: {
  team: string;
  weekId: string;
  contestGame: WeekScopedGame | null | undefined;
}): string {
  const game = resolveWeekScopedGame({
    weekId: input.weekId,
    contestGame: input.contestGame ?? null,
  });
  return opponentLabelForWeekGame(input.team, game);
}
