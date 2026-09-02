import { chicagoWeekday } from "@/lib/timing/chicago";

export type MergePick = {
  rankableEntryId: string;
  sourceRank: number;
  rankIqRank: number;
  kickoffAt: Date | null;
  rawName?: string;
};

export type MergedSlot = {
  rankIqRank: number;
  rankableEntryId: string;
  sourceRank: number;
  slotLocked: boolean;
  lockedAt: Date | null;
  lockedRank: number | null;
  kickoffAt: Date | null;
};

export function isThursdayKickoff(kickoffAt: Date | null | undefined) {
  if (!kickoffAt) return false;
  return chicagoWeekday(kickoffAt) === "Thu";
}

export function isLateCapture(capturedAt: Date, fullLockAt: Date | null | undefined) {
  if (!fullLockAt) return false;
  return capturedAt.getTime() >= fullLockAt.getTime();
}

/**
 * Thursday snapshot commits Thursday-kickoff players at their RankIQ slot.
 * Sunday snapshot fills remaining unlocked slots in source order.
 * A Thursday player absent from the pre-kickoff snapshot cannot be added after kickoff.
 */
export function mergeSundayWithThursdayLocks(input: {
  rankingDepth: number;
  now: Date;
  thursday: { capturedAt: Date; selected: MergePick[] } | null;
  sunday: { capturedAt: Date; selected: MergePick[] };
}): {
  slots: (MergedSlot | null)[];
  warnings: string[];
  complete: boolean;
} {
  const slots: (MergedSlot | null)[] = Array.from(
    { length: input.rankingDepth },
    () => null,
  );
  const lockedIds = new Set<string>();
  const warnings: string[] = [];

  if (input.thursday) {
    for (const pick of input.thursday.selected) {
      if (!isThursdayKickoff(pick.kickoffAt)) continue;
      const index = pick.rankIqRank - 1;
      if (index < 0 || index >= input.rankingDepth) continue;
      if (slots[index]) {
        warnings.push(
          `Thursday snapshot has two players claiming RankIQ slot ${pick.rankIqRank}`,
        );
        continue;
      }
      slots[index] = {
        rankIqRank: pick.rankIqRank,
        rankableEntryId: pick.rankableEntryId,
        sourceRank: pick.sourceRank,
        slotLocked: true,
        lockedAt: input.thursday.capturedAt,
        lockedRank: pick.rankIqRank,
        kickoffAt: pick.kickoffAt,
      };
      lockedIds.add(pick.rankableEntryId);
    }
  }

  for (const pick of [...input.sunday.selected].sort(
    (a, b) => a.rankIqRank - b.rankIqRank,
  )) {
    if (lockedIds.has(pick.rankableEntryId)) continue;

    const thursdayStarted =
      isThursdayKickoff(pick.kickoffAt) &&
      Boolean(pick.kickoffAt && input.now >= pick.kickoffAt);

    if (thursdayStarted && !lockedIds.has(pick.rankableEntryId)) {
      warnings.push(
        `${pick.rawName ?? pick.rankableEntryId} kicked off Thursday and was absent from the pre-kickoff snapshot — cannot be added.`,
      );
      continue;
    }

    const emptyIndex = slots.findIndex((slot) => slot == null);
    if (emptyIndex < 0) break;

    slots[emptyIndex] = {
      rankIqRank: emptyIndex + 1,
      rankableEntryId: pick.rankableEntryId,
      sourceRank: pick.sourceRank,
      slotLocked: false,
      lockedAt: null,
      lockedRank: null,
      kickoffAt: pick.kickoffAt,
    };
  }

  const complete = slots.every((slot) => slot != null);
  if (!complete) {
    warnings.push(
      `Merged board is incomplete (${slots.filter(Boolean).length}/${input.rankingDepth} slots).`,
    );
  }

  return { slots, warnings, complete };
}
