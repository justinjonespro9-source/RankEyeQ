export type ExistingPickLock = {
  rankableEntryId: string;
  predictedRank: number;
  slotLocked: boolean;
  lockedRank: number | null;
};

export function kickoffHasPassed(
  kickoffAt: Date | null | undefined,
  now: Date,
) {
  if (!kickoffAt) return false;
  return now >= kickoffAt;
}

export function isPickSlotLocked(input: {
  slotLocked: boolean;
  kickoffAt?: Date | null;
  now: Date;
  fullLockAt?: Date | null;
}) {
  if (input.fullLockAt && input.now >= input.fullLockAt) return true;
  if (input.slotLocked) return true;
  return kickoffHasPassed(input.kickoffAt, input.now);
}

/**
 * Reorder only unlocked slots; locked indices stay fixed.
 */
export function reorderAroundLockedSlots<T>(
  items: T[],
  fromIndex: number,
  toIndex: number,
  lockedIndexes: Set<number>,
): T[] {
  if (
    fromIndex === toIndex ||
    lockedIndexes.has(fromIndex) ||
    lockedIndexes.has(toIndex)
  ) {
    return items;
  }

  const unlocked = items.map((_, index) => index).filter((i) => !lockedIndexes.has(i));
  const fromPos = unlocked.indexOf(fromIndex);
  const toPos = unlocked.indexOf(toIndex);
  if (fromPos < 0 || toPos < 0) return items;

  const values = unlocked.map((index) => items[index]);
  const [moved] = values.splice(fromPos, 1);
  values.splice(toPos, 0, moved);

  const next = [...items];
  unlocked.forEach((index, order) => {
    next[index] = values[order];
  });
  return next;
}

export type PartialLockValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Enforce per-player kickoff locks while unlocked slots remain editable.
 */
export function validatePartialLockEdit(input: {
  previous: ExistingPickLock[];
  nextRankedIds: (string | null)[];
  kickoffByEntryId: Map<string, Date | null>;
  now: Date;
  fullLockAt?: Date | null;
  rankingsOpenAt?: Date | null;
}): PartialLockValidation {
  if (input.rankingsOpenAt && input.now < input.rankingsOpenAt) {
    return { ok: false, error: "Weekly contests are not open yet" };
  }
  if (input.fullLockAt && input.now >= input.fullLockAt) {
    return { ok: false, error: "Rankings are locked for this week" };
  }

  const previousById = new Map(
    input.previous.map((pick) => [pick.rankableEntryId, pick]),
  );

  const lockedRankToEntry = new Map<number, string>();
  for (const pick of input.previous) {
    const kickoff = input.kickoffByEntryId.get(pick.rankableEntryId) ?? null;
    const locked = isPickSlotLocked({
      slotLocked: pick.slotLocked,
      kickoffAt: kickoff,
      now: input.now,
    });
    if (!locked) continue;
    const rank = pick.lockedRank ?? pick.predictedRank;
    lockedRankToEntry.set(rank, pick.rankableEntryId);
  }

  for (const [rank, entryId] of lockedRankToEntry) {
    const nextId = input.nextRankedIds[rank - 1] ?? null;
    if (nextId !== entryId) {
      return {
        ok: false,
        error: "Cannot remove or move a player after their game has started",
      };
    }
  }

  for (let index = 0; index < input.nextRankedIds.length; index += 1) {
    const id = input.nextRankedIds[index];
    if (!id) continue;
    const rank = index + 1;
    const kickoff = input.kickoffByEntryId.get(id) ?? null;
    const started = kickoffHasPassed(kickoff, input.now);
    const wasOnBoard = previousById.has(id);
    const lockedHere = lockedRankToEntry.get(rank);

    if (lockedHere && lockedHere !== id) {
      return { ok: false, error: "Cannot change a locked ranking slot" };
    }

    if (started && !wasOnBoard) {
      return {
        ok: false,
        error: "Cannot add a player after their game has started",
      };
    }

    const lockedRankForPlayer = [...lockedRankToEntry.entries()].find(
      ([, entryId]) => entryId === id,
    )?.[0];
    if (lockedRankForPlayer != null && lockedRankForPlayer !== rank) {
      return {
        ok: false,
        error: "Cannot move a locked player to another ranking position",
      };
    }
  }

  return { ok: true };
}
