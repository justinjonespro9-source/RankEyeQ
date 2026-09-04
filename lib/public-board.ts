import { trackEvent } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import type {
  BoardRevealPreference,
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";
import { findMatchingEntitlement } from "@/lib/social/entitlements";
import { isPremiumRevealBoard } from "@/lib/social/creator";
import {
  recordBoardUnlockEvent,
  resolveUnlockAccessType,
} from "@/lib/social/unlocks";
import {
  canViewCurrentWeekBoard,
  getBoardRevealEntitlement,
  isContestHistoricallyPublic,
  isWeekHistoricallyPublic,
  type BoardViewer,
} from "@/lib/timing/board-access";
import { ensureWeekFullLock } from "@/lib/timing/apply-locks";
import { getWeekTimingState } from "@/lib/timing/week-windows";

export type PublicBoardPick = {
  predictedRank: number;
  name: string;
  team: string;
  opponent: string;
  slotLocked: boolean;
  lockedAt: Date | null;
  lockedRank: number | null;
  committedAt: Date | null;
};

export type PublicBoardView = {
  allowed: boolean;
  gatedPremium: boolean;
  reason: string | null;
  username: string;
  displayName: string;
  profileType: ProfileType;
  weekLabel: string;
  weekNumber: number;
  position: ContestPosition;
  rankingDepth: number;
  submissionStatus: string | null;
  submittedAt: Date | null;
  lockedAt: Date | null;
  contestStatus: string;
  timingPhase: string;
  revealPreference: BoardRevealPreference | null;
  creatorEnabled: boolean;
  picks: PublicBoardPick[];
  capturedAt: Date | null;
  captureAttribution: string | null;
  publicBoardRestricted: boolean;
};

export type ProfileBoardAccessSummary = {
  position: ContestPosition;
  weekNumber: number;
  exists: boolean;
  allowed: boolean;
  gatedPremium: boolean;
  submissionStatus: string | null;
};

export async function getProfileCurrentWeekBoardSummaries(input: {
  username: string;
  viewer: BoardViewer;
  now?: Date;
}): Promise<ProfileBoardAccessSummary[]> {
  const positions: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  const week = await prisma.week.findFirst({
    where: {
      season: { active: true },
      status: { in: ["OPEN", "LOCKED", "COMPLETE"] },
    },
    orderBy: { weekNumber: "desc" },
  });
  if (!week) return [];

  const summaries: ProfileBoardAccessSummary[] = [];
  for (const position of positions) {
    const board = await getPublicProfileBoard({
      username: input.username,
      weekNumber: week.weekNumber,
      position,
      viewer: input.viewer,
      now: input.now,
      recordUnlock: false,
    });
    if (!board) continue;
    summaries.push({
      position,
      weekNumber: week.weekNumber,
      exists: Boolean(board.submissionStatus),
      allowed: board.allowed,
      gatedPremium: board.gatedPremium,
      submissionStatus: board.submissionStatus,
    });
  }
  return summaries.filter((row) => row.exists);
}

export async function getPublicProfileBoard(input: {
  username: string;
  weekNumber: number;
  position: ContestPosition;
  viewer: BoardViewer;
  now?: Date;
  recordUnlock?: boolean;
}): Promise<PublicBoardView | null> {
  const now = input.now ?? new Date();
  const profile = await prisma.universalProfile.findUnique({
    where: { username: input.username },
    include: { creatorProfile: true },
  });
  if (!profile) return null;

  const week = await prisma.week.findFirst({
    where: {
      weekNumber: input.weekNumber,
      season: { active: true },
    },
    include: { season: true },
  });
  if (!week) return null;

  await ensureWeekFullLock(week.id, now);

  const contest = await prisma.rankIQContest.findUnique({
    where: {
      weekId_position: { weekId: week.id, position: input.position },
    },
  });
  if (!contest) return null;

  const submission = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: contest.id,
        universalProfileId: profile.id,
      },
    },
    include: {
      picks: {
        include: { rankableEntry: true },
        orderBy: { predictedRank: "asc" },
      },
    },
  });

  const creatorEnabled = profile.creatorProfile?.enabled === true;
  const revealPreference = submission?.revealPreference ?? "FREE_REVEAL";
  const premium = isPremiumRevealBoard({
    creatorEnabled,
    revealPreference,
  });

  const benchmarkSnapshot =
    profile.profileType === "BENCHMARK" || profile.profileType === "CREATOR"
      ? await prisma.benchmarkSnapshot.findFirst({
          where: {
            contestId: contest.id,
            universalProfileId: profile.id,
          },
          orderBy: { createdAt: "desc" },
          select: {
            capturedAt: true,
            publicBoardAllowed: true,
            status: true,
          },
        })
      : null;
  const publicBoardRestricted =
    (profile.profileType === "BENCHMARK" || profile.profileType === "CREATOR") &&
    (benchmarkSnapshot?.status === "NOT_AVAILABLE" ||
      benchmarkSnapshot?.publicBoardAllowed === false);

  let hasMatchingEntitlement = false;
  let matchingEntitlementId: string | null = null;
  if (input.viewer.profileId) {
    const match = await findMatchingEntitlement({
      viewerProfileId: input.viewer.profileId,
      creatorProfileId: profile.id,
      contestId: contest.id,
      weekId: week.id,
      now,
    });
    if (match) {
      hasMatchingEntitlement = true;
      matchingEntitlementId = match.id;
    }
  }

  const entitlementStub = getBoardRevealEntitlement(input.viewer);
  const allowed = canViewCurrentWeekBoard({
    viewer: input.viewer,
    targetProfileId: profile.id,
    week,
    contest,
    entitlement: entitlementStub,
    revealPreference,
    creatorEnabled,
    hasMatchingEntitlement,
    now,
  });

  const timing = getWeekTimingState({
    rankingsOpenAt: week.rankingsOpenAt,
    fullLockAt: week.fullLockAt,
    revealStartsAt: week.revealStartsAt,
    publicReleaseAt: week.publicReleaseAt,
    weekStatus: week.status,
    now,
  });

  const gatedPremium = Boolean(
    !allowed && premium && timing.revealWindowActive,
  );
  if (gatedPremium && input.recordUnlock !== false) {
    trackEvent("premium_board_gate_viewed", {
      position: contest.position,
      weekNumber: week.weekNumber,
    });
  }

  const base: PublicBoardView = {
    allowed,
    gatedPremium,
    reason: allowed
      ? null
      : gatedPremium
        ? "Premium board — unlock required before noon."
        : timing.revealWindowActive
          ? "Individual boards are in the Sunday reveal window."
          : timing.fullBoardLocked
            ? "This board is not available to you yet."
            : "Current-week rankings stay private until Sunday lock.",
    username: profile.username,
    displayName: profile.displayName,
    profileType: profile.profileType,
    weekLabel: week.label,
    weekNumber: week.weekNumber,
    position: contest.position,
    rankingDepth: contest.rankingDepth,
    submissionStatus: submission?.status ?? null,
    submittedAt: submission?.submittedAt ?? null,
    lockedAt: submission?.lockedAt ?? null,
    contestStatus: contest.status,
    timingPhase: timing.phase,
    revealPreference: submission?.revealPreference ?? null,
    creatorEnabled,
    picks: [],
    capturedAt: benchmarkSnapshot?.capturedAt ?? null,
    captureAttribution:
      profile.profileType === "BENCHMARK" || profile.profileType === "CREATOR"
        ? "Source ranking captured by RankEYEQ"
        : null,
    publicBoardRestricted,
  };

  if (!allowed) return base;
  if (!submission) return base;
  if (publicBoardRestricted) {
    return {
      ...base,
      allowed: true,
      reason:
        "This source ranking is stored internally and is not reproduced publicly. Performance metrics remain available.",
    };
  }

  const isOwner =
    Boolean(input.viewer.profileId) &&
    input.viewer.profileId === profile.id;
  const historicallyPublic =
    isWeekHistoricallyPublic(week, now) ||
    isContestHistoricallyPublic(contest);

  if (input.recordUnlock !== false) {
    if (input.viewer.profileId) {
      rateLimit({
        key: `unlock:${input.viewer.profileId}:${contest.id}`,
        ...RATE_LIMITS.unlockWrite,
      });
    }
    await recordBoardUnlockEvent({
      viewerProfileId: input.viewer.profileId,
      creatorProfileId: profile.id,
      contestId: contest.id,
      entitlementId: matchingEntitlementId,
      accessType: resolveUnlockAccessType({
        isOwner,
        isAdmin: input.viewer.isAdmin,
        historicallyPublic,
        premiumReveal: premium,
        hasMatchingEntitlement:
          hasMatchingEntitlement || entitlementStub.canViewRevealBoards,
      }),
    });
    if (!isOwner) {
      trackEvent("board_unlocked", {
        position: contest.position,
        weekNumber: week.weekNumber,
      });
    }
  }

  return {
    ...base,
    picks: submission.picks.map((pick) => ({
      predictedRank: pick.predictedRank,
      name: pick.rankableEntry.name,
      team: pick.rankableEntry.team,
      opponent: pick.rankableEntry.opponent,
      slotLocked: pick.slotLocked,
      lockedAt: pick.lockedAt,
      lockedRank: pick.lockedRank,
      committedAt: pick.committedAt,
    })),
  };
}
