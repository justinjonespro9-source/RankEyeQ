import type { ProfileType } from "@/lib/generated/prisma/client";

/**
 * Formal authorization/visibility state for tracked Experts & Creators.
 *
 * Source of truth (no overlapping enum):
 * - PRIVATE_TRACKED: competitorActive && !publicVisible
 * - AUTHORIZED_PUBLIC: competitorActive && publicVisible
 * - INACTIVE: !competitorActive
 *
 * Optional publicFromWeekId (when AUTHORIZED_PUBLIC):
 * - null → expose full history
 * - set → only that week and later are public
 */

export type CompetitorVisibilityState =
  | "PRIVATE_TRACKED"
  | "AUTHORIZED_PUBLIC"
  | "INACTIVE";

export type VisibilityProfileFields = {
  profileType: ProfileType;
  competitorActive: boolean;
  publicVisible: boolean;
  publicFromWeekId?: string | null;
};

export type WeekVisibilityFields = {
  id: string;
  seasonId: string;
  weekNumber: number;
  startsAt: Date;
};

/** Experts (BENCHMARK) and Creators participate in private-tracking authorization. */
export function supportsPrivateTracking(profileType: ProfileType): boolean {
  return profileType === "BENCHMARK" || profileType === "CREATOR";
}

export function resolveCompetitorVisibility(
  profile: VisibilityProfileFields,
): CompetitorVisibilityState {
  if (!profile.competitorActive) return "INACTIVE";
  if (!profile.publicVisible) return "PRIVATE_TRACKED";
  return "AUTHORIZED_PUBLIC";
}

export function competitorVisibilityBadgeLabel(
  state: CompetitorVisibilityState,
): string {
  switch (state) {
    case "PRIVATE_TRACKED":
      return "PRIVATE TRACKED";
    case "AUTHORIZED_PUBLIC":
      return "PUBLIC";
    case "INACTIVE":
      return "INACTIVE";
  }
}

/**
 * May appear on public leaderboards, consensus, discovery, sitemap, public profile.
 * Private-tracked Experts/Creators never qualify.
 */
export function profileAppearsOnPublicSurfaces(
  profile: VisibilityProfileFields,
): boolean {
  if (profile.profileType === "HUMAN") {
    return profile.publicVisible;
  }
  // AI / Publisher Consensus / Experts / Creators
  return profile.competitorActive && profile.publicVisible;
}

/** Consensus / leaderboard ballot eligibility for public math. */
export function profileContributesToPublicConsensus(
  profile: VisibilityProfileFields,
): boolean {
  return profileAppearsOnPublicSurfaces(profile);
}

/**
 * Whether a specific week’s boards/scores may be shown publicly for this profile.
 * Requires AUTHORIZED_PUBLIC; respects publicFromWeekId gate.
 */
export function weekIsPubliclyVisibleForProfile(
  profile: VisibilityProfileFields & {
    publicFromWeek?: WeekVisibilityFields | null;
  },
  week: WeekVisibilityFields,
): boolean {
  if (!profileAppearsOnPublicSurfaces(profile)) return false;
  if (!profile.publicFromWeekId) return true;

  const from = profile.publicFromWeek;
  if (!from) {
    // Gate exists but week row not loaded — fail closed for public surfaces.
    return week.id === profile.publicFromWeekId;
  }

  if (week.seasonId === from.seasonId) {
    return week.weekNumber >= from.weekNumber;
  }
  return week.startsAt.getTime() >= from.startsAt.getTime();
}

export type AuthorizeHistoryMode = "from_now" | "expose_history";

export function authorizePublicUpdate(input: {
  historyMode: AuthorizeHistoryMode;
  currentWeekId: string | null;
}): {
  publicVisible: true;
  competitorActive: true;
  publicFromWeekId: string | null;
} {
  return {
    publicVisible: true,
    competitorActive: true,
    publicFromWeekId:
      input.historyMode === "from_now" ? input.currentWeekId : null,
  };
}

export function demoteToPrivateTracked(): {
  publicVisible: false;
  competitorActive: true;
  publicFromWeekId: null;
} {
  return {
    publicVisible: false,
    competitorActive: true,
    publicFromWeekId: null,
  };
}

export function setInactiveVisibility(): {
  competitorActive: false;
  publicVisible: false;
  publicFromWeekId: null;
} {
  return {
    competitorActive: false,
    publicVisible: false,
    publicFromWeekId: null,
  };
}
