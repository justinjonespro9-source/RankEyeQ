import { validateWaiverBoardShape, type WaiverBoardShapeError } from "@/lib/waivers/board-shape";

/** An ELIGIBLE CANDIDATE row of the contest's pinned snapshot at the contest position. */
export type WaiverPoolEntry = {
  snapshotEntryId: string;
  rankableEntryId: string;
};

export type ValidatedWaiverCall = {
  slot: number;
  snapshotEntryId: string;
  rankableEntryId: string;
};

export type WaiverCallValidationResult =
  | { ok: true; calls: ValidatedWaiverCall[]; availableSlots: number }
  | { ok: false; errors: WaiverBoardShapeError[]; availableSlots: number };

/**
 * Validates a submitted board against the frozen pool only (never live
 * ownership or availability). `playerIds[i]` is the RankableEntry id for slot
 * i + 1; any count from zero through the effective maximum is valid.
 */
export function validateWaiverCalls(input: {
  playerIds: ReadonlyArray<string | null | undefined>;
  pool: ReadonlyArray<WaiverPoolEntry>;
  configuredMaxCalls: number;
}): WaiverCallValidationResult {
  const byPlayer = new Map(input.pool.map((entry) => [entry.rankableEntryId, entry]));
  const shape = validateWaiverBoardShape({
    slots: input.playerIds,
    configuredMaxCalls: input.configuredMaxCalls,
    eligiblePoolSize: byPlayer.size,
    eligiblePlayerIds: new Set(byPlayer.keys()),
  });
  if (!shape.ok) return shape;
  return {
    ok: true,
    availableSlots: shape.availableSlots,
    calls: shape.calls.map((rankableEntryId, index) => ({
      slot: index + 1,
      rankableEntryId,
      snapshotEntryId: byPlayer.get(rankableEntryId)!.snapshotEntryId,
    })),
  };
}

export function describeWaiverBoardErrors(errors: ReadonlyArray<WaiverBoardShapeError>): string {
  const first = errors[0];
  if (!first) return "Invalid Waiver board";
  switch (first.code) {
    case "GAP":
      return `Calls must be filled in order with no gaps (slot ${first.slot} is empty)`;
    case "DUPLICATE_PLAYER":
      return "A player may appear only once on a Waiver board";
    case "EXCEEDS_AVAILABLE_SLOTS":
      return `This Waiver board allows at most ${first.availableSlots} call(s)`;
    case "INELIGIBLE_PLAYER":
      return "Every call must be an eligible player in this week's Official Waiver Snapshot";
  }
}
