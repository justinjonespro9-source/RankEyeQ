import { trackEvent } from "@/lib/analytics";
import {
  profileAppearsOnPublicSurfaces,
  weekIsPubliclyVisibleForProfile,
} from "@/lib/competitor-visibility";
import { prisma } from "@/lib/db";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
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
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";
import {
  provisionalStandingStatus,
  scoreProvisionalEyeq,
  type ProvisionalStandingStatus,
} from "@/lib/live-provisional";
import { scoreableEffectivePicks } from "@/lib/reserves/from-submission";

export type PublicBoardPick = {
  predictedRank: number;
  rankableEntryId: string | null;
  name: string;
  team: string;
  opponent: string;
  slotLocked: boolean;
  lockedAt: Date | null;
  lockedRank: number | null;
  committedAt: Date | null;
  /** Current positional standing (provisional live or final actual). */
  currentActualRank: number | null;
  standingStatus: ProvisionalStandingStatus;
  /** Final-only exact-hit celebration. */
  showExactHit: boolean;
};

export type PublicBoardLiveEyeq = {
  score: number;
  resolvedCount: number;
  totalPicks: number;
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
  /** Live/unofficial mode (contest not graded final). */
  isLiveProvisional: boolean;
  /** Official graded EYEQ when available. */
  finalEyeqScore: number | null;
  /** Provisional LIVE EYEQ — never written as normalizedScore. */
  liveEyeq: PublicBoardLiveEyeq | null;
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
    include: { creatorProfile: true, publicFromWeek: true },
  });
  if (!profile) return null;

  const visibility = {
    profileType: profile.profileType,
    competitorActive: profile.competitorActive,
    publicVisible: profile.publicVisible,
    publicFromWeekId: profile.publicFromWeekId,
    publicFromWeek: profile.publicFromWeek,
  };
  // Private-tracked / inactive competitors never expose identity on public board routes.
  if (
    !input.viewer.isAdmin &&
    !profileAppearsOnPublicSurfaces(visibility)
  ) {
    return null;
  }

  const week = await prisma.week.findFirst({
    where: {
      weekNumber: input.weekNumber,
      season: { active: true },
    },
    include: { season: true },
  });
  if (!week) return null;

  if (
    !input.viewer.isAdmin &&
    !weekIsPubliclyVisibleForProfile(visibility, {
      id: week.id,
      seasonId: week.seasonId,
      weekNumber: week.weekNumber,
      startsAt: week.startsAt,
    })
  ) {
    return null;
  }

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
    isLiveProvisional:
      contest.status !== "FINAL" && contest.status !== "ARCHIVED",
    finalEyeqScore: submission?.normalizedScore ?? null,
    liveEyeq: null,
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

  const contestEntries = await prisma.contestEntry.findMany({
    where: { contestId: contest.id, excluded: false },
    select: {
      rankableEntryId: true,
      fantasyPoints: true,
      actualRank: true,
    },
  });

  const contestIsFinal =
    contest.status === "FINAL" || contest.status === "ARCHIVED";
  const provisional = provisionalRanksFromPoints(contestEntries);
  const provisionalById = new Map(
    provisional.map((row) => [row.item.rankableEntryId, row.rank]),
  );
  const finalActualById = new Map(
    contestEntries
      .filter((entry) => entry.actualRank != null)
      .map((entry) => [entry.rankableEntryId, entry.actualRank!]),
  );

  const picks: PublicBoardPick[] = submission.picks.map((pick) => {
    const currentActualRank = contestIsFinal
      ? (finalActualById.get(pick.rankableEntryId) ?? null)
      : (provisionalById.get(pick.rankableEntryId) ?? null);
    const standingStatus = provisionalStandingStatus(
      currentActualRank,
      contest.rankingDepth,
    );
    const showExactHit =
      contestIsFinal &&
      currentActualRank != null &&
      currentActualRank === pick.predictedRank &&
      currentActualRank <= contest.rankingDepth;

    return {
      predictedRank: pick.predictedRank,
      rankableEntryId: pick.rankableEntryId,
      name: pick.rankableEntry.name,
      team: pick.rankableEntry.team,
      opponent: pick.rankableEntry.opponent,
      slotLocked: pick.slotLocked,
      lockedAt: pick.lockedAt,
      lockedRank: pick.lockedRank,
      committedAt: pick.committedAt,
      currentActualRank,
      standingStatus,
      showExactHit,
    };
  });

  let liveEyeq: PublicBoardLiveEyeq | null = null;
  if (!contestIsFinal && submissionIsEligible(submission.status)) {
    const summary = scoreProvisionalEyeq(
      scoreableEffectivePicks({
        picks: submission.picks,
        scoringDepth: contest.rankingDepth,
      }).map((pick) => ({
        playerId: pick.playerId,
        playerName:
          submission.picks.find((p) => p.rankableEntryId === pick.playerId)
            ?.rankableEntry.name ?? pick.playerId,
        predictedRank: pick.predictedRank,
        provisionalActualRank: provisionalById.get(pick.playerId) ?? null,
      })),
      contest.rankingDepth,
    );
    if (summary.resolvedCount > 0) {
      liveEyeq = {
        score: summary.liveEyeqScore,
        resolvedCount: summary.resolvedCount,
        totalPicks: summary.totalPicks,
      };
    }
  }

  return {
    ...base,
    picks,
    liveEyeq,
    isLiveProvisional: !contestIsFinal,
    finalEyeqScore: submission.normalizedScore,
  };
}
