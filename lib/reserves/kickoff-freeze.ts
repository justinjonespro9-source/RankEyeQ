/**
 * Kickoff freeze authority: week-scoped availability, never mutable
 * RankableEntry.availability alone.
 *
 * At a player's ContestEntry.game kickoff we permanently answer whether the
 * player was promotion-unavailable for THIS week (OUT/INACTIVE weekly status,
 * roster hard-unavailable, respecting Admin override). Practice DNP/Limited
 * and Q/D do not freeze unavailable.
 */
import type { ResolvedPlayerWeekStatus } from "@/lib/eligibility/player-week-availability";
import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";
import type { EntryAvailability } from "@/lib/generated/prisma/client";

/**
 * Authoritative freeze decision from resolvePlayerWeekStatus /
 * loadResolvedStatusesForWeek.
 */
export function freezeUnavailableFromWeekStatus(
  status: Pick<ResolvedPlayerWeekStatus, "promotionUnavailable">,
): boolean {
  return status.promotionUnavailable === true;
}

/**
 * Legacy helper: EntryAvailability → freeze.
 * Prefer freezeUnavailableFromWeekStatus with week-scoped resolution.
 * Kept for callers that already hold effectiveEntryAvailability from
 * resolvePlayerWeekStatus (not RankableEntry).
 */
export function freezeUnavailableAtKickoff(
  availability: EntryAvailability | string | null | undefined,
): boolean {
  return isPromotionUnavailable(availability);
}
