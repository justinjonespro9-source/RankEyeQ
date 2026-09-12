import type { EntryAvailability } from "@/lib/generated/prisma/client";

/**
 * Official statuses that auto-promote a reserve into the scoring board
 * when set before that player's kickoff. Q/D do NOT promote.
 */
export const PROMOTION_UNAVAILABLE = new Set<string>([
  "OUT",
  "INACTIVE",
  "IR",
  "PUP",
  "SUSPENDED",
  "FREE_AGENT",
]);

export function isPromotionUnavailable(
  availability: EntryAvailability | string | null | undefined,
): boolean {
  if (!availability) return false;
  return PROMOTION_UNAVAILABLE.has(String(availability).toUpperCase());
}
