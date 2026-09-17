/** Entry IDs whose NFL kickoff has already occurred at `now`. */
export function kickoffLockedEntryIdsFromMap(
  kickoffByEntryId: Record<string, string>,
  now: Date,
): string[] {
  const nowMs = now.getTime();
  return Object.entries(kickoffByEntryId)
    .filter(([, iso]) => new Date(iso).getTime() <= nowMs)
    .map(([id]) => id);
}

/**
 * Immutable board slots for the ranking UI.
 * Persisted slotLocked alone is not enough — require the week-scoped kickoff
 * (or full-board lock) to have actually passed so stale W1 lock metadata cannot
 * freeze an upcoming W2 player.
 */
export function immutableLockedEntryIdsFromPicks(input: {
  picks: { rankableEntryId: string; slotLocked: boolean }[];
  kickoffByEntryId: Record<string, string>;
  now: Date;
  fullBoardLocked: boolean;
}): string[] {
  return input.picks
    .filter((pick) => {
      if (!pick.slotLocked) return false;
      const kickoffIso = input.kickoffByEntryId[pick.rankableEntryId];
      if (kickoffIso && new Date(kickoffIso) <= input.now) return true;
      return input.fullBoardLocked;
    })
    .map((pick) => pick.rankableEntryId);
}
