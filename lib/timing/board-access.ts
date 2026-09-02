export type BoardViewer = {
  profileId: string | null;
  isAdmin: boolean;
};

/** Dev/env fallback. Persistent BoardEntitlement records are the source of truth. */
export type BoardRevealEntitlementStub = {
  canViewRevealBoards: boolean;
};

/** @deprecated Use BoardRevealEntitlementStub. Kept for existing call sites. */
export type BoardEntitlement = BoardRevealEntitlementStub;

export type BoardAccessWeek = {
  status?: string | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
};

export type BoardAccessContest = {
  status?: string | null;
};

export type BoardRevealPreference = "FREE_REVEAL" | "PREMIUM_REVEAL";

/**
 * Feature-flag entitlement stub. No Stripe/payment logic.
 * RANKIQ_BOARD_REVEAL_ENTITLED=1 still unlocks PREMIUM_REVEAL boards during 10am–noon CT.
 */
export function getBoardRevealEntitlement(
  _viewer?: BoardViewer,
  env: Record<string, string | undefined> = process.env,
): BoardRevealEntitlementStub {
  return {
    canViewRevealBoards: env.RANKIQ_BOARD_REVEAL_ENTITLED === "1",
  };
}

export function isWeekHistoricallyPublic(week: BoardAccessWeek, now: Date) {
  if (week.status === "COMPLETE" || week.status === "ARCHIVED") return true;
  if (week.publicReleaseAt && now >= week.publicReleaseAt) return true;
  return false;
}

export function isContestHistoricallyPublic(contest?: BoardAccessContest | null) {
  return contest?.status === "FINAL" || contest?.status === "ARCHIVED";
}

export function isRevealWindowActive(week: BoardAccessWeek, now: Date) {
  const revealStart = week.revealStartsAt ?? week.fullLockAt;
  const publicAt = week.publicReleaseAt;
  return Boolean(
    revealStart && publicAt && now >= revealStart && now < publicAt,
  );
}

/**
 * Authorization for viewing another profile’s current-week board.
 * Owner and admin always. After noon CT (or historical final), public.
 * During Sunday 10am–noon:
 *   FREE_REVEAL (default) → anyone
 *   PREMIUM_REVEAL + creator enabled → matching entitlement or env fallback
 */
export function canViewCurrentWeekBoard(input: {
  viewer: BoardViewer;
  targetProfileId: string;
  week: BoardAccessWeek;
  contest?: BoardAccessContest | null;
  entitlement?: BoardRevealEntitlementStub;
  revealPreference?: BoardRevealPreference | null;
  creatorEnabled?: boolean;
  hasMatchingEntitlement?: boolean;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  if (
    input.viewer.profileId &&
    input.viewer.profileId === input.targetProfileId
  ) {
    return true;
  }
  if (input.viewer.isAdmin) return true;
  if (isWeekHistoricallyPublic(input.week, now)) return true;
  if (isContestHistoricallyPublic(input.contest)) return true;

  if (!isRevealWindowActive(input.week, now)) return false;

  const premium =
    input.creatorEnabled === true &&
    input.revealPreference === "PREMIUM_REVEAL";
  if (!premium) return true;

  return Boolean(
    input.hasMatchingEntitlement || input.entitlement?.canViewRevealBoards,
  );
}

/** Consensus is free after Sunday full lock (and remains public afterward). */
export function canViewCurrentWeekConsensus(input: {
  week: BoardAccessWeek;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  if (isWeekHistoricallyPublic(input.week, now)) return true;
  const lockAt = input.week.fullLockAt ?? input.week.revealStartsAt;
  return Boolean(lockAt && now >= lockAt);
}
