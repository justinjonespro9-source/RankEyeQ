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
