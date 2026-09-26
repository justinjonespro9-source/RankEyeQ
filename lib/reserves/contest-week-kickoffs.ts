/**
 * Contest-week kickoff resolution for effective-board / grading.
 *
 * Invariant: when evaluating Contest X in Week Y, kickoff comes from the
 * Week Y ContestEntry → NflGame relationship whenever available.
 *
 * Never substitute RankableEntry.gameStartsAt / RankableEntry.game — those are
 * mutable denormalized fields that can be restamped to a later week and would
 * silently poison historical grading / reserve promotion.
 *
 * Fallback when ContestEntry.game is missing or belongs to another week:
 *   → null (kickoff unknown).
 * Effective-board then uses the existing null-kickoff path (live availability
 * until a freeze exists). Callers must not invent another week's kickoff.
 */
import {
  resolveWeekScopedKickoff,
  type WeekScopedGame,
} from "@/lib/timing/resolve-contest-kickoff";

export const CONTEST_WEEK_KICKOFF_FALLBACK =
  "null — ContestEntry.game missing or weekId mismatch; never RankableEntry.gameStartsAt";

export type ContestEntryKickoffSource = {
  rankableEntryId: string;
  game?: WeekScopedGame | null;
};

/**
 * Build rankableEntryId → kickoff map for a single contest week.
 * Missing / wrong-week games yield null entries (explicit), not omissions from
 * another week's RankableEntry stamp.
 */
export function buildContestWeekKickoffMap(input: {
  weekId: string;
  entries: ContestEntryKickoffSource[];
}): Map<string, Date | null> {
  const map = new Map<string, Date | null>();
  for (const entry of input.entries) {
    map.set(
      entry.rankableEntryId,
      resolveWeekScopedKickoff({
        weekId: input.weekId,
        contestGame: entry.game ?? null,
      }),
    );
  }
  return map;
}
