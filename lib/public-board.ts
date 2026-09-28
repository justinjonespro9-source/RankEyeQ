import { trackEvent } from "@/lib/analytics";
import {
  profileAppearsOnPublicSurfaces,
  weekIsPubliclyVisibleForProfile,
} from "@/lib/competitor-visibility";
import { prisma } from "@/lib/db";
import { boardSeasonWhere } from "@/lib/board-routes";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import type {
  BoardRevealPreference,
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";
import {
  boardShowsCaptureProvenance,
  snapshotRestrictsPublicBoard,
} from "@/lib/boards/source-rights";
import { resolveSubmissionAuthority } from "@/lib/boards/authority";
import {
  loadOfficialBoardVersions,
  type OfficialBoardVersionView,
} from "@/lib/boards/official-board";
import { listWeeklyContent } from "@/lib/weekly-content";
import type { WeeklyContentItem } from "@/lib/weekly-content-shared";
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
import { buildContestWeekKickoffMap } from "@/lib/reserves/contest-week-kickoffs";
import {
  buildOriginalBoardAudit,
  reconstructStoredScoringBoard,
} from "@/lib/reserves/stored-scoring-board";

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
  /** Reserve slot when this row came from R1/R2 on the scoring board. */
  fromReserve?: boolean;
  reserveSlot?: number | null;
  /** Original submitted rank (scoring-board rows only). */
  originalPredictedRank?: number | null;
};

export type PublicBoardOriginalAuditPick = {
  predictedRank: number;
  name: string;
  team: string;
  isReserve: boolean;
  reserveSlot: number | null;
  scored: boolean;
  wasUnavailableAtKickoff: boolean | null;
  note: string | null;
};

export type PublicBoardLiveEyeq = {
  score: number;
  resolvedCount: number;
  totalPicks: number;
};

/**
 * Official RankEyeQ Board progression for owner-authored boards:
 * PROTECTED → PUBLISHED (latest published version) → FINAL (immutable
 * receipt) → SCORING. LOCKED = locked board without a FINAL receipt
 * (boards before FINAL receipts existed).
 */
export type OfficialBoardStage =
  | "PROTECTED"
  | "PUBLISHED"
  | "FINAL"
  | "LOCKED"
  | "SCORING";

export type PublicOfficialBoard = {
  stage: OfficialBoardStage;
  publishedVersionNumber: number | null;
  lastPublishedAt: Date | null;
  finalLockedAt: Date | null;
};

export type PublicBoardView = {
  allowed: boolean;
  gatedPremium: boolean;
  reason: string | null;
  profileId: string;
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
  /**
   * Primary board shown next to EyeQ.
   * FINAL/GRADED: stored scoring board (what produced normalizedScore).
   * Live: original submitted order with live standings.
   */
  picks: PublicBoardPick[];
  /** Immutable original submission audit (FINAL only when graded detail exists). */
  originalAuditPicks: PublicBoardOriginalAuditPick[];
  /** True when `picks` is the stored scoring board, not the original submission. */
  showingStoredScoringBoard: boolean;
  boardCaption: string | null;
  capturedAt: Date | null;
  captureAttribution: string | null;
  /**
   * RankEyeQ-captured weekly provenance URL (BenchmarkSnapshot.sourceUrl).
   * Not owner-editable; omit CTA when null.
   */
  weeklySourceUrl: string | null;
  publicBoardRestricted: boolean;
  /** Live/unofficial mode (contest not graded final). */
  isLiveProvisional: boolean;
  /** Official graded EYEQ when available. */
  finalEyeqScore: number | null;
  /** Provisional LIVE EYEQ — never written as normalizedScore. */
  liveEyeq: PublicBoardLiveEyeq | null;
  /** null = not an owner-authored board (captured / AI keep existing terms). */
  officialBoard: PublicOfficialBoard | null;
  /** FINAL receipt reserves only — never shown before the board is final. */
  reservePicks: PublicBoardPick[];
  /** Owner/admin seeing the private live board while the public sees less. */
  ownerPreview: boolean;
  weeklyContent: WeeklyContentItem[];
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
  /** Pins the week to a specific season; omitted → active season. */
  seasonYear?: number | null;
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
      season: boardSeasonWhere(input.seasonYear, { active: true }),
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

  // Lock transitions only apply to the live season; historical receipts are read-only.
  if (week.season.active) await ensureWeekFullLock(week.id, now);

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

  // Provenance follows the board's authority, not the profile type.
  const showsCaptureProvenance = boardShowsCaptureProvenance({
    profileType: profile.profileType,
    submission,
  });

  const benchmarkSnapshot =
    showsCaptureProvenance
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
            sourceUrl: true,
          },
        })
      : null;
  const publicBoardRestricted =
    showsCaptureProvenance && snapshotRestrictsPublicBoard(benchmarkSnapshot);

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

  const isOwner =
    Boolean(input.viewer.profileId) &&
    input.viewer.profileId === profile.id;
  const historicallyPublic =
    isWeekHistoricallyPublic(week, now) ||
    isContestHistoricallyPublic(contest);
  const contestIsFinal =
    contest.status === "FINAL" || contest.status === "ARCHIVED";

  const ownerAuthored =
    (profile.profileType === "HUMAN" || profile.profileType === "CREATOR") &&
    resolveSubmissionAuthority({
      profileType: profile.profileType,
      submission,
    }) === "OWNER_AUTHORED";
  const officialVersions =
    ownerAuthored && submission
      ? await loadOfficialBoardVersions(submission.id)
      : { published: null, final: null };
  const officialBoardFor = (
    stage: OfficialBoardStage,
  ): PublicOfficialBoard | null =>
    ownerAuthored
      ? {
          stage,
          publishedVersionNumber:
            officialVersions.published?.versionNumber ?? null,
          lastPublishedAt: officialVersions.published?.lastPublishedAt ?? null,
          finalLockedAt: officialVersions.final?.boardLockedAt ?? null,
        }
      : null;
  const defaultStage: OfficialBoardStage =
    contestIsFinal && submission?.status === "GRADED"
      ? "SCORING"
      : officialVersions.final
        ? "FINAL"
        : timing.fullBoardLocked
          ? "LOCKED"
          : officialVersions.published
            ? "PUBLISHED"
            : "PROTECTED";
  const weeklyContent = await listWeeklyContent({
    profileId: profile.id,
    weekId: week.id,
    position: contest.position,
  });

  const loadStandings = async () => {
    const entries = await prisma.contestEntry.findMany({
      where: { contestId: contest.id, excluded: false },
      select: {
        rankableEntryId: true,
        fantasyPoints: true,
        actualRank: true,
        game: {
          select: {
            id: true,
            weekId: true,
            homeTeam: true,
            awayTeam: true,
            startsAt: true,
          },
        },
      },
    });
    const provisionalRanks = provisionalRanksFromPoints(entries);
    return {
      contestEntries: entries,
      provisionalById: new Map(
        provisionalRanks.map((row) => [row.item.rankableEntryId, row.rank]),
      ),
      finalActualById: new Map(
        entries
          .filter((entry) => entry.actualRank != null)
          .map((entry) => [entry.rankableEntryId, entry.actualRank!]),
      ),
    };
  };
  const versionPicks = (
    version: OfficialBoardVersionView,
    reserves: boolean,
    standings: Awaited<ReturnType<typeof loadStandings>>,
  ): PublicBoardPick[] =>
    version.picks
      .filter((pick) => pick.isReserve === reserves)
      .map((pick) => {
        const currentActualRank = contestIsFinal
          ? (standings.finalActualById.get(pick.rankableEntryId) ?? null)
          : (standings.provisionalById.get(pick.rankableEntryId) ?? null);
        return {
          predictedRank: pick.boardRank,
          rankableEntryId: pick.rankableEntryId,
          name: pick.displayName,
          team: pick.displayTeam,
          opponent: "",
          slotLocked: pick.slotLocked,
          lockedAt: pick.lockedAt,
          lockedRank: pick.lockedRank,
          committedAt: pick.committedAt,
          currentActualRank,
          standingStatus: provisionalStandingStatus(
            currentActualRank,
            contest.rankingDepth,
          ),
          showExactHit:
            contestIsFinal &&
            currentActualRank != null &&
            currentActualRank === pick.boardRank &&
            currentActualRank <= contest.rankingDepth,
          reserveSlot: pick.reserveSlot,
        };
      });

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
    profileId: profile.id,
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
    originalAuditPicks: [],
    showingStoredScoringBoard: false,
    boardCaption: null,
    capturedAt: benchmarkSnapshot?.capturedAt ?? null,
    weeklySourceUrl: benchmarkSnapshot?.sourceUrl?.trim() || null,
    captureAttribution: showsCaptureProvenance
      ? "Source ranking captured by RankEYEQ"
      : null,
    publicBoardRestricted,
    isLiveProvisional:
      contest.status !== "FINAL" && contest.status !== "ARCHIVED",
    finalEyeqScore: submission?.normalizedScore ?? null,
    liveEyeq: null,
    officialBoard: officialBoardFor(defaultStage),
    reservePicks: [],
    ownerPreview: false,
    weeklyContent,
  };

  if (!allowed) {
    // A published version is public by the owner's choice; the live board and
    // reserves stay private. No unlock event: nothing gated was revealed.
    const published = officialVersions.published;
    if (!published || !submission) return base;
    return {
      ...base,
      allowed: true,
      reason: null,
      officialBoard: officialBoardFor("PUBLISHED"),
      picks: versionPicks(published, false, await loadStandings()),
    };
  }
  if (!submission) return base;
  if (publicBoardRestricted) {
    return {
      ...base,
      allowed: true,
      reason:
        "This source ranking is stored internally and is not reproduced publicly. Performance metrics remain available.",
    };
  }

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

  const standings = await loadStandings();
  const { contestEntries, provisionalById, finalActualById } = standings;

  const storedScoring =
    contestIsFinal && submission.status === "GRADED"
      ? reconstructStoredScoringBoard({
          picks: submission.picks.map((pick) => ({
            rankableEntryId: pick.rankableEntryId,
            predictedRank: pick.predictedRank,
            totalPoints: pick.totalPoints,
            wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff,
            name: pick.rankableEntry.name,
            team: pick.rankableEntry.team,
            actualRank: pick.actualRank,
          })),
          scoringDepth: contest.rankingDepth,
        })
      : null;

  const originalAuditPicks =
    contestIsFinal && storedScoring
      ? buildOriginalBoardAudit({
          picks: submission.picks.map((pick) => ({
            rankableEntryId: pick.rankableEntryId,
            predictedRank: pick.predictedRank,
            totalPoints: pick.totalPoints,
            wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff,
            name: pick.rankableEntry.name,
            team: pick.rankableEntry.team,
          })),
          scoringDepth: contest.rankingDepth,
        })
      : [];

  const publicAllowed = canViewCurrentWeekBoard({
    viewer: { profileId: null, isAdmin: false },
    targetProfileId: profile.id,
    week,
    contest,
    entitlement: { canViewRevealBoards: false },
    revealPreference,
    creatorEnabled,
    hasMatchingEntitlement: false,
    now,
  });
  const ownerPreview = !publicAllowed && (isOwner || input.viewer.isAdmin);
  const finalReceipt =
    storedScoring == null && !ownerPreview ? officialVersions.final : null;

  const picks: PublicBoardPick[] =
    finalReceipt != null
      ? versionPicks(finalReceipt, false, standings)
      : storedScoring != null
      ? storedScoring.map((row) => {
          const currentActualRank =
            finalActualById.get(row.rankableEntryId) ?? row.actualRank;
          const standingStatus = provisionalStandingStatus(
            currentActualRank,
            contest.rankingDepth,
          );
          const showExactHit =
            currentActualRank != null &&
            currentActualRank === row.scoringRank &&
            currentActualRank <= contest.rankingDepth;
          return {
            predictedRank: row.scoringRank,
            rankableEntryId: row.rankableEntryId,
            name: row.name,
            team: row.team,
            opponent: "",
            slotLocked: false,
            lockedAt: null,
            lockedRank: null,
            committedAt: null,
            currentActualRank,
            standingStatus,
            showExactHit,
            fromReserve: row.fromReserve,
            reserveSlot: row.reserveSlot,
            originalPredictedRank: row.originalPredictedRank,
          };
        })
      : submission.picks.map((pick) => {
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
    const kickoffByEntryId = buildContestWeekKickoffMap({
      weekId: week.id,
      entries: contestEntries,
    });
    const summary = scoreProvisionalEyeq(
      scoreableEffectivePicks({
        picks: submission.picks,
        scoringDepth: contest.rankingDepth,
        kickoffByEntryId,
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
    originalAuditPicks,
    showingStoredScoringBoard: storedScoring != null,
    boardCaption:
      storedScoring != null
        ? "Scoring board — original ranking adjusted for confirmed unavailable players."
        : null,
    liveEyeq,
    isLiveProvisional: !contestIsFinal,
    finalEyeqScore: submission.normalizedScore,
    officialBoard: officialBoardFor(
      storedScoring != null
        ? "SCORING"
        : finalReceipt != null
          ? "FINAL"
          : defaultStage,
    ),
    reservePicks:
      finalReceipt != null ? versionPicks(finalReceipt, true, standings) : [],
    ownerPreview,
  };
}
