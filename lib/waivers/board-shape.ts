/** Effective board depth: configured maximum, capped by how many players are eligible. */
export function effectiveMaxCalls(configuredMaxCalls: number, eligiblePoolSize: number): number {
  if (!Number.isInteger(configuredMaxCalls) || configuredMaxCalls < 0) {
    throw new RangeError(`configuredMaxCalls must be a non-negative integer (got ${configuredMaxCalls})`);
  }
  if (!Number.isInteger(eligiblePoolSize) || eligiblePoolSize < 0) {
    throw new RangeError(`eligiblePoolSize must be a non-negative integer (got ${eligiblePoolSize})`);
  }
  return Math.min(configuredMaxCalls, eligiblePoolSize);
}

export type WaiverBoardShapeError =
  | { code: "GAP"; slot: number }
  | { code: "DUPLICATE_PLAYER"; slot: number; playerId: string }
  | { code: "EXCEEDS_AVAILABLE_SLOTS"; slot: number; availableSlots: number }
  | { code: "INELIGIBLE_PLAYER"; slot: number; playerId: string };

export type WaiverBoardShapeResult =
  | { ok: true; calls: string[]; callsMade: number; availableSlots: number }
  | { ok: false; errors: WaiverBoardShapeError[]; availableSlots: number };

/**
 * Validates a Waiver Podium board. `slots[i]` holds the player for slot i + 1;
 * blank slots are null/undefined/"". Calls must be contiguous from WIN with no
 * gaps, use distinct players, and fit the effective board depth. Trailing
 * blanks are fine; an empty board is a valid zero-call shape.
 */
export function validateWaiverBoardShape(input: {
  slots: ReadonlyArray<string | null | undefined>;
  configuredMaxCalls: number;
  eligiblePoolSize: number;
  eligiblePlayerIds?: ReadonlySet<string>;
}): WaiverBoardShapeResult {
  const availableSlots = effectiveMaxCalls(input.configuredMaxCalls, input.eligiblePoolSize);
  const errors: WaiverBoardShapeError[] = [];
  const normalized = input.slots.map((value) => (value == null || value === "" ? null : value));

  let lastFilled = 0;
  normalized.forEach((value, index) => {
    if (value !== null) lastFilled = index + 1;
  });

  const calls: string[] = [];
  const seen = new Set<string>();
  for (let slot = 1; slot <= lastFilled; slot += 1) {
    const playerId = normalized[slot - 1];
    if (playerId === null) {
      errors.push({ code: "GAP", slot });
      continue;
    }
    if (slot > availableSlots) {
      errors.push({ code: "EXCEEDS_AVAILABLE_SLOTS", slot, availableSlots });
    }
    if (seen.has(playerId)) {
      errors.push({ code: "DUPLICATE_PLAYER", slot, playerId });
    }
    if (input.eligiblePlayerIds && !input.eligiblePlayerIds.has(playerId)) {
      errors.push({ code: "INELIGIBLE_PLAYER", slot, playerId });
    }
    seen.add(playerId);
    calls.push(playerId);
  }

  if (errors.length > 0) return { ok: false, errors, availableSlots };
  return { ok: true, calls, callsMade: calls.length, availableSlots };
}
